import { z } from "zod";

/** A paste the CLI kept inline, or only as a hash of content stored elsewhere. */
const PastedContentSchema = z.union([
  z.strictObject({ id: z.number().int(), type: z.literal("text"), content: z.string() }),
  z.strictObject({ id: z.number().int(), type: z.literal("text"), contentHash: z.string() }),
]);

/** One line of `~/.claude/history.jsonl`: a prompt as the CLI's own ↑ history recalls it. */
export const HistoryLineSchema = z.strictObject({
  display: z.string(),
  pastedContents: z.record(z.string().regex(/^\d+$/), PastedContentSchema),
  timestamp: z.number().int(),
  project: z.string(),
  sessionId: z.string(),
});

export interface HistoryPrompt {
  display: string;
  sessionId: string;
}

/** Parse history.jsonl into prompts, newest first; unreadable lines are skipped. */
export function parseHistoryJsonl(text: string): HistoryPrompt[] {
  const prompts: HistoryPrompt[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = HistoryLineSchema.safeParse(json);
    if (parsed.success) {
      prompts.push({ display: parsed.data.display, sessionId: parsed.data.sessionId });
    }
  }
  return prompts.reverse();
}

/** Session prompts first, then the rest; blank and repeated prompts dropped, capped at `limit`. */
export function mergePromptHistory(
  session: readonly string[],
  global: readonly string[],
  limit: number,
): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const prompt of [...session, ...global]) {
    if (merged.length >= limit) break;
    if (!prompt.trim() || seen.has(prompt)) continue;
    seen.add(prompt);
    merged.push(prompt);
  }
  return merged;
}

/**
 * A shell-like walk through prior prompts (newest first). `up` steps older and
 * `down` newer, each returning null at the end of the list; stepping down
 * past the newest entry returns to the saved draft, which Esc also restores.
 */
export interface HistoryNavigator {
  /** True while an entry (not the draft) is showing. */
  readonly active: boolean;
  readonly draft: string;
  readonly text: string;
  up(): HistoryNavigator | null;
  down(): HistoryNavigator | null;
}

export function historyNavigator(
  entries: readonly string[],
  draft: string,
  index = -1,
): HistoryNavigator {
  return {
    active: index >= 0,
    draft,
    text: index >= 0 ? (entries[index] ?? draft) : draft,
    up: () => (index + 1 < entries.length ? historyNavigator(entries, draft, index + 1) : null),
    down: () => (index >= 0 ? historyNavigator(entries, draft, index - 1) : null),
  };
}

/**
 * Whether ↑/↓ should walk history rather than move the caret: ↑ only with the
 * caret on the first line, ↓ only on the last, and never over a selection.
 */
export function historyKeyApplies(
  key: string,
  text: string,
  selectionStart: number,
  selectionEnd: number,
): boolean {
  if (selectionStart !== selectionEnd) return false;
  if (key === "ArrowUp") return !text.slice(0, selectionStart).includes("\n");
  if (key === "ArrowDown") return !text.slice(selectionEnd).includes("\n");
  return false;
}
