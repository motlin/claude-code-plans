import { getActiveSessionEntries, type ActiveSessionEntry } from "../active-session-store";
import { rejectCrossSite } from "../same-origin-guard";
import { herdrRequest, type HerdrResult } from "./client";
import type { HerdrRequester } from "./panes";
import { HerdrSessionSnapshotResultSchema } from "./schema";
import { z } from "zod";

const HerdrPromptSchema = z.object({
  sessionId: z.string(),
  prompt: z.string(),
});

export interface HerdrPromptTarget {
  terminalId: string;
  paneId: string;
}

export interface HerdrPromptDependencies {
  rejectRequest: (request: Request) => Response | null;
  writesEnabled: () => boolean;
  resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
  request: HerdrRequester;
  createRequestId: () => string;
}

function failure(code: string, message: string): HerdrResult<never> {
  return { ok: false, code, message };
}

export function herdrWritesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["CCP_ENABLE_HERDR_WRITES"] === "1";
}

/** Resolve the session through a fresh snapshot so moved panes cannot leave a stale target. */
export async function resolveHerdrPromptTarget(
  sessionId: string,
  entries: ActiveSessionEntry[] = getActiveSessionEntries(),
  request: HerdrRequester = herdrRequest,
): Promise<HerdrResult<HerdrPromptTarget>> {
  const response = await request({
    id: "ccp:prompt-snap",
    method: "session.snapshot",
    params: {},
  });
  if (!response.ok) return response;

  const parsed = HerdrSessionSnapshotResultSchema.safeParse(response.value);
  if (!parsed.success) {
    return failure("bad-response", "herdr returned an invalid session snapshot");
  }

  const panes = parsed.data.snapshot.panes;
  const capturedPaneId = entries.find((entry) => entry.sessionId === sessionId)?.herdrPane;
  const sessionPane =
    panes.find((pane) => pane.agent_session?.value === sessionId) ??
    panes.find((pane) => capturedPaneId !== undefined && pane.pane_id === capturedPaneId);
  if (!sessionPane) {
    return failure("session-not-found", "session is not attached to a live herdr terminal");
  }

  const terminalId = sessionPane.terminal_id;
  const currentPane = panes.find((pane) => pane.terminal_id === terminalId);
  if (!currentPane) {
    return failure("pane-not-found", "herdr terminal has no current pane");
  }

  return {
    ok: true,
    value: {
      terminalId,
      paneId: currentPane.pane_id,
    },
  };
}

function errorStatus(code: string): number {
  switch (code) {
    case "agent_not_ready":
    case "agent_prompt_stalled":
      return 409;
    case "empty_agent_prompt":
      return 400;
    default:
      return 502;
  }
}

const defaultDependencies: HerdrPromptDependencies = {
  rejectRequest: rejectCrossSite,
  writesEnabled: herdrWritesEnabled,
  resolveTarget: (sessionId) => resolveHerdrPromptTarget(sessionId),
  request: herdrRequest,
  createRequestId: () => `ccp:prompt:${crypto.randomUUID()}`,
};

export async function handleHerdrPrompt(
  request: Request,
  dependencies: HerdrPromptDependencies = defaultDependencies,
): Promise<Response> {
  const rejection = dependencies.rejectRequest(request);
  if (rejection) return rejection;

  if (!dependencies.writesEnabled()) {
    return Response.json({ error: "herdr writes are disabled" }, { status: 403 });
  }

  const json: unknown = await request.json();
  const parsed = HerdrPromptSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "sessionId and prompt are required" }, { status: 400 });
  }

  const target = await dependencies.resolveTarget(parsed.data.sessionId);
  if (!target.ok) {
    return Response.json({ error: target.message }, { status: errorStatus(target.code) });
  }

  const response = await dependencies.request({
    id: dependencies.createRequestId(),
    method: "agent.prompt",
    params: {
      target: target.value.paneId,
      text: parsed.data.prompt,
    },
  });
  if (!response.ok) {
    return Response.json({ error: response.message }, { status: errorStatus(response.code) });
  }

  return Response.json({ ok: true });
}
