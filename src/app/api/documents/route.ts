import { checkCapacity } from "@/lib/entitlements";
import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, documentVersions, tenants } from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import { canAccessDocument } from "@/lib/permissions";
import { sanitizeText, validateUploadFile } from "@/lib/security";
import { recordAuditLog } from "@/lib/audit";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request, "documents:view");
    const tId = ctx.tenantId;
    const url = new URL(request.url);
    const idParam = url.searchParams.get("id");
    const download = url.searchParams.get("download") === "1";

    if (idParam) {
      const docId = Number(idParam);
      if (!Number.isInteger(docId) || docId <= 0) {
        throw new ApiError(400, "Invalid document ID.");
      }
      const [doc] = await db
        .select()
        .from(documents)
        .where(and(eq(documents.id, docId), eq(documents.tenantId, tId)))
        .limit(1);
      if (!doc) throw new ApiError(404, "Document not found in workspace.");
      if (!canAccessDocument(doc.visibility, ctx.role, ctx.permissions)) {
        throw new ApiError(
          403,
          `Your role (${ctx.role}) cannot access ${doc.visibility} restricted documents.`,
        );
      }

      if (download) {
        const buffer = Buffer.from(doc.contentBase64 || "", "base64");
        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": doc.mimeType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${doc.fileName.replace(
              /"/g,
              "",
            )}"`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }

      const versions = await db
        .select({
          id: documentVersions.id,
          versionNumber: documentVersions.versionNumber,
          fileName: documentVersions.fileName,
          mimeType: documentVersions.mimeType,
          sizeBytes: documentVersions.sizeBytes,
          changeNote: documentVersions.changeNote,
          uploaderName: documentVersions.uploaderName,
          createdAt: documentVersions.createdAt,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, doc.id),
            eq(documentVersions.tenantId, tId),
          ),
        )
        .orderBy(desc(documentVersions.versionNumber));

      return NextResponse.json({ document: doc, versions });
    }

    const search = (url.searchParams.get("search") || "").trim().toLowerCase();
    const category = url.searchParams.get("category") || "all";

    const rows = await db
      .select({
        id: documents.id,
        title: documents.title,
        fileName: documents.fileName,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        category: documents.category,
        visibility: documents.visibility,
        currentVersion: documents.currentVersion,
        textPreview: documents.textPreview,
        expiresAt: documents.expiresAt,
        uploaderName: documents.uploaderName,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(eq(documents.tenantId, tId))
      .orderBy(desc(documents.updatedAt));

    const horizon30 = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    let accessible = rows
      .filter((d) => canAccessDocument(d.visibility, ctx.role, ctx.permissions))
      .map((d) => ({
        ...d,
        expiringSoon: Boolean(d.expiresAt && d.expiresAt <= horizon30),
      }));

    if (category !== "all") {
      accessible = accessible.filter((d) => d.category === category);
    }
    if (search) {
      accessible = accessible.filter(
        (d) =>
          d.title.toLowerCase().includes(search) ||
          d.fileName.toLowerCase().includes(search) ||
          (d.textPreview || "").toLowerCase().includes(search),
      );
    }

    return NextResponse.json({
      documents: accessible,
      expiringCount: accessible.filter((d) => d.expiringSoon).length,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const uploadDocSchema = z.object({
  action: z.enum(["create", "new_version"]).default("create"),
  documentId: z.number().int().positive().optional(),
  title: z.string().min(2).max(160).optional(),
  fileName: z.string().min(1).max(160),
  mimeType: z.string().min(3).max(120),
  contentBase64: z
    .string()
    .min(4)
    .max(4 * Math.ceil((5 * 1024 * 1024) / 3)),
  category: z
    .enum([
      "contract",
      "invoice",
      "receipt",
      "hr",
      "finance",
      "policy",
      "project",
      "general",
    ])
    .default("general"),
  visibility: z
    .enum(["workspace", "managers", "hr_only", "finance_only"])
    .default("workspace"),
  expiresAt: z.string().max(20).optional(),
  changeNote: z.string().max(240).optional(),
});

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request, "documents:write");
    const body = uploadDocSchema.parse(
      await readJson(request, 7 * 1024 * 1024),
    );
    const tId = ctx.tenantId;

    const buffer = Buffer.from(body.contentBase64, "base64");
    const check = validateUploadFile({
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: buffer.byteLength,
      bytes: buffer,
    });
    if (!check.valid) {
      throw new ApiError(
        400,
        check.error || "File rejected by upload security policy.",
      );
    }

    if (buffer.toString("base64") !== body.contentBase64)
      throw new ApiError(400, "Invalid base64 file encoding.");
    if (
      body.action === "create" &&
      !canAccessDocument(body.visibility, ctx.role, ctx.permissions)
    )
      throw new ApiError(403, "Visibility outside your document scope.");
    const isTextLike =
      body.mimeType.startsWith("text/") || body.mimeType === "application/json";
    const textPreview = isTextLike
      ? sanitizeText(buffer.toString("utf8").slice(0, 1200))
      : null;

    return await db.transaction(async (tx) => {
      await checkCapacity(tx, tId, "bytes", buffer.length);
      if (body.action === "new_version") {
        if (!body.documentId)
          throw new ApiError(400, "documentId is required.");
        const [existing] = await tx
          .select()
          .from(documents)
          .where(
            and(eq(documents.id, body.documentId), eq(documents.tenantId, tId)),
          )
          .limit(1)
          .for("update");
        if (!existing)
          throw new ApiError(404, "Document not found in workspace.");
        if (
          !canAccessDocument(existing.visibility, ctx.role, ctx.permissions)
        ) {
          throw new ApiError(403, "Access denied to update this document.");
        }

        const nextVer = existing.currentVersion + 1;
        const [updated] = await tx
          .update(documents)
          .set({
            fileName: check.safeFileName,
            mimeType: body.mimeType,
            sizeBytes: buffer.byteLength,
            currentVersion: nextVer,
            contentBase64: body.contentBase64,
            textPreview,
            expiresAt:
              body.expiresAt !== undefined
                ? body.expiresAt || null
                : existing.expiresAt,
            uploaderName: ctx.user.fullName,
            updatedAt: new Date(),
          })
          .where(
            and(eq(documents.id, existing.id), eq(documents.tenantId, tId)),
          )
          .returning();

        await tx.insert(documentVersions).values({
          tenantId: tId,
          documentId: existing.id,
          versionNumber: nextVer,
          fileName: check.safeFileName,
          mimeType: body.mimeType,
          sizeBytes: buffer.byteLength,
          contentBase64: body.contentBase64,
          changeNote: body.changeNote
            ? sanitizeText(body.changeNote)
            : `Uploaded version ${nextVer}`,
          uploaderName: ctx.user.fullName,
        });

        await recordAuditLog(
          {
            tenantId: tId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "document.version_uploaded",
            module: "documents",
            entityType: "document",
            entityId: existing.id,
            summary: `Uploaded v${nextVer} of "${existing.title}"`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json(
          { document: { ...updated, contentBase64: undefined } },
          { status: 201 },
        );
      }

      const title = sanitizeText(body.title || check.safeFileName);
      const [created] = await tx
        .insert(documents)
        .values({
          tenantId: tId,
          title,
          fileName: check.safeFileName,
          mimeType: body.mimeType,
          sizeBytes: buffer.byteLength,
          category: body.category,
          visibility: body.visibility,
          currentVersion: 1,
          contentBase64: body.contentBase64,
          textPreview,
          expiresAt: body.expiresAt || null,
          uploadedByUserId: ctx.user.id,
          uploaderName: ctx.user.fullName,
        })
        .returning();

      await tx.insert(documentVersions).values({
        tenantId: tId,
        documentId: created.id,
        versionNumber: 1,
        fileName: check.safeFileName,
        mimeType: body.mimeType,
        sizeBytes: buffer.byteLength,
        contentBase64: body.contentBase64,
        changeNote: body.changeNote
          ? sanitizeText(body.changeNote)
          : "Initial upload",
        uploaderName: ctx.user.fullName,
      });

      await recordAuditLog(
        {
          tenantId: tId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "document.uploaded",
          module: "documents",
          entityType: "document",
          entityId: created.id,
          summary: `Uploaded document "${created.title}" (${created.visibility})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json(
        {
          document: {
            ...created,
            contentBase64: undefined,
          },
        },
        { status: 201 },
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireAuth(request, "documents:write");
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      throw new ApiError(400, "Valid document id required.");
    }
    return await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId)))
        .limit(1)
        .for("update");
      if (!existing)
        throw new ApiError(404, "Document not found in workspace.");
      if (!canAccessDocument(existing.visibility, ctx.role, ctx.permissions)) {
        throw new ApiError(403, "Access denied.");
      }

      await tx
        .delete(documents)
        .where(and(eq(documents.id, id), eq(documents.tenantId, ctx.tenantId)));

      await recordAuditLog(
        {
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "document.deleted",
          module: "documents",
          entityId: id,
          entityType: "document",
          summary: "",
        },
        tx,
      );
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
