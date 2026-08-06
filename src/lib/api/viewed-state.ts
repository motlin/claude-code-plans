import { z } from "zod";

export const SessionViewedStateSchema = z
  .object({
    currentMessageIndex: z.number().int(),
    lastViewedMessageIndex: z.number().int(),
    reviewTargetMessageIndex: z.number().int(),
    newMessageCount: z.number().int().nonnegative(),
    viewedInCcp: z.boolean(),
    viewedInHerdr: z.boolean(),
    viewedAnywhere: z.boolean(),
  })
  .strict();

export type SessionViewedState = z.infer<typeof SessionViewedStateSchema>;

export const ViewedStateMutationBodySchema = z
  .object({
    action: z.enum(["reviewed", "unreviewed"]),
    messageIndex: z.number().int().min(-1),
  })
  .strict();

export const SessionVisibilityBodySchema = z
  .object({
    clientId: z.string().min(1),
    visible: z.boolean(),
  })
  .strict();

export async function updateSessionViewedState(
  sessionId: string,
  action: "reviewed" | "unreviewed",
  messageIndex: number,
  fetcher: typeof fetch = fetch,
): Promise<SessionViewedState> {
  const response = await fetcher(`/api/sessions/${encodeURIComponent(sessionId)}/viewed`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, messageIndex }),
  });
  const json: unknown = await response.json();
  if (!response.ok) throw new Error(`Failed to update viewed state (${response.status})`);
  return SessionViewedStateSchema.parse(json);
}

export async function updateSessionVisibility(
  sessionId: string,
  clientId: string,
  visible: boolean,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(`/api/sessions/${encodeURIComponent(sessionId)}/visibility`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, visible }),
  });
  if (!response.ok) throw new Error(`Failed to update session visibility (${response.status})`);
}
