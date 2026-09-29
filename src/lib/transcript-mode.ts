import { z } from "zod";

/**
 * Per-session transcript view (Normal / Thinking / Verbose), the model behind upstream
 * claude.ai/code's `transcriptModeBySession`. A session with no entry follows the default
 * (the global verbosity preset), so it tracks later changes to that default.
 */
export const TRANSCRIPT_MODES = ["normal", "thinking", "verbose"] as const;
export const TranscriptModeSchema = z.enum(TRANSCRIPT_MODES);
export type TranscriptMode = z.infer<typeof TranscriptModeSchema>;

export const TRANSCRIPT_MODE_STORAGE_KEY = "ccp-transcript-mode-by-session";
export const TRANSCRIPT_MODE_MAX_OVERRIDES = 100;

/** Session id → mode, least recently set first. */
export type TranscriptModeOverrides = Readonly<Record<string, TranscriptMode>>;

// Upstream removed its "summary" view; stored summary entries fall back to the default.
const StoredOverridesSchema = z.record(
  z.string().min(1),
  z.union([TranscriptModeSchema, z.literal("summary")]),
);

function coerce(mode: TranscriptMode, hasThinking: boolean): TranscriptMode {
  return mode === "thinking" && !hasThinking ? "normal" : mode;
}

export function resolveTranscriptMode({
  sessionId,
  overrides,
  defaultMode,
  hasThinking,
}: {
  sessionId: string;
  overrides: TranscriptModeOverrides;
  defaultMode: TranscriptMode;
  hasThinking: boolean;
}): TranscriptMode {
  return coerce(overrides[sessionId] ?? defaultMode, hasThinking);
}

export function nextTranscriptMode(
  current: TranscriptMode,
  { hasThinking }: { hasThinking: boolean },
): TranscriptMode {
  const index = TRANSCRIPT_MODES.indexOf(coerce(current, hasThinking));
  const next = TRANSCRIPT_MODES[(index + 1) % TRANSCRIPT_MODES.length] ?? "normal";
  return hasThinking || next !== "thinking" ? next : "verbose";
}

function capOverrides(entries: Array<[string, TranscriptMode]>): TranscriptModeOverrides {
  return Object.fromEntries(entries.slice(-TRANSCRIPT_MODE_MAX_OVERRIDES));
}

/** Moves the session to the most-recent end, or drops it when `mode` is the default. */
export function setSessionMode(
  overrides: TranscriptModeOverrides,
  sessionId: string,
  mode: TranscriptMode,
  defaultMode: TranscriptMode,
): TranscriptModeOverrides {
  const entries = Object.entries(overrides).filter(([id]) => id !== sessionId);
  if (mode !== defaultMode) entries.push([sessionId, mode]);
  return capOverrides(entries);
}

function browserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTranscriptModeOverrides(
  storage: Storage | null = browserLocalStorage(),
): TranscriptModeOverrides {
  if (!storage) return {};
  try {
    const raw = storage.getItem(TRANSCRIPT_MODE_STORAGE_KEY);
    if (raw === null) return {};
    const parsed = StoredOverridesSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return {};
    const entries: Array<[string, TranscriptMode]> = [];
    for (const [id, mode] of Object.entries(parsed.data)) {
      if (mode !== "summary") entries.push([id, mode]);
    }
    return capOverrides(entries);
  } catch {
    // localStorage can be denied or hold corrupt JSON; per-session modes are best-effort.
    return {};
  }
}

export function saveTranscriptModeOverrides(
  overrides: TranscriptModeOverrides,
  storage: Storage | null = browserLocalStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(TRANSCRIPT_MODE_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // localStorage can be denied or full; per-session modes are best-effort.
  }
}

/**
 * The content flags a session renders with. A session on the default mode keeps the
 * global toggles (which may be customised beyond the preset); an override uses its preset.
 */
export function transcriptModeFlags<Flags extends object>({
  mode,
  defaultMode,
  settings,
  presets,
}: {
  mode: TranscriptMode;
  defaultMode: TranscriptMode;
  settings: Flags;
  presets: Readonly<Record<TranscriptMode, Readonly<Partial<Flags>>>>;
}): Partial<Flags> {
  const preset = presets[mode];
  if (mode !== defaultMode) return { ...preset };
  const flags: Partial<Flags> = {};
  for (const key of Object.keys(preset) as Array<keyof Flags>) {
    flags[key] = settings[key];
  }
  return flags;
}

export function sessionHasThinking(
  lines: ReadonlyArray<{ type: string; message?: { content?: unknown } | undefined }>,
): boolean {
  return lines.some((line) => {
    if (line.type !== "assistant") return false;
    const content = line.message?.content;
    return (
      Array.isArray(content) &&
      content.some(
        (block: unknown) =>
          typeof block === "object" &&
          block !== null &&
          "type" in block &&
          block.type === "thinking" &&
          "thinking" in block &&
          typeof block.thinking === "string" &&
          block.thinking.trim() !== "",
      )
    );
  });
}
