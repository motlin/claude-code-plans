import { rejectCrossSite } from "../same-origin-guard";
import { herdrRequest, type HerdrResult } from "./client";
import type { HerdrRequester } from "./panes";
import { herdrWritesEnabled, resolveHerdrPromptTarget, type HerdrPromptTarget } from "./prompt";
import { z } from "zod";

const HerdrInterruptSchema = z
  .object({
    sessionId: z.string().min(1),
    force: z.boolean().optional(),
  })
  .strict();

export interface HerdrInterruptDependencies {
  rejectRequest: (request: Request) => Response | null;
  writesEnabled: () => boolean;
  resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
  request: HerdrRequester;
  createRequestId: () => string;
}

function errorStatus(code: string): number {
  switch (code) {
    case "agent_not_ready":
      return 409;
    case "invalid_key":
      return 400;
    default:
      return 502;
  }
}

const defaultDependencies: HerdrInterruptDependencies = {
  rejectRequest: rejectCrossSite,
  writesEnabled: herdrWritesEnabled,
  resolveTarget: (sessionId) => resolveHerdrPromptTarget(sessionId),
  request: herdrRequest,
  createRequestId: () => `ccp:interrupt:${crypto.randomUUID()}`,
};

export async function handleHerdrInterrupt(
  request: Request,
  dependencies: HerdrInterruptDependencies = defaultDependencies,
): Promise<Response> {
  const rejection = dependencies.rejectRequest(request);
  if (rejection) return rejection;

  if (!dependencies.writesEnabled()) {
    return Response.json({ error: "herdr writes are disabled" }, { status: 403 });
  }

  const json: unknown = await request.json();
  const parsed = HerdrInterruptSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "sessionId is required and force must be a boolean when provided" },
      { status: 400 },
    );
  }

  const target = await dependencies.resolveTarget(parsed.data.sessionId);
  if (!target.ok) {
    return Response.json({ error: target.message }, { status: errorStatus(target.code) });
  }

  const response = await dependencies.request({
    id: dependencies.createRequestId(),
    method: "agent.send_keys",
    params: {
      target: target.value.paneId,
      keys: [parsed.data.force === true ? "ctrl+c" : "esc"],
    },
  });
  if (!response.ok) {
    return Response.json({ error: response.message }, { status: errorStatus(response.code) });
  }

  return Response.json({ ok: true });
}
