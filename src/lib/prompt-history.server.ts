import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { mergePromptHistory, parseHistoryJsonl } from "./prompt-history";
import { readSessionPrompts, resolveSessionFilePath } from "./sessions";

/** How many prompts the composer's ↑ history can reach. */
const PROMPT_HISTORY_LIMIT = 500;

async function readHistoryFile(claudeDir: string): Promise<string> {
  try {
    return await readFile(join(claudeDir, "history.jsonl"), "utf-8");
  } catch {
    return "";
  }
}

async function readTranscriptPrompts(claudeDir: string, sessionId: string): Promise<string[]> {
  const resolved = await resolveSessionFilePath(join(claudeDir, "projects"), sessionId);
  if (resolved === null) return [];
  try {
    return await readSessionPrompts(resolved.filePath);
  } catch {
    return [];
  }
}

/**
 * Prompts for the composer's ↑/↓ recall, newest first: the session's own
 * prompts (its transcript, then its history.jsonl lines) ahead of the global
 * `~/.claude/history.jsonl`.
 */
export async function readPromptHistory({
  claudeDir = join(homedir(), ".claude"),
  sessionId,
}: {
  claudeDir?: string;
  sessionId?: string | undefined;
}): Promise<string[]> {
  const [historyText, transcript] = await Promise.all([
    readHistoryFile(claudeDir),
    sessionId === undefined ? Promise.resolve([]) : readTranscriptPrompts(claudeDir, sessionId),
  ]);
  const history = parseHistoryJsonl(historyText);
  const session = [
    ...transcript.reverse(),
    ...history.filter((p) => p.sessionId === sessionId).map((p) => p.display),
  ];
  const global = history.filter((p) => p.sessionId !== sessionId).map((p) => p.display);
  return mergePromptHistory(session, global, PROMPT_HISTORY_LIMIT);
}
