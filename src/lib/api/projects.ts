import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";
import { JsonValueSchema } from "../schemas";

const ProjectListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectPath: z.string().nullable(),
  sessionCount: z.number(),
  memoryCount: z.number(),
  planCount: z.number(),
  taskCount: z.number(),
  activeCount: z.number(),
  lastActivity: z.string(),
});
export const ProjectListResponse = z.array(ProjectListItemSchema);

export const projectsQueryOptions = () =>
  queryOptions({
    queryKey: ["projects"] as const,
    queryFn: () => apiFetch("/api/projects", ProjectListResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const ProjectDetailResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    projectPath: z.string().nullable(),
    subagentCount: z.number(),
  })
  .nullable();

export const projectDetailQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id] as const,
    queryFn: () => apiFetch(`/api/projects/${encodeURIComponent(id)}`, ProjectDetailResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

const ProjectSessionItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  mtime: z.string(),
  created: z.string(),
  messageCount: z.number(),
  gitBranch: z.string().optional(),
  subagentCount: z.number(),
});
export const ProjectSessionListResponse = z.array(ProjectSessionItemSchema);

export const projectSessionsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id, "sessions"] as const,
    queryFn: () =>
      apiFetch(`/api/projects/${encodeURIComponent(id)}/sessions`, ProjectSessionListResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

const BranchItemSchema = z.object({
  branch: z.string(),
  sessionCount: z.number(),
  lastActivity: z.string(),
});
export const ProjectBranchListResponse = z.array(BranchItemSchema);

export const projectBranchesQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id, "branches"] as const,
    queryFn: () =>
      apiFetch(`/api/projects/${encodeURIComponent(id)}/branches`, ProjectBranchListResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

const ProjectSubagentSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  projectId: z.string(),
  parentAgentId: z.string().nullable(),
  agentType: z.string().nullable(),
  slug: z.string().nullable(),
  description: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export const ProjectSubagentsResponse = z.array(ProjectSubagentSchema);

export const projectSubagentsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id, "subagents"] as const,
    queryFn: () =>
      apiFetch(`/api/projects/${encodeURIComponent(id)}/subagents`, ProjectSubagentsResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

const ProjectPlanItemSchema = z.object({
  filename: z.string(),
  title: z.string(),
  mtime: z.string().nullable(),
  sessionId: z.string(),
});
export const ProjectPlanListResponse = z.array(ProjectPlanItemSchema);

export const projectPlansQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id, "plans"] as const,
    queryFn: () =>
      apiFetch(`/api/projects/${encodeURIComponent(id)}/plans`, ProjectPlanListResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

const TaskItemSchema = z.object({
  taskId: z.string(),
  projectDir: z.string(),
  subject: z.string(),
  description: z.string(),
  status: z.string(),
  activeForm: z.string().nullable(),
  owner: z.string().nullable(),
  blocks: z.array(z.string()),
  blockedBy: z.array(z.string()),
  metadata: z.record(z.string(), JsonValueSchema),
});

const TaskCountsSchema = z.object({
  total: z.number(),
  pending: z.number(),
  inProgress: z.number(),
  completed: z.number(),
});

export const ProjectTasksResponse = z.object({
  todos: z.array(TaskItemSchema),
  todoCounts: TaskCountsSchema,
});

export const projectTasksQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["projects", id, "tasks"] as const,
    queryFn: () => apiFetch(`/api/projects/${encodeURIComponent(id)}/tasks`, ProjectTasksResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });
