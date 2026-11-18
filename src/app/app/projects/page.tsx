"use client";
import { useLoadEffect } from "@/components/providers/useLoadEffect";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  LayoutGrid,
  List,
  Calendar as CalendarIcon,
  MessageSquare,
} from "lucide-react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import { Modal, PageHeader, StatusPill } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/finance";

const TASK_COLS = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "In Review" },
  { id: "done", label: "Done" },
];

interface ProjectRow {
  loggedMinutes: number;
  customerId: number | null;
  billedCents: number | null;
  dueCents: number | null;
  netCashCents: number | null;
  id: number;
  code: string;
  name: string;
  description: string | null;
  clientCompany: string | null;
  budgetCents: number;
  spentCents: number;
  status: string;
  deadline: string;
  teamMembers: string[];
  totalTasks: number;
  completedTasks: number;
  progressPct: number;
}

interface TaskRow {
  id: number;
  projectId: number | null;
  projectName: string | null;
  title: string;
  description: string | null;
  assigneeName: string | null;
  priority: string;
  status: string;
  dueDate: string | null;
}

interface CommentRow {
  id: number;
  authorName: string;
  content: string;
  createdAt: string;
}

export default function ProjectsPage() {
  const searchParams = useSearchParams();
  const { apiFetch, can, toast, refreshSession } = useWorkspace();
  const [currency, setCurrency] = useState("INR");
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [clients, setClients] = useState<
    Array<{ id: number; company: string }>
  >([]);

  const [view, setView] = useState<"kanban" | "list" | "calendar">("kanban");
  const [projectFilter, setProjectFilter] = useState("all");

  const [projModal, setProjModal] = useState(
    searchParams.get("new") === "project",
  );
  const [taskModal, setTaskModal] = useState(
    searchParams.get("new") === "task",
  );
  const [activeTask, setActiveTask] = useState<TaskRow | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [newComment, setNewComment] = useState("");

  const [projForm, setProjForm] = useState(() => ({
    name: "",
    description: "",
    customerId: "",
    budget: "500000",
    deadline: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    teamMembers: "",
  }));

  const [taskForm, setTaskForm] = useState(() => ({
    projectId: "",
    title: "",
    description: "",
    assigneeName: "",
    priority: "high",
    status: "todo",
    dueDate: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
  }));

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{
        currency: string;
        projects: ProjectRow[];
        tasks: TaskRow[];
        clients: Array<{ id: number; company: string }>;
      }>("/api/projects");
      setCurrency(res.currency);
      setProjects(res.projects);
      setTasks(res.tasks);
      setClients(res.clients);
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to load projects",
        "error",
      );
    }
  }, [apiFetch, toast]);

  useLoadEffect(load);

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          action: "create_project",
          name: projForm.name,
          description: projForm.description,
          customerId: projForm.customerId ? Number(projForm.customerId) : null,
          budget: Number(projForm.budget) || 0,
          deadline: projForm.deadline,
          teamMembers: projForm.teamMembers
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      });
      setProjModal(false);
      setProjForm((p) => ({
        ...p,
        name: "",
        description: "",
        teamMembers: "",
      }));
      toast("Project created");
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          action: "create_task",
          ...taskForm,
          projectId: taskForm.projectId ? Number(taskForm.projectId) : null,
        }),
      });
      setTaskModal(false);
      setTaskForm((p) => ({ ...p, title: "", description: "" }));
      toast("Task created & team notified");
      await load();
      await refreshSession();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const updateTaskStatus = async (id: number, status: string) => {
    try {
      await apiFetch("/api/projects", {
        method: "PATCH",
        body: JSON.stringify({ entity: "task", id, status }),
      });
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const openTaskComments = async (t: TaskRow) => {
    setActiveTask(t);
    try {
      const res = await apiFetch<{ comments: CommentRow[] }>(
        `/api/projects?taskId=${t.id}`,
      );
      setComments(res.comments);
    } catch {
      setComments([]);
    }
  };

  const postComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTask || !newComment.trim()) return;
    try {
      await apiFetch("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          action: "add_comment",
          taskId: activeTask.id,
          content: newComment,
        }),
      });
      setNewComment("");
      openTaskComments(activeTask);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Error", "error");
    }
  };

  const visibleTasks =
    projectFilter === "all"
      ? tasks
      : tasks.filter((t) => String(t.projectId) === projectFilter);

  // Group tasks by dueDate for Calendar view
  const tasksByDate = visibleTasks.reduce<Record<string, TaskRow[]>>(
    (acc, t) => {
      const key = t.dueDate || "Unscheduled";
      acc[key] = acc[key] || [];
      acc[key].push(t);
      return acc;
    },
    {},
  );
  const sortedDates = Object.keys(tasksByDate).sort();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects & Task Management"
        description="Client delivery budgets, Kanban boards, list tables, deadline calendar & collaboration"
        actions={
          can("projects:write") && (
            <>
              <button
                type="button"
                onClick={() => setProjModal(true)}
                className="op-btn-secondary text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                New Project
              </button>
              <button
                type="button"
                onClick={() => setTaskModal(true)}
                className="op-btn-primary text-xs"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Task
              </button>
            </>
          )
        }
      />

      {/* Projects Portfolio Grid */}
      <div className="grid gap-4 md:grid-cols-3">
        {projects.map((p) => (
          <div key={p.id} className="op-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-[11px] text-slate-400">
                  {p.code}
                </span>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                  {p.name}
                </h3>
                {p.clientCompany && (
                  <p className="text-xs text-slate-500">{p.clientCompany}</p>
                )}
              </div>
              <StatusPill status={p.status} />
            </div>
            <div className="mt-3 flex justify-between text-xs text-slate-600 tabular dark:text-slate-400">
              <span>
                Budget: {formatMoney(p.spentCents, currency, true)} /{" "}
                {formatMoney(p.budgetCents, currency, true)}
              </span>
              <span>Due {p.deadline}</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-indigo-600"
                style={{ width: `${p.progressPct}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
              <span>
                {p.completedTasks}/{p.totalTasks} tasks complete
              </span>
              <span>{(p.teamMembers || []).slice(0, 2).join(", ")}</span>
            </div>
            <p className="mt-3 text-xs">
              Recorded project time: {Math.floor(p.loggedMinutes / 60)}h{" "}
              {p.loggedMinutes % 60}m
            </p>
            {p.billedCents !== null && (
              <p className="text-xs">
                Invoiced: {formatMoney(p.billedCents, currency)} · To collect:{" "}
                {formatMoney(p.dueCents || 0, currency)}
              </p>
            )}
            {p.netCashCents !== null && (
              <p
                className="text-xs"
                title="Posted project inflows less outflows. Excludes unallocated expenses and labor; not profit."
              >
                Net recorded project cash:{" "}
                {formatMoney(p.netCashCents, currency)}
              </p>
            )}
            {p.customerId && can("sales:write") && (
              <Link
                className="mt-2 inline-block text-xs underline"
                href={`/app/sales?new=invoice&customer=${p.customerId}&project=${p.id}`}
              >
                Invoice this engagement
              </Link>
            )}
            {can("projects:write") && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const minutes = Number(new FormData(form).get("minutes"));
                  try {
                    await apiFetch("/api/projects", {
                      method: "POST",
                      body: JSON.stringify({
                        action: "log_time",
                        projectId: p.id,
                        minutes,
                        workDate: new Date().toISOString().slice(0, 10),
                      }),
                    });
                    form.reset();
                    await load();
                  } catch (err) {
                    toast(
                      err instanceof Error ? err.message : "Unable to log time",
                      "error",
                    );
                  }
                }}
              >
                <input
                  className="op-input"
                  type="number"
                  min="1"
                  max="1440"
                  name="minutes"
                  required
                  aria-label={`Minutes on ${p.name} today`}
                  placeholder="Minutes today"
                />
                <button className="op-btn-secondary shrink-0">Log time</button>
              </form>
            )}
          </div>
        ))}
      </div>

      {/* View Switcher & Project Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-800">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs dark:border-slate-800 dark:bg-slate-900">
          {[
            { id: "kanban", label: "Kanban", icon: LayoutGrid },
            { id: "list", label: "List", icon: List },
            { id: "calendar", label: "Calendar", icon: CalendarIcon },
          ].map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id as "kanban" | "list" | "calendar")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-medium ${
                  view === v.id
                    ? "bg-white text-slate-900 shadow-2xs dark:bg-slate-800 dark:text-white"
                    : "text-slate-500"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {v.label}
              </button>
            );
          })}
        </div>

        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="op-input w-auto text-xs"
        >
          <option value="all">All Projects ({tasks.length} tasks)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {/* Kanban View */}
      {view === "kanban" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {TASK_COLS.map((col) => {
            const colTasks = visibleTasks.filter((t) => t.status === col.id);
            return (
              <div
                key={col.id}
                className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-900/50"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900 dark:text-white">
                    {col.label}
                  </span>
                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-700 tabular dark:bg-slate-800 dark:text-slate-300">
                    {colTasks.length}
                  </span>
                </div>
                <div className="space-y-2.5">
                  {colTasks.map((t) => (
                    <div
                      key={t.id}
                      className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-[#111827]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-900 dark:text-white leading-snug">
                          {t.title}
                        </span>
                        <StatusPill status={t.priority} />
                      </div>
                      <div className="mt-1.5 text-[11px] text-slate-500">
                        {t.projectName} · {t.assigneeName || "Unassigned"}
                      </div>
                      {t.dueDate && (
                        <div className="mt-1 text-[11px] text-slate-400 tabular">
                          Due: {t.dueDate}
                        </div>
                      )}
                      <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                        <select
                          value={t.status}
                          onChange={(e) =>
                            updateTaskStatus(t.id, e.target.value)
                          }
                          className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] dark:border-slate-700 dark:bg-slate-800"
                        >
                          {TASK_COLS.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => openTaskComments(t)}
                          className="inline-flex items-center gap-1 text-[11px] text-indigo-600 hover:underline dark:text-indigo-400"
                        >
                          <MessageSquare className="h-3 w-3" /> Discuss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* List View */}
      {view === "list" && (
        <div className="op-card overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
              <tr>
                <th className="px-4 py-3">Task</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Deadline</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {visibleTasks.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-3 font-medium text-slate-900 dark:text-white">
                    <button
                      type="button"
                      onClick={() => openTaskComments(t)}
                      className="hover:underline text-left"
                    >
                      {t.title}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{t.projectName}</td>
                  <td className="px-4 py-3">{t.assigneeName || "—"}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.priority} />
                  </td>
                  <td className="px-4 py-3 tabular">{t.dueDate || "—"}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Calendar Schedule View */}
      {view === "calendar" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sortedDates.map((date) => (
            <div key={date} className="op-card p-4">
              <div className="mb-2 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
                <span className="text-xs font-semibold tabular text-slate-900 dark:text-white">
                  {date}
                </span>
                <span className="text-[11px] text-slate-400">
                  {tasksByDate[date].length} task(s)
                </span>
              </div>
              <div className="space-y-2">
                {tasksByDate[date].map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="truncate font-medium">{t.title}</span>
                    <StatusPill status={t.status} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      <Modal
        open={projModal}
        onClose={() => setProjModal(false)}
        title="Create Project"
        subtitle="Track budget, deadline, client and assigned delivery squad"
      >
        <form onSubmit={createProject} className="space-y-3">
          <div>
            <label htmlFor="projects-field-1" className="op-label">
              Project Name
            </label>
            <input
              id="projects-field-1"
              required
              value={projForm.name}
              onChange={(e) =>
                setProjForm({ ...projForm, name: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="projects-field-2" className="op-label">
                Client
              </label>
              <select
                id="projects-field-2"
                value={projForm.customerId}
                onChange={(e) =>
                  setProjForm({ ...projForm, customerId: e.target.value })
                }
                className="op-input"
              >
                <option value="">Internal</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="op-label">Budget ({currency})</label>
              <input
                type="number"
                min="0"
                value={projForm.budget}
                onChange={(e) =>
                  setProjForm({ ...projForm, budget: e.target.value })
                }
                className="op-input tabular"
              />
            </div>
            <div>
              <label htmlFor="projects-field-3" className="op-label">
                Deadline
              </label>
              <input
                id="projects-field-3"
                type="date"
                required
                value={projForm.deadline}
                onChange={(e) =>
                  setProjForm({ ...projForm, deadline: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div>
            <label htmlFor="projects-field-4" className="op-label">
              Team Members (comma separated)
            </label>
            <input
              id="projects-field-4"
              value={projForm.teamMembers}
              onChange={(e) =>
                setProjForm({ ...projForm, teamMembers: e.target.value })
              }
              placeholder="Dev Sharma, Sana Mirza"
              className="op-input"
            />
          </div>
          <div>
            <label htmlFor="projects-field-5" className="op-label">
              Description
            </label>
            <textarea
              id="projects-field-5"
              rows={2}
              value={projForm.description}
              onChange={(e) =>
                setProjForm({ ...projForm, description: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setProjModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Create Project
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Task Modal */}
      <Modal
        open={taskModal}
        onClose={() => setTaskModal(false)}
        title="Create Task"
        subtitle="Assign priority, deadline and team owner"
      >
        <form onSubmit={createTask} className="space-y-3">
          <div>
            <label htmlFor="projects-field-6" className="op-label">
              Task Title
            </label>
            <input
              id="projects-field-6"
              required
              value={taskForm.title}
              onChange={(e) =>
                setTaskForm({ ...taskForm, title: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="projects-field-7" className="op-label">
                Project
              </label>
              <select
                id="projects-field-7"
                value={taskForm.projectId}
                onChange={(e) =>
                  setTaskForm({ ...taskForm, projectId: e.target.value })
                }
                className="op-input"
              >
                <option value="">General Workspace</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="projects-field-8" className="op-label">
                Assignee Name
              </label>
              <input
                id="projects-field-8"
                value={taskForm.assigneeName}
                onChange={(e) =>
                  setTaskForm({ ...taskForm, assigneeName: e.target.value })
                }
                placeholder="Defaults to you"
                className="op-input"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="projects-field-9" className="op-label">
                Priority
              </label>
              <select
                id="projects-field-9"
                value={taskForm.priority}
                onChange={(e) =>
                  setTaskForm({ ...taskForm, priority: e.target.value })
                }
                className="op-input"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label htmlFor="projects-field-10" className="op-label">
                Deadline
              </label>
              <input
                id="projects-field-10"
                type="date"
                value={taskForm.dueDate}
                onChange={(e) =>
                  setTaskForm({ ...taskForm, dueDate: e.target.value })
                }
                className="op-input"
              />
            </div>
          </div>
          <div>
            <label htmlFor="projects-field-11" className="op-label">
              Details
            </label>
            <textarea
              id="projects-field-11"
              rows={2}
              value={taskForm.description}
              onChange={(e) =>
                setTaskForm({ ...taskForm, description: e.target.value })
              }
              className="op-input"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setTaskModal(false)}
              className="op-btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" className="op-btn-primary">
              Add Task
            </button>
          </div>
        </form>
      </Modal>

      {/* Task Collaboration & Comments Modal */}
      <Modal
        open={Boolean(activeTask)}
        onClose={() => setActiveTask(null)}
        title={activeTask?.title || ""}
        subtitle={`${activeTask?.projectName || ""} · Assigned to ${
          activeTask?.assigneeName || "Unassigned"
        }`}
      >
        {activeTask && (
          <div className="space-y-4">
            {activeTask.description && (
              <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                {activeTask.description}
              </p>
            )}
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className="rounded-lg border border-slate-200 p-2.5 text-xs dark:border-slate-800"
                >
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {c.authorName}
                  </div>
                  <p className="mt-0.5 text-slate-600 dark:text-slate-400">
                    {c.content}
                  </p>
                </div>
              ))}
              {comments.length === 0 && (
                <p className="text-xs text-slate-500">No comments yet.</p>
              )}
            </div>
            <form onSubmit={postComment} className="flex gap-2">
              <input
                required
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Write a team comment…"
                className="op-input text-xs"
              />
              <button type="submit" className="op-btn-primary text-xs shrink-0">
                Post
              </button>
            </form>
          </div>
        )}
      </Modal>
    </div>
  );
}
