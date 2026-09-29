import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ToastOptions } from "../components/toast";
import { sendHerdrLiveOption } from "../lib/api/herdr";
import {
  type LaunchOptions,
  type LaunchPermissionMode,
  type LiveOptionChange,
  shiftTabCount,
} from "../lib/launch-options";
import { launchPermissionModeLabels } from "../lib/schema-choices";

/** The hook fields that confirm a mode change: the next prompt carries `permission_mode`. */
export interface LiveHookContext {
  permissionMode?: string;
  promptId?: string;
}

export interface LiveLaunchOptionsInput {
  sessionId: string;
  /** The session's mode before any live pick (hook ?? JSONL ?? settings). */
  currentMode: string;
  /** Modes in the CLI's shift+tab cycle for this session. */
  availableModes: readonly LaunchPermissionMode[];
  hookContext: LiveHookContext | undefined;
  toast: (options: ToastOptions) => void;
  send?: (sessionId: string, change: LiveOptionChange) => Promise<void>;
}

export interface LiveLaunchControls {
  /** Picks already sent to the pane, shown in the chin until superseded. */
  options: LaunchOptions;
  apply: (next: LaunchOptions) => Promise<void>;
}

const FAILURE_MESSAGE: Record<LiveOptionChange["kind"], string> = {
  model: "Model change couldn’t be applied. You can try again.",
  effort: "Effort change couldn’t be applied. You can try again.",
  mode: "Mode change couldn’t be applied. You can try again.",
};

function modeLabel(mode: string): string {
  return mode in launchPermissionModeLabels
    ? launchPermissionModeLabels[mode as LaunchPermissionMode]
    : mode;
}

const NO_OPTIONS: LaunchOptions = {};

interface PendingMode {
  sessionId: string;
  expected: LaunchPermissionMode;
  baseline: LiveHookContext | undefined;
}

/** A hook event after the baseline that reports a (non-cleared) permission mode. */
function reportedMode(pending: PendingMode, context: LiveHookContext | undefined): string | null {
  const mode = context?.permissionMode;
  if (mode === undefined || mode === "") return null;
  const baseline = pending.baseline;
  const changed = mode !== baseline?.permissionMode || context?.promptId !== baseline?.promptId;
  return changed ? mode : null;
}

/**
 * Steer a live herdr pane from the composer chin: `/model` and `/effort`
 * prompts, and shift+tab presses for the mode, confirmed by the next hook
 * `permission_mode` with an error toast on mismatch.
 */
export function useLiveLaunchOptions({
  sessionId,
  currentMode,
  availableModes,
  hookContext,
  toast,
  send = sendHerdrLiveOption,
}: LiveLaunchOptionsInput): LiveLaunchControls {
  const [applied, setApplied] = useState<{
    sessionId: string;
    options: Omit<LaunchOptions, "permissionMode">;
  }>({ sessionId, options: NO_OPTIONS });
  const [pendingMode, setPendingMode] = useState<PendingMode | null>(null);
  const sessionOptions = applied.sessionId === sessionId ? applied.options : NO_OPTIONS;
  const sessionPending = pendingMode?.sessionId === sessionId ? pendingMode : null;
  const reported = sessionPending === null ? null : reportedMode(sessionPending, hookContext);
  // The picked mode shows until the next hook reports what the CLI actually chose.
  const unconfirmedMode = sessionPending !== null && reported === null ? sessionPending : null;
  const options = useMemo(
    () =>
      unconfirmedMode === null
        ? sessionOptions
        : { ...sessionOptions, permissionMode: unconfirmedMode.expected },
    [sessionOptions, unconfirmedMode],
  );
  const toastedRef = useRef<PendingMode | null>(null);

  useEffect(() => {
    if (sessionPending === null || reported === null || reported === sessionPending.expected) {
      return;
    }
    if (toastedRef.current === sessionPending) return;
    toastedRef.current = sessionPending;
    toast({
      kind: "error",
      message: FAILURE_MESSAGE.mode,
      description: `Claude Code reports ${modeLabel(reported)} instead of ${modeLabel(sessionPending.expected)}.`,
    });
  }, [reported, sessionPending, toast]);

  const apply = useCallback(
    async (next: LaunchOptions) => {
      const change = nextChange(next, options, currentMode, availableModes);
      if (change === null) return;
      if ("error" in change) {
        toast({ kind: "error", message: FAILURE_MESSAGE.mode, description: change.error });
        return;
      }
      const baseline = hookContext;
      try {
        await send(sessionId, change.change);
      } catch (error) {
        toast({
          kind: "error",
          message: FAILURE_MESSAGE[change.change.kind],
          description: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      if ("mode" in change) {
        setPendingMode({ sessionId, expected: change.mode, baseline });
      } else {
        setApplied({ sessionId, options: { ...sessionOptions, ...change.applied } });
      }
    },
    [availableModes, currentMode, hookContext, options, send, sessionId, sessionOptions, toast],
  );

  return { options, apply };
}

type NextChange =
  | { change: LiveOptionChange; applied: Omit<LaunchOptions, "permissionMode"> }
  | { change: LiveOptionChange; mode: LaunchPermissionMode }
  | { error: string }
  | null;

/** The one field the chin changed, as a pane change. */
function nextChange(
  next: LaunchOptions,
  current: LaunchOptions,
  currentMode: string,
  availableModes: readonly LaunchPermissionMode[],
): NextChange {
  if (next.model !== undefined && next.model !== current.model) {
    return { change: { kind: "model", model: next.model }, applied: { model: next.model } };
  }
  if (next.effort !== undefined && next.effort !== current.effort) {
    return { change: { kind: "effort", effort: next.effort }, applied: { effort: next.effort } };
  }
  const target = next.permissionMode;
  if (target === undefined || target === current.permissionMode) return null;
  const from = current.permissionMode ?? currentMode;
  const presses = shiftTabCount(from, target, availableModes);
  if (presses === null) {
    return {
      error: `Shift+Tab can’t reach ${modeLabel(target)} from ${modeLabel(from)} in this session.`,
    };
  }
  if (presses === 0) return null;
  return { change: { kind: "mode", presses }, mode: target };
}
