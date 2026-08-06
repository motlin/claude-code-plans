import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { apiFetch } from "./client";
import { SessionViewedStateSchema } from "./viewed-state";

/**
 * Response shape mirroring the `HerdrPaneLink` interface produced by
 * `getHerdrPanes` (`../herdr/panes`). This ccp-owned boundary is strict so
 * drift between the producer and browser consumer fails loudly.
 */
export const HerdrPaneSchema = z
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
    viewedState: SessionViewedStateSchema,
  })
  .strict();

const HerdrPaneListResponse = z.array(HerdrPaneSchema);

export const HerdrPaneIndexResponse = z
  .object({
    panes: HerdrPaneListResponse,
    writesEnabled: z.boolean(),
  })
  .strict();

const HerdrPromptSuccessResponse = z.object({ ok: z.literal(true) }).strict();
const HerdrPromptErrorResponse = z.object({ error: z.string() }).strict();

export const herdrPanesQueryOptions = queryOptions({
  queryKey: ["herdr", "panes"] as const,
  queryFn: () => apiFetch("/api/herdr-panes", HerdrPaneIndexResponse),
});

export async function sendHerdrPrompt(
  sessionId: string,
  prompt: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher("/api/herdr/prompt", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, prompt }),
  });
  const json: unknown = await response.json();

  if (!response.ok) {
    throw new Error(HerdrPromptErrorResponse.parse(json).error);
  }

  HerdrPromptSuccessResponse.parse(json);
}
