import nodemailer from "nodemailer";
import { and, eq, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { mailJobs } from "@/db/schema";
import { decryptSecret } from "./security";

const subjects: Record<string, string> = {
  verification: "Verify your work email",
  recovery: "Password recovery",
  invitation: "Workspace invitation",
  notification: "Workspace notification",
  billing: "Subscription update",
};
export function smtpTransport() {
  const local =
    process.env.SMTP_LOCAL_SINK === "1" &&
    ["127.0.0.1", "localhost", "mailpit"].includes(process.env.SMTP_HOST || "");
  if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT === "465",
    requireTLS: !local,
    ignoreTLS: local,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10_000,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
}
export async function deliverMail(
  send: (msg: {
    to: string;
    text: string;
    subject: string;
    messageId: string;
  }) => Promise<unknown>,
) {
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(mailJobs)
      .where(
        and(eq(mailJobs.status, "queued"), lte(mailJobs.runAfter, new Date())),
      )
      .orderBy(mailJobs.runAfter, mailJobs.id)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return false;
    const attempts = job.attempts + 1;
    try {
      if (job.expiresAt <= new Date()) throw new Error("expired");
      const { to, text } = JSON.parse(decryptSecret(job.payload || "") || "{}");
      if (typeof to !== "string" || typeof text !== "string")
        throw new Error("unavailable");
      await send({
        to,
        text,
        subject: `OpsPilot · ${subjects[job.kind]}`,
        messageId: `<opspilot-${job.id}@${new URL(process.env.APP_ORIGIN || "http://localhost").hostname}>`,
      });
      await tx
        .update(mailJobs)
        .set({
          status: "sent",
          payload: null,
          finishedAt: new Date(),
          attempts,
        })
        .where(eq(mailJobs.id, job.id));
    } catch {
      const terminal = attempts >= 5 || job.expiresAt <= new Date();
      await tx
        .update(mailJobs)
        .set({
          status: terminal ? "failed" : "queued",
          attempts,
          payload: terminal ? null : job.payload,
          finishedAt: terminal ? new Date() : null,
          runAfter: sql`now() + ${Math.min(1800, 30 * 2 ** attempts)} * interval '1 second'`,
        })
        .where(eq(mailJobs.id, job.id));
    }
    return true;
  });
}
