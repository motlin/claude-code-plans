import { useCallback, useMemo, useSyncExternalStore } from "react";
import { useShortcut } from "./use-shortcut";
import { VERBOSITY_PRESETS, type Settings, useSettings } from "../components/settings-provider";
import {
  type TranscriptMode,
  type TranscriptModeOverrides,
  loadTranscriptModeOverrides,
  nextTranscriptMode,
  resolveTranscriptMode,
  saveTranscriptModeOverrides,
  setSessionMode,
  transcriptModeFlags,
} from "../lib/transcript-mode";

const EMPTY: TranscriptModeOverrides = {};
let overrides: TranscriptModeOverrides | undefined;
const listeners = new Set<() => void>();

function getSnapshot(): TranscriptModeOverrides {
  overrides ??= loadTranscriptModeOverrides();
  return overrides;
}

function getServerSnapshot(): TranscriptModeOverrides {
  return EMPTY;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(next: TranscriptModeOverrides): void {
  overrides = next;
  saveTranscriptModeOverrides(next);
  for (const listener of listeners) listener();
}

export type TranscriptFlags = Pick<
  Settings,
  | "showTools"
  | "showThinking"
  | "showPassedHooks"
  | "showHookWarnings"
  | "showHookErrors"
  | "showSystemBanners"
  | "showCompactSummaries"
  | "showTranscriptOnly"
>;

export interface SessionTranscriptMode {
  mode: TranscriptMode;
  isDefault: boolean;
  flags: TranscriptFlags;
  setMode: (mode: TranscriptMode) => void;
  cycle: () => void;
}

/**
 * The transcript view for one session: its own override if it has one, else the global
 * verbosity default. `flags` are meant for SessionChat only; other surfaces keep the globals.
 */
function useSessionTranscriptMode(
  sessionId: string,
  { hasThinking = true }: { hasThinking?: boolean } = {},
): SessionTranscriptMode {
  const { settings } = useSettings();
  const defaultMode = settings.verbosity;
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const mode = resolveTranscriptMode({ sessionId, overrides: current, defaultMode, hasThinking });

  const flags = useMemo(
    (): TranscriptFlags => ({
      showTools: settings.showTools,
      showThinking: settings.showThinking,
      showPassedHooks: settings.showPassedHooks,
      showHookWarnings: settings.showHookWarnings,
      showHookErrors: settings.showHookErrors,
      showSystemBanners: settings.showSystemBanners,
      showCompactSummaries: settings.showCompactSummaries,
      showTranscriptOnly: settings.showTranscriptOnly,
      ...transcriptModeFlags({ mode, defaultMode, settings, presets: VERBOSITY_PRESETS }),
    }),
    [mode, defaultMode, settings],
  );

  const setMode = useCallback(
    (next: TranscriptMode) => update(setSessionMode(getSnapshot(), sessionId, next, defaultMode)),
    [sessionId, defaultMode],
  );
  const cycle = useCallback(
    () => setMode(nextTranscriptMode(mode, { hasThinking })),
    [setMode, mode, hasThinking],
  );

  return { mode, isDefault: mode === defaultMode, flags, setMode, cycle };
}

/**
 * `useSessionTranscriptMode` plus ⌃O, which cycles this session's mode. It fires from the
 * composer too and prevents the default, since Ctrl+O is "open file" on Windows and Linux.
 */
export function useTranscriptModeShortcut(
  sessionId: string,
  options: { hasThinking?: boolean } = {},
): SessionTranscriptMode {
  const transcriptMode = useSessionTranscriptMode(sessionId, options);
  useShortcut("transcript_view", (event) => {
    if (event.isComposing) return false;
    transcriptMode.cycle();
    return true;
  });
  return transcriptMode;
}
