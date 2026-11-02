import {readFile} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";
import {mergePromptHistory, parseHistoryJsonl} from "./prompt-history";
import {readSessionPrompts, resolveSessionFilePath} from "./sessions";

/** How many prompts (and, separately, shell commands) the composer's ↑ history can reach. */
const PROMPT_HISTORY_LIMIT = 500;

async function readHistoryFile(claudeDir: string): Promise<string>
{
	try
	{
		return await readFile(join(claudeDir, "history.jsonl"), "utf-8");
	}
	catch
	{
		return "";
	}
}

async function readTranscript(
	claudeDir: string,
	sessionId: string,
): Promise<
{
	prompts: string[];
	bashCommands: string[];
}>
{
	const empty =
	{
		prompts: [],
		bashCommands: [],
	};
	const resolved = await resolveSessionFilePath(join(claudeDir, "projects"), sessionId);
	if (resolved === null) return empty;
	try
	{
		return await readSessionPrompts(resolved.filePath);
	}
	catch
	{
		return empty;
	}
}

/** history.jsonl's `! command` lines, as the CLI records a bash-mode command; the bang and its spacing dropped. */
const HISTORY_BASH_LINE = /^!\s*/;

/** Consecutive repeats dropped, as upstream's bash history (`Pn`) does. */
function dropConsecutiveRepeats(commands: readonly string[]): string[]
{
	return commands.filter((command, index) => command !== commands[index - 1]);
}

export interface PromptHistory
{
	/** Chat prompts for ↑/↓, newest first. */
	prompts: string[];
	/** Shell commands for ↑/↓ in bash mode, newest first. */
	bashCommands: string[];
}

/**
 * The composer's ↑/↓ recall, newest first. Prompts: the session's own (its transcript, then its history.jsonl
 * lines) ahead of the global `~/.claude/history.jsonl`. Bash commands: the transcript's `<bash-input>` commands
 * (upstream getBashHistory), then history.jsonl's `!` lines not already there, the session's first.
 */
export async function readPromptHistory({
	claudeDir = join(homedir(), ".claude"),
	sessionId,
}: {
	claudeDir?: string;
	sessionId?: string | undefined;
}): Promise<PromptHistory>
{
	const [historyText, transcript] = await Promise.all([
		readHistoryFile(claudeDir),
		sessionId === undefined
			? Promise.resolve(
					{
						prompts: [],
						bashCommands: [],
					},
				)
			: readTranscript(claudeDir, sessionId),
	]);
	const history = parseHistoryJsonl(historyText);
	const isBash = (display: string) => HISTORY_BASH_LINE.test(display);
	const sessionHistory = history.filter((p) => p.sessionId === sessionId).map((p) => p.display);
	const globalHistory = history.filter((p) => p.sessionId !== sessionId).map((p) => p.display);
	const prompts = mergePromptHistory(
		[...transcript.prompts.toReversed(), ...sessionHistory.filter((p) => !isBash(p))],
		globalHistory.filter((p) => !isBash(p)),
		PROMPT_HISTORY_LIMIT,
	);
	const transcriptCommands = dropConsecutiveRepeats(transcript.bashCommands.toReversed());
	const known = new Set(transcriptCommands);
	const historyCommands = mergePromptHistory(
		sessionHistory.filter(isBash).map((p) => p.replace(HISTORY_BASH_LINE, "")),
		globalHistory.filter(isBash).map((p) => p.replace(HISTORY_BASH_LINE, "")),
		PROMPT_HISTORY_LIMIT,
	).filter((command) => !known.has(command));
	return {
		prompts,
		bashCommands: [...transcriptCommands, ...historyCommands].slice(0, PROMPT_HISTORY_LIMIT),
	};
}
