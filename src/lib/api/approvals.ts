import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "./client";

const PendingApprovalSchema = z.object({
  sessionId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  toolName: z.union([z.literal("ExitPlanMode"), z.literal("AskUserQuestion")]),
  toolUseId: z.string(),
  blockedSince: z.string(),
  planFilename: z.string().nullable(),
  questionPreview: z.string().nullable(),
});

export const ApprovalsResponse = z.object({
  approvals: z.array(PendingApprovalSchema),
});

export const approvalsQueryOptions = () =>
  queryOptions({
    queryKey: ["approvals"] as const,
    queryFn: () => apiFetch("/api/approvals", ApprovalsResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });

export const projectApprovalsQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: ["approvals", projectId] as const,
    queryFn: () =>
      apiFetch(`/api/approvals?projectId=${encodeURIComponent(projectId)}`, ApprovalsResponse),
    staleTime: Infinity,
    gcTime: Infinity,
  });
