import {readFile, stat} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import {asRecord, isRecord} from "../narrow";
import {RuntimeWorkflowProgressEntrySchema} from "../workflow-progress";

/** What the index stores about the workflow run a subagent belongs to. */
export interface WorkflowAgentInfo {
	runId: string;
	phase: string | null;
	phaseIndex: number | null;
	label: string | null;
}

interface JournalStart {
	label: string | null;
	phase: string | null;
}

interface ParsedJournal {
	starts: Map<string, JournalStart>;
	/** Phase titles in first-seen order; a title's 1-based position is its fallback phase index. */
	phaseOrder: string[];
}

interface ProgressAgent {
	label: string | null;
	phaseTitle: string | null;
	phaseIndex: number | null;
}

const WORKFLOW_AGENT_PATH_RE = /[/\\]subagents[/\\]workflows[/\\](wf_[^/\\]+)[/\\]agent-[^/\\]+\.jsonl$/;

/** A run's agents share one journal and run JSON, so a full scan reads each once rather than once per agent. */
const MEMO_ENTRIES = 8;

/** `parse` applied to a file's text, re-read only when its mtime or size changes; null when it cannot be read. */
function memoizedByStat<T>(parse: (text: string) => T): (path: string) => Promise<T | null> {
	const memo = new Map<string, {key: string; value: Promise<T | null>}>();
	return async (path) => {
		let fileStat: Awaited<ReturnType<typeof stat>>;
		try {
			fileStat = await stat(path);
		} catch {
			return null;
		}
		const key = `${fileStat.mtimeMs}:${fileStat.size}`;
		const cached = memo.get(path);
		if (cached?.key === key) return cached.value;
		const value = readFile(path, "utf-8").then(parse, () => null);
		memo.delete(path);
		memo.set(path, {key, value});
		if (memo.size > MEMO_ENTRIES) {
			const oldest = memo.keys().next().value;
			if (oldest !== undefined) memo.delete(oldest);
		}
		return value;
	};
}

function stringOrNull(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function parseJournal(text: string): ParsedJournal {
	const starts = new Map<string, JournalStart>();
	const phaseOrder: string[] = [];
	for (const line of text.split("\n")) {
		// `result` lines carry whole agent outputs; skip parsing anything that cannot be a `started` event.
		if (!line.includes('"started"')) continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (!isRecord(event) || event["type"] !== "started") continue;
		const agentId = stringOrNull(event["agentId"]);
		const phase = stringOrNull(event["phase"]);
		if (phase !== null && !phaseOrder.includes(phase)) phaseOrder.push(phase);
		if (agentId !== null && !starts.has(agentId)) starts.set(agentId, {label: stringOrNull(event["label"]), phase});
	}
	return {starts, phaseOrder};
}

function parseRunProgress(text: string): Map<string, ProgressAgent> {
	const agents = new Map<string, ProgressAgent>();
	let run: unknown;
	try {
		run = JSON.parse(text);
	} catch {
		return agents;
	}
	const progress = asRecord(run)?.["workflowProgress"];
	if (!Array.isArray(progress)) return agents;
	for (const raw of progress) {
		const entry = RuntimeWorkflowProgressEntrySchema.safeParse(raw);
		if (!entry.success || entry.data.type !== "workflow_agent") continue;
		const {agentId, label, phaseIndex, phaseTitle} = entry.data;
		agents.set(agentId, {
			label: stringOrNull(label),
			phaseTitle: stringOrNull(phaseTitle),
			phaseIndex: phaseIndex ?? null,
		});
	}
	return agents;
}

const readJournal = memoizedByStat(parseJournal);
const readRunProgress = memoizedByStat(parseRunProgress);

/**
 * The run, phase and label of a workflow agent transcript at `<session>/subagents/workflows/<runId>/agent-<id>.jsonl`,
 * or null for any other subagent. Meta fields win, then the run's journal, then its ended-run JSON.
 */
export async function readWorkflowAgentInfo(
	filePath: string,
	meta: {phase: string | null; description: string | null},
): Promise<WorkflowAgentInfo | null> {
	const runId = WORKFLOW_AGENT_PATH_RE.exec(filePath)?.[1];
	if (runId === undefined) return null;
	const agentId = basename(filePath, ".jsonl").slice("agent-".length);
	const runDir = dirname(filePath);
	const sessionDir = dirname(dirname(dirname(runDir)));
	const [journal, progress] = await Promise.all([
		readJournal(join(runDir, "journal.jsonl")),
		readRunProgress(join(sessionDir, "workflows", `${runId}.json`)),
	]);
	const start = journal?.starts.get(agentId);
	const progressAgent = progress?.get(agentId);
	const phase = meta.phase ?? start?.phase ?? progressAgent?.phaseTitle ?? null;
	const journalPosition = phase === null ? -1 : (journal?.phaseOrder.indexOf(phase) ?? -1);
	return {
		runId,
		phase,
		phaseIndex: progressAgent?.phaseIndex ?? (journalPosition === -1 ? null : journalPosition + 1),
		label: meta.description ?? start?.label ?? progressAgent?.label ?? null,
	};
}
