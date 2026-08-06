import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";

/**
 * Response shape mirroring the `HerdrPaneLink` interface produced by
 * `getHerdrPanes` (`../herdr/panes`). This ccp-owned boundary is strict so
 * drift between the producer and browser consumer fails loudly.
 */
const HerdrPaneSchema = z
  .object({
    paneId: z.string(),
    terminalId: z.string(),
    workspaceId: z.string(),
    tabId: z.string(),
    focused: z.boolean(),
    cwd: z.string().nullable(),
    foregroundCwd: z.string().nullable(),
    agentStatus: z.string(),
    agent: z.string().nullable(),
    terminalTitle: z.string().nullable(),
    agentSessionId: z.string().nullable(),
    revision: z.number(),
    sessionId: z.string(),
    via: z.enum(["env", "agent-session", "both"]),
  })
  .strict();

export const HerdrPaneListResponse = z.array(HerdrPaneSchema);

export const herdrPanesQueryOptions = queryOptions({
  queryKey: ["herdr", "panes"] as const,
  queryFn: () => apiFetch("/api/herdr-panes", HerdrPaneListResponse),
});
