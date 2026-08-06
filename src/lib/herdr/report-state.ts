import type { ActiveSessionEntry } from "../active-session-store";
import type { HookEvent } from "../hook-events";
import type { HerdrResult } from "./client";
import { herdrRequest } from "./client";
import { herdrWritesEnabled, resolveHerdrPromptTarget } from "./prompt";
import type { HerdrRequester } from "./panes";
import { HerdrPaneInfoResultSchema } from "./schema";

export type HerdrReportedState = "idle" | "working" | "blocked" | "unknown";

export interface HerdrHookState {
  state: HerdrReportedState;
  message: string;
}

export interface HerdrReportObservation {
  outcome: "verified" | "metadata-fallback" | "request-error" | "verification-error";
  method: "pane.report_agent" | "pane.report_metadata" | "pane.clear_agent_authority";
  paneId: string | null;
  message: string;
}

interface HerdrSequence {
  timestamp: number;
  ordinal: number;
  value: number;
}

export interface HerdrHookStateDependencies {
  writesEnabled: () => boolean;
  resolveTarget: typeof resolveHerdrPromptTarget;
  request: HerdrRequester;
  nextSequence: () => HerdrSequence;
  observe: (observation: HerdrReportObservation) => void;
}

const SOURCE = "ccp";
const AGENT = "claude";

/** Build source-global sequence numbers that remain increasing across clock stalls and rewinds. */
export function createHerdrSequence(clock: () => number = Date.now): () => HerdrSequence {
  let lastValue = -1;

  return () => {
    const timestamp = clock();
    const baseValue = timestamp * 1000;
    const ordinal = Math.max(0, lastValue - baseValue + 1);
    const value = baseValue + ordinal;
    lastValue = value;
    return { timestamp, ordinal, value };
  };
}

/** Map hook lifecycle edges to the four states accepted by herdr's reporting API. */
export function stateForHerdrHookEvent(event: HookEvent): HerdrHookState | null {
  switch (event.hook_event_name) {
    case "UserPromptSubmit":
      return { state: "working", message: "responding to prompt" };
    case "PreToolUse":
      if (event.tool_name === "AskUserQuestion" || event.tool_name === "ExitPlanMode") {
        return { state: "blocked", message: `waiting for ${event.tool_name}` };
      }
      return { state: "working", message: `using ${event.tool_name}` };
    case "PostToolUse":
      return { state: "working", message: `finished ${event.tool_name}` };
    case "PostToolUseFailure":
      return { state: "working", message: `${event.tool_name} failed` };
    case "MessageDisplay":
      return { state: "working", message: "writing response" };
    case "PreCompact":
      return event.trigger === "manual"
        ? { state: "working", message: "compacting context" }
        : null;
    case "PostCompact":
      return event.reason === "manual"
        ? { state: "idle", message: "manual compaction complete" }
        : null;
    case "Stop":
      return { state: "idle", message: "ready" };
    default:
      return null;
  }
}

function defaultObserver(observation: HerdrReportObservation): void {
  if (observation.outcome === "verified" || observation.outcome === "metadata-fallback") return;
  console.error("herdr hook-state report failed", observation);
}

const defaultDependencies: HerdrHookStateDependencies = {
  writesEnabled: herdrWritesEnabled,
  resolveTarget: resolveHerdrPromptTarget,
  request: herdrRequest,
  nextSequence: createHerdrSequence(),
  observe: defaultObserver,
};

function observeRequestError(
  dependencies: HerdrHookStateDependencies,
  method: HerdrReportObservation["method"],
  paneId: string | null,
  result: Extract<HerdrResult<unknown>, { ok: false }>,
): void {
  dependencies.observe({
    outcome: "request-error",
    method,
    paneId,
    message: `${result.code}: ${result.message}`,
  });
}

async function verifyPane(
  paneId: string,
  method: HerdrReportObservation["method"],
  expectedState: HerdrHookState | null,
  dependencies: HerdrHookStateDependencies,
  requestId: string,
): Promise<void> {
  const response = await dependencies.request({
    id: `${requestId}:verify`,
    method: "pane.get",
    params: { pane_id: paneId },
  });
  if (!response.ok) {
    observeRequestError(dependencies, method, paneId, response);
    return;
  }

  const parsed = HerdrPaneInfoResultSchema.safeParse(response.value);
  if (!parsed.success) {
    dependencies.observe({
      outcome: "verification-error",
      method,
      paneId,
      message: "herdr returned an invalid pane.get response",
    });
    return;
  }

  const pane = parsed.data.pane;
  if (method === "pane.report_agent" && expectedState) {
    if (
      pane.agent_status !== expectedState.state ||
      pane.agent !== AGENT ||
      pane.agent_session != null
    ) {
      dependencies.observe({
        outcome: "verification-error",
        method,
        paneId,
        message: `readback did not confirm ${AGENT}/${expectedState.state} without an owner`,
      });
      return;
    }
  }

  if (method === "pane.report_metadata" && expectedState) {
    const expectedLabels = {
      idle: "idle (ccp)",
      working: "working (ccp)",
      blocked: "blocked (ccp)",
      unknown: "unknown (ccp)",
    };
    const labels = pane.state_labels;
    if (
      pane.title !== expectedState.message ||
      pane.display_agent !== "Claude (ccp)" ||
      labels == null ||
      Object.keys(labels).length !== Object.keys(expectedLabels).length ||
      labels["idle"] !== expectedLabels.idle ||
      labels["working"] !== expectedLabels.working ||
      labels["blocked"] !== expectedLabels.blocked ||
      labels["unknown"] !== expectedLabels.unknown ||
      pane.tokens?.["ccp_state"] !== expectedState.state
    ) {
      dependencies.observe({
        outcome: "verification-error",
        method,
        paneId,
        message: "readback did not confirm ccp display metadata",
      });
      return;
    }
  }

  if (method === "pane.clear_agent_authority" && pane.agent_session?.source === SOURCE) {
    dependencies.observe({
      outcome: "verification-error",
      method,
      paneId,
      message: "readback still shows a ccp-owned agent session",
    });
    return;
  }

  dependencies.observe({
    outcome: "verified",
    method,
    paneId,
    message: "pane.get confirmed write",
  });
}

async function sendHookState(
  event: HookEvent,
  entry: ActiveSessionEntry | null,
  dependencies: HerdrHookStateDependencies,
): Promise<void> {
  const report = stateForHerdrHookEvent(event);
  if (!report && event.hook_event_name !== "SessionEnd") return;

  const target = await dependencies.resolveTarget(
    event.session_id,
    entry ? [entry] : [],
    dependencies.request,
  );
  if (!target.ok) {
    observeRequestError(
      dependencies,
      event.hook_event_name === "SessionEnd" ? "pane.clear_agent_authority" : "pane.report_agent",
      null,
      target,
    );
    return;
  }

  const paneId = target.value.paneId;
  // report_agent returns ok even when herdr silently rejects an owner conflict.
  // Read the current pane before choosing authority, then read it again after
  // the write so neither branch treats the response envelope as acceptance.
  const paneResponse = await dependencies.request({
    id: "ccp:hook-pane",
    method: "pane.get",
    params: { pane_id: paneId },
  });
  if (!paneResponse.ok) {
    observeRequestError(
      dependencies,
      event.hook_event_name === "SessionEnd" ? "pane.clear_agent_authority" : "pane.report_agent",
      paneId,
      paneResponse,
    );
    return;
  }
  const pane = HerdrPaneInfoResultSchema.safeParse(paneResponse.value);
  if (!pane.success) {
    dependencies.observe({
      outcome: "verification-error",
      method:
        event.hook_event_name === "SessionEnd" ? "pane.clear_agent_authority" : "pane.report_agent",
      paneId,
      message: "herdr returned an invalid pane.get response",
    });
    return;
  }

  const sequence = dependencies.nextSequence();
  const requestId = `ccp:${sequence.timestamp}:${sequence.ordinal}`;
  if (event.hook_event_name === "SessionEnd") {
    const response = await dependencies.request({
      id: requestId,
      method: "pane.clear_agent_authority",
      params: { pane_id: paneId, source: SOURCE, seq: sequence.value },
    });
    if (!response.ok) {
      observeRequestError(dependencies, "pane.clear_agent_authority", paneId, response);
      return;
    }
    await verifyPane(paneId, "pane.clear_agent_authority", null, dependencies, requestId);
    return;
  }

  if (!report) return;
  if (pane.data.pane.agent_session != null) {
    dependencies.observe({
      outcome: "metadata-fallback",
      method: "pane.report_metadata",
      paneId,
      message: `agent session is owned by ${pane.data.pane.agent_session.source}`,
    });
    const response = await dependencies.request({
      id: requestId,
      method: "pane.report_metadata",
      params: {
        pane_id: paneId,
        source: SOURCE,
        title: report.message,
        display_agent: "Claude (ccp)",
        state_labels: {
          idle: "idle (ccp)",
          working: "working (ccp)",
          blocked: "blocked (ccp)",
          unknown: "unknown (ccp)",
        },
        tokens: { ccp_state: report.state },
        seq: sequence.value,
      },
    });
    if (!response.ok) {
      observeRequestError(dependencies, "pane.report_metadata", paneId, response);
      return;
    }
    await verifyPane(paneId, "pane.report_metadata", report, dependencies, requestId);
    return;
  }

  const response = await dependencies.request({
    id: requestId,
    method: "pane.report_agent",
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      state: report.state,
      message: report.message,
      seq: sequence.value,
    },
  });
  if (!response.ok) {
    observeRequestError(dependencies, "pane.report_agent", paneId, response);
    return;
  }
  await verifyPane(paneId, "pane.report_agent", report, dependencies, requestId);
}

/** Start a detached state report; transport failures are observed without rejecting the hook. */
export function reportHookStateToHerdr(
  event: HookEvent,
  entry: ActiveSessionEntry | null,
  dependencies: HerdrHookStateDependencies = defaultDependencies,
): void {
  if (!dependencies.writesEnabled()) return;
  void sendHookState(event, entry, dependencies).catch((error: unknown) => {
    dependencies.observe({
      outcome: "request-error",
      method:
        event.hook_event_name === "SessionEnd" ? "pane.clear_agent_authority" : "pane.report_agent",
      paneId: entry?.herdrPane || null,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
