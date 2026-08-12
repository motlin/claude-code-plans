import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

/**
 * Response shapes mirroring the `HerdrWorkspaceTree` read model produced by
 * `getHerdrWorkspaceTree` (`../herdr/workspaces`). Herdr's own wire schemas are
 * loose because its protocol drifts between releases; this ccp-owned boundary
 * is strict so drift between the producer and browser consumer fails loudly.
 */
const HerdrWorkspacePaneSchema = z
  .object({
    paneId: z.string(),
    title: z.string(),
    agent: z.string().nullable(),
    agentStatus: z.string(),
    sessionId: z.string().nullable(),
  })
  .strict();

export type HerdrWorkspacePaneData = z.infer<typeof HerdrWorkspacePaneSchema>;

const HerdrWorkspaceSchema = z
  .object({
    workspaceId: z.string(),
    number: z.number(),
    label: z.string(),
    agentStatus: z.string(),
    worktreeName: z.string().nullable(),
    agentPanes: z.array(HerdrWorkspacePaneSchema),
    shellPanes: z.array(HerdrWorkspacePaneSchema),
  })
  .strict();

export type HerdrWorkspaceData = z.infer<typeof HerdrWorkspaceSchema>;

export const HerdrWorkspaceIndexResponse = z
  .object({ workspaces: z.array(HerdrWorkspaceSchema) })
  .strict();

export const herdrWorkspacesQueryOptions = queryOptions({
  queryKey: ["herdr", "workspaces"] as const,
  queryFn: () => apiFetch("/api/herdr-workspaces", HerdrWorkspaceIndexResponse),
});
