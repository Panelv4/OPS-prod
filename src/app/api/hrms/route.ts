import { readJson } from "@/lib/http";
import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  attendanceRecords,
  employees,
  leaveRequests,
  payrollRuns,
  transactions,
  users,
  workspaceMembers,
} from "@/db/schema";
import { ApiError, handleApiError, requireAuth } from "@/lib/auth";
import {
  calculatePayroll,
  formatMoney,
  PAYROLL_JURISDICTIONS,
  toCents,
} from "@/lib/finance";
import { generateSecureToken, sanitizeText } from "@/lib/security";
import { createNotification, recordAuditLog } from "@/lib/audit";
import { dispatchWorkflowEvent } from "@/lib/automation";

export async function GET(request: Request) {
  try {
    const ctx = await requireAuth(request);
    if (
      !ctx.permissions.has("hrms:view") &&
      !ctx.permissions.has("hrms:payroll")
    ) {
      throw new ApiError(403, "Missing HRMS access permission.");
    }
    const tId = ctx.tenantId;
    const url = new URL(request.url);
    const payslipIdParam = url.searchParams.get("payslipId");

    const canConfidential =
      ctx.permissions.has("hrms:confidential") ||
      ctx.permissions.has("hrms:payroll");

    if (payslipIdParam) {
      const payslipId = Number(payslipIdParam);
      const [run] = await db
        .select()
        .from(payrollRuns)
        .where(
          and(eq(payrollRuns.id, payslipId), eq(payrollRuns.tenantId, tId)),
        )
        .limit(1);
      if (!run) throw new ApiError(404, "Payslip not found in workspace.");
      const [emp] = await db
        .select()
        .from(employees)
        .where(
          and(eq(employees.id, run.employeeId), eq(employees.tenantId, tId)),
        )
        .limit(1);
      if (!emp) throw new ApiError(404, "Employee not found.");
      if (!canConfidential && emp.userId !== ctx.user.id) {
        throw new ApiError(
          403,
          "Not authorized to inspect this confidential payslip.",
        );
      }
      return NextResponse.json({
        payslip: run,
        employee: {
          ...emp,
          confidentialNotes: ctx.permissions.has("hrms:confidential")
            ? emp.confidentialNotes
            : null,
        },
        tenant: {
          name: ctx.tenant.name,
          address: ctx.tenant.address,
          taxId: ctx.tenant.taxId,
          currency: ctx.tenant.currency,
        },
      });
    }

    const [empRows, attRows, leaveRows, payrollRows] = await Promise.all([
      db
        .select()
        .from(employees)
        .where(eq(employees.tenantId, tId))
        .orderBy(employees.employeeCode),
      db
        .select({
          id: attendanceRecords.id,
          employeeId: attendanceRecords.employeeId,
          employeeName: employees.fullName,
          department: employees.department,
          date: attendanceRecords.date,
          checkInTime: attendanceRecords.checkInTime,
          checkOutTime: attendanceRecords.checkOutTime,
          status: attendanceRecords.status,
          workMinutes: attendanceRecords.workMinutes,
          notes: attendanceRecords.notes,
        })
        .from(attendanceRecords)
        .innerJoin(employees, eq(attendanceRecords.employeeId, employees.id))
        .where(eq(attendanceRecords.tenantId, tId))
        .orderBy(desc(attendanceRecords.date), desc(attendanceRecords.id))
        .limit(100),
      db
        .select({
          id: leaveRequests.id,
          employeeId: leaveRequests.employeeId,
          employeeName: employees.fullName,
          department: employees.department,
          leaveType: leaveRequests.leaveType,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          days: leaveRequests.days,
          reason: leaveRequests.reason,
          status: leaveRequests.status,
          reviewerName: leaveRequests.reviewerName,
          createdAt: leaveRequests.createdAt,
        })
        .from(leaveRequests)
        .innerJoin(employees, eq(leaveRequests.employeeId, employees.id))
        .where(eq(leaveRequests.tenantId, tId))
        .orderBy(desc(leaveRequests.createdAt)),
      canConfidential
        ? db
            .select({
              id: payrollRuns.id,
              employeeId: payrollRuns.employeeId,
              employeeName: employees.fullName,
              employeeCode: employees.employeeCode,
              department: employees.department,
              period: payrollRuns.period,
              jurisdiction: payrollRuns.jurisdiction,
              statutoryLabel: payrollRuns.statutoryLabel,
              baseSalaryCents: payrollRuns.baseSalaryCents,
              allowancesCents: payrollRuns.allowancesCents,
              statutoryDeductionCents: payrollRuns.statutoryDeductionCents,
              taxDeductionCents: payrollRuns.taxDeductionCents,
              netPayCents: payrollRuns.netPayCents,
              status: payrollRuns.status,
              paidAt: payrollRuns.paidAt,
            })
            .from(payrollRuns)
            .innerJoin(employees, eq(payrollRuns.employeeId, employees.id))
            .where(eq(payrollRuns.tenantId, tId))
            .orderBy(desc(payrollRuns.period), employees.employeeCode)
        : Promise.resolve([]),
    ]);

    // Protect confidential salary & HR notes for regular roles
    const safeEmployees = empRows.map((e) => {
      const isSelf = e.userId === ctx.user.id;
      if (canConfidential || isSelf) {
        return {
          ...e,
          confidentialNotes: ctx.permissions.has("hrms:confidential")
            ? e.confidentialNotes
            : null,
          salaryRedacted: false,
        };
      }
      return {
        ...e,
        baseSalaryCents: 0,
        allowancesCents: 0,
        deductionsCents: 0,
        taxRateBps: 0,
        confidentialNotes: null,
        salaryRedacted: true,
      };
    });

    return NextResponse.json({
      currency: ctx.tenant.currency,
      canConfidential,
      canPayroll: ctx.permissions.has("hrms:payroll"),
      canWrite: ctx.permissions.has("hrms:write"),
      jurisdictions: Object.values(PAYROLL_JURISDICTIONS),
      employees: safeEmployees,
      attendance: ctx.permissions.has("hrms:write")
        ? attRows
        : attRows.filter((a) =>
            empRows.some(
              (e) => e.id === a.employeeId && e.userId === ctx.user.id,
            ),
          ),
      leaves: ctx.permissions.has("hrms:write")
        ? leaveRows
        : leaveRows.filter((l) =>
            empRows.some(
              (e) => e.id === l.employeeId && e.userId === ctx.user.id,
            ),
          ),
      payroll: payrollRows,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const hrmsPostSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create_employee"),
    fullName: z.string().min(2).max(120),
    email: z.string().email().max(150),
    phone: z.string().max(40).optional(),
    department: z.string().min(2).max(80),
    designation: z.string().min(2).max(100),
    joiningDate: z.string().optional(),
    employmentStatus: z
      .enum(["active", "probation", "on_leave", "terminated"])
      .default("active"),
    managerName: z.string().max(100).optional(),
    jurisdiction: z.enum(["IN", "US", "GB", "SG", "AE"]),
    baseSalary: z.number().min(0).default(0),
    allowances: z.number().min(0).default(0),
    deductions: z.number().min(0).default(0),
    taxRateBps: z.number().int().min(0).max(5000),
    confidentialNotes: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("attendance"),
    employeeId: z.number().int().positive(),
    mode: z.enum(["check_in", "check_out", "mark_absent"]),
    date: z.iso.date().optional(),
    time: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    workMode: z.enum(["present", "remote", "late"]).optional(),
    notes: z.string().max(240).optional(),
  }),
  z.object({
    action: z.literal("request_leave"),
    employeeId: z.number().int().positive(),
    leaveType: z.enum(["annual", "sick", "casual", "unpaid"]).default("annual"),
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    days: z.number().int().min(1).max(60),
    reason: z.string().min(3).max(400),
  }),
  z.object({
    action: z.literal("run_payroll"),
    period: z.string().regex(/^\d{4}-\d{2}$/),
    jurisdictionOverride: z.enum(["IN", "US", "GB", "SG", "AE"]).optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    const ctx = await requireAuth(request);
    const body = hrmsPostSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    return await db.transaction(async (tx) => {
      if (body.action === "create_employee") {
        if (!ctx.permissions.has("hrms:write")) {
          throw new ApiError(403, "Missing hrms:write permission.");
        }
        const existing = await tx
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.tenantId, tId));
        const code = `EMP-${String(existing.length + 1).padStart(3, "0")}-${generateSecureToken(
          1,
        ).toUpperCase()}`;

        const [linked] = await tx
          .select({ id: users.id })
          .from(users)
          .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
          .where(
            and(
              eq(workspaceMembers.tenantId, tId),
              eq(workspaceMembers.status, "active"),
              eq(users.email, body.email.toLowerCase().trim()),
            ),
          )
          .limit(1);
        const [emp] = await tx
          .insert(employees)
          .values({
            tenantId: tId,
            employeeCode: code,
            userId: linked?.id,
            fullName: sanitizeText(body.fullName),
            email: body.email.trim().toLowerCase(),
            phone: body.phone ? sanitizeText(body.phone) : null,
            department: sanitizeText(body.department),
            designation: sanitizeText(body.designation),
            joiningDate:
              body.joiningDate || new Date().toISOString().slice(0, 10),
            employmentStatus: body.employmentStatus,
            managerName: body.managerName
              ? sanitizeText(body.managerName)
              : null,
            jurisdiction: body.jurisdiction,
            baseSalaryCents: toCents(body.baseSalary),
            allowancesCents: toCents(body.allowances),
            deductionsCents: toCents(body.deductions),
            taxRateBps: body.taxRateBps,
            confidentialNotes: body.confidentialNotes
              ? sanitizeText(body.confidentialNotes)
              : null,
          })
          .returning();

        await recordAuditLog(
          {
            tenantId: tId,
            userId: ctx.user.id,
            actorName: ctx.user.fullName,
            action: "employee.created",
            module: "hrms",
            entityType: "employee",
            entityId: emp.id,
            summary: `Onboarded employee ${emp.fullName} (${emp.designation}, ${emp.department})`,
            ipAddress: ctx.ipAddress,
          },
          tx,
        );

        return NextResponse.json({ employee: emp }, { status: 201 });
      }

      if (body.action === "attendance") {
        if (!ctx.permissions.has("hrms:view")) {
          throw new ApiError(403, "Missing hrms:view permission.");
        }
        const [emp] = await tx
          .select()
          .from(employees)
          .where(
            and(eq(employees.id, body.employeeId), eq(employees.tenantId, tId)),
          )
          .limit(1)
          .for("update");
        if (!emp)
          throw new ApiError(404, "Employee not found in this workspace.");

        if (emp.userId !== ctx.user.id && !ctx.permissions.has("hrms:write"))
          throw new ApiError(403, "Self-service attendance only.");
        if (body.mode === "mark_absent" && !ctx.permissions.has("hrms:write"))
          throw new ApiError(403, "Only HR editors can mark absence.");
        const now = new Date().toISOString();
        const date = body.date || now.slice(0, 10);
        const nowTime = body.time || now.slice(11, 16);

        const [existingAtt] = await tx
          .select()
          .from(attendanceRecords)
          .where(
            and(
              eq(attendanceRecords.tenantId, tId),
              eq(attendanceRecords.employeeId, emp.id),
              eq(attendanceRecords.date, date),
            ),
          )
          .limit(1);

        if (body.mode === "check_out" && !existingAtt?.checkInTime)
          throw new ApiError(400, "Check in before checking out.");
        if (body.mode === "check_out" && existingAtt) {
          if (existingAtt.checkOutTime)
            throw new ApiError(
              409,
              "This attendance interval is already complete.",
            );
          const minutes = (time: string) =>
            Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
          const duration = minutes(nowTime) - minutes(existingAtt.checkInTime!);
          if (duration < 0)
            throw new ApiError(400, "Checkout cannot precede check-in.");
          const [updated] = await tx
            .update(attendanceRecords)
            .set({
              checkOutTime: nowTime,
              workMinutes: duration,
            })
            .where(
              and(
                eq(attendanceRecords.id, existingAtt.id),
                eq(attendanceRecords.tenantId, tId),
              ),
            )
            .returning();
          return NextResponse.json({ attendance: updated });
        }

        // Never overwrite an open or completed interval on a retry or a later mark-absent request.
        if (existingAtt?.checkInTime)
          throw new ApiError(
            409,
            "A check-in is already recorded for this day.",
          );
        if (
          existingAtt?.status === "absent" &&
          !ctx.permissions.has("hrms:write")
        )
          throw new ApiError(409, "Ask an HR editor to correct this absence.");
        const computedStatus =
          body.mode === "mark_absent" ? "absent" : (body.workMode ?? "present");

        if (existingAtt) {
          const [updated] = await tx
            .update(attendanceRecords)
            .set({
              checkInTime: body.mode === "mark_absent" ? null : nowTime,
              status: computedStatus,
              checkOutTime: null,
              workMinutes: 0,
              notes: body.notes ? sanitizeText(body.notes) : existingAtt.notes,
            })
            .where(
              and(
                eq(attendanceRecords.id, existingAtt.id),
                eq(attendanceRecords.tenantId, tId),
              ),
            )
            .returning();
          return NextResponse.json({ attendance: updated });
        }

        const [created] = await tx
          .insert(attendanceRecords)
          .values({
            tenantId: tId,
            employeeId: emp.id,
            date,
            checkInTime: body.mode === "mark_absent" ? null : nowTime,
            status: computedStatus,
            workMinutes: 0,
            notes: body.notes ? sanitizeText(body.notes) : null,
          })
          .returning();

        return NextResponse.json({ attendance: created }, { status: 201 });
      }

      if (body.action === "request_leave") {
        if (!ctx.permissions.has("hrms:view")) {
          throw new ApiError(403, "Missing hrms:view permission.");
        }
        const [emp] = await tx
          .select()
          .from(employees)
          .where(
            and(eq(employees.id, body.employeeId), eq(employees.tenantId, tId)),
          )
          .limit(1);
        if (!emp) throw new ApiError(404, "Employee not found in workspace.");

        if (emp.userId !== ctx.user.id && !ctx.permissions.has("hrms:write"))
          throw new ApiError(403, "Self-service leave only.");
        if (body.endDate < body.startDate)
          throw new ApiError(400, "Leave ends before it starts.");
        const [leave] = await tx
          .insert(leaveRequests)
          .values({
            tenantId: tId,
            employeeId: emp.id,
            leaveType: body.leaveType,
            startDate: body.startDate,
            endDate: body.endDate,
            days: body.days,
            reason: sanitizeText(body.reason),
            status: "pending",
          })
          .returning();

        await dispatchWorkflowEvent(
          {
            tenantId: tId,
            triggerEvent: "leave.requested",
            payload: {
              leaveId: leave.id,
              employeeName: emp.fullName,
              leaveType: leave.leaveType,
              days: leave.days,
              startDate: leave.startDate,
              link: "/app/hrms",
            },
            userId: ctx.user.id,
          },
          tx,
        );

        return NextResponse.json({ leave }, { status: 201 });
      }

      // run_payroll
      if (!ctx.permissions.has("hrms:payroll")) {
        throw new ApiError(403, "Missing hrms:payroll permission.");
      }

      const activeEmps = await tx
        .select()
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, tId),
            eq(employees.employmentStatus, "active"),
          ),
        );

      const existingRuns = await tx
        .select({ employeeId: payrollRuns.employeeId })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.tenantId, tId),
            eq(payrollRuns.period, body.period),
          ),
        );
      const processedSet = new Set(existingRuns.map((r) => r.employeeId));

      const createdRuns = [];
      for (const emp of activeEmps) {
        if (processedSet.has(emp.id)) continue;
        const calc = calculatePayroll({
          baseSalaryCents: emp.baseSalaryCents,
          allowancesCents: emp.allowancesCents,
          customDeductionsCents: emp.deductionsCents,
          taxRateBps: emp.taxRateBps,
          jurisdiction: body.jurisdictionOverride || emp.jurisdiction,
        });

        const [run] = await tx
          .insert(payrollRuns)
          .values({
            tenantId: tId,
            employeeId: emp.id,
            period: body.period,
            jurisdiction: calc.jurisdiction,
            statutoryLabel: calc.statutoryLabel,
            baseSalaryCents: emp.baseSalaryCents,
            allowancesCents: emp.allowancesCents,
            statutoryDeductionCents: calc.statutoryDeductionCents,
            taxDeductionCents: calc.taxDeductionCents,
            netPayCents: calc.netPayCents,
            status: "processed",
          })
          .returning();
        createdRuns.push(run);
      }

      await recordAuditLog(
        {
          tenantId: tId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "payroll.processed",
          module: "hrms",
          entityType: "payroll",
          summary: `Generated ${createdRuns.length} payslip(s) for period ${body.period}`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json(
        { createdCount: createdRuns.length, runs: createdRuns },
        { status: 201 },
      );
    });
  } catch (err) {
    return handleApiError(err);
  }
}

const hrmsPatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("review_leave"),
    leaveId: z.number().int().positive(),
    decision: z.enum(["approved", "rejected"]),
  }),
  z.object({
    action: z.literal("pay_payslip"),
    payrollId: z.number().int().positive(),
  }),
]);

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAuth(request);
    const body = hrmsPatchSchema.parse(await readJson(request));
    const tId = ctx.tenantId;

    return await db.transaction(async (tx) => {
      if (body.action === "review_leave") {
        if (!ctx.permissions.has("hrms:write")) {
          throw new ApiError(
            403,
            "Missing hrms:write permission to review leave.",
          );
        }
        const [leave] = await tx
          .select()
          .from(leaveRequests)
          .where(
            and(
              eq(leaveRequests.id, body.leaveId),
              eq(leaveRequests.tenantId, tId),
            ),
          )
          .limit(1)
          .for("update");
        if (!leave) throw new ApiError(404, "Leave request not found.");

        const [updated] = await tx
          .update(leaveRequests)
          .set({
            status: body.decision,
            reviewerName: ctx.user.fullName,
            reviewedAt: new Date(),
          })
          .where(
            and(
              eq(leaveRequests.id, leave.id),
              eq(leaveRequests.tenantId, tId),
            ),
          )
          .returning();

        if (body.decision === "approved" && leave.status === "pending") {
          const [emp] = await tx
            .select()
            .from(employees)
            .where(
              and(
                eq(employees.id, leave.employeeId),
                eq(employees.tenantId, tId),
              ),
            )
            .limit(1)
            .for("update");
          if (emp) {
            const updates: Partial<typeof employees.$inferInsert> = {};
            if (leave.leaveType === "annual") {
              updates.leaveBalanceAnnual = Math.max(
                0,
                emp.leaveBalanceAnnual - leave.days,
              );
            } else if (leave.leaveType === "sick") {
              updates.leaveBalanceSick = Math.max(
                0,
                emp.leaveBalanceSick - leave.days,
              );
            }
            if (Object.keys(updates).length > 0) {
              await tx
                .update(employees)
                .set(updates)
                .where(
                  and(eq(employees.id, emp.id), eq(employees.tenantId, tId)),
                );
            }
            await createNotification(
              {
                tenantId: tId,
                userId: emp.userId,
                targetRole: emp.userId ? null : "hr_manager",
                title: `Leave Request ${body.decision === "approved" ? "Approved" : "Rejected"}`,
                message: `${emp.fullName}'s ${leave.days}-day ${leave.leaveType} leave was approved by ${ctx.user.fullName}.`,
                type: "success",
                link: "/app/hrms",
              },
              tx,
            );
          }
        }

        return NextResponse.json({ leave: updated });
      }

      // pay_payslip -> posts immutable payroll transaction in Finance ledger
      if (!ctx.permissions.has("hrms:payroll")) {
        throw new ApiError(403, "Missing hrms:payroll permission.");
      }
      const [run] = await tx
        .select()
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.id, body.payrollId),
            eq(payrollRuns.tenantId, tId),
          ),
        )
        .limit(1)
        .for("update");
      if (!run) throw new ApiError(404, "Payroll run not found.");
      if (run.status === "paid") {
        throw new ApiError(400, "Payslip has already been disbursed.");
      }

      const [emp] = await tx
        .select()
        .from(employees)
        .where(
          and(eq(employees.id, run.employeeId), eq(employees.tenantId, tId)),
        )
        .limit(1);

      const [posting] = await tx
        .insert(transactions)
        .values({
          tenantId: tId,
          entryNumber: `PAY-${generateSecureToken(4).toUpperCase()}`,
          type: "payroll",
          direction: "debit",
          category: "Payroll & Benefits",
          amountCents: run.netPayCents,
          paymentMethod: "Bank Transfer",
          transactionDate: new Date().toISOString().slice(0, 10),
          description: `Salary payout (${run.period}) — ${emp?.fullName || "Employee"}`,
          status: "posted",
          actorName: ctx.user.fullName,
          createdByUserId: ctx.user.id,
        })
        .returning();

      const [updated] = await tx
        .update(payrollRuns)
        .set({
          status: "paid",
          paidAt: new Date(),
          transactionId: posting.id,
        })
        .where(and(eq(payrollRuns.id, run.id), eq(payrollRuns.tenantId, tId)))
        .returning();

      await recordAuditLog(
        {
          tenantId: tId,
          userId: ctx.user.id,
          actorName: ctx.user.fullName,
          action: "payroll.paid",
          module: "hrms",
          entityType: "payroll",
          entityId: run.id,
          summary: `Disbursed ${formatMoney(run.netPayCents, ctx.tenant.currency)} net salary for ${
            emp?.fullName || "employee"
          } (${run.period})`,
          ipAddress: ctx.ipAddress,
        },
        tx,
      );

      return NextResponse.json({ payroll: updated, transaction: posting });
    });
  } catch (err) {
    return handleApiError(err);
  }
}
