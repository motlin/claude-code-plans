import {createReadStream} from 'node:fs';
import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import {decodeProjectDir, resolveProjectName} from './memory';
import {SessionsIndexSchema, CustomTitleRecordSchema} from './schemas';

export interface SessionEntry {
	id: string;
	title: string;
	firstPrompt?: string | undefined;
	summary?: string | undefined;
	customTitle?: string | undefined;
	mtime: Date;
	created: Date;
	project: string;
	projectName: string;
	projectPath?: string | undefined;
	messageCount: number;
	gitBranch?: string | undefined;
	isSidechain: boolean;
}

export interface SessionProjectGroup {
	project: string;
	projectName: string;
	sessions: SessionEntry[];
}

export interface ToolCallInfo {
	id: string;
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	startedAt?: string;
	duration?: number;
	sourceUuid: string;
	resultUuid?: string;
}

export type MessageContent =
	| {type: 'text'; text: string; sourceUuid: string}
	| {type: 'thinking'; thinking: string; sourceUuid: string}
	| {type: 'image'; mediaType: string; data: string; sourceUuid: string}
	| {type: 'document'; mediaType: string; data: string; sourceUuid: string}
	| {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; sourceUuid: string}
	| {type: 'tool_result'; toolUseId: string; content: string; isError: boolean; sourceUuid: string}
	| {type: 'command'; name: string; args?: string; sourceUuid: string}
	| {type: 'bash-input'; command: string; sourceUuid: string}
	| {type: 'bash-output'; stdout: string; stderr: string; sourceUuid: string};

export interface SessionMessage {
	role: 'user' | 'assistant';
	textBlocks: string[];
	content: MessageContent[];
	toolCalls: ToolCallInfo[];
	timestamp: string;
	isCommand?: boolean;
}

export interface SessionDetail {
	id: string;
	title: string;
	projectName: string;
	projectId: string;
	messages: SessionMessage[];
	uuidToLine: Map<string, number>;
}

/**
 * A single parsed JSONL line, preserving the original structure from Claude Code.
 * The `type` field determines which switching component renders it.
 */
export interface SessionLine {
	type: string;
	uuid?: string | undefined;
	parentUuid?: string | undefined;
	timestamp?: string | undefined;
	message?:
		| {
				role?: string | undefined;
				content?: string | SessionContentBlock[] | undefined;
		  }
		| undefined;
	customTitle?: string | undefined;
	sessionId?: string | undefined;
	lineIndex: number;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- TanStack serialization narrows unknown to {}
type SerializableValue = Record<string, {}>;

/**
 * A content block within a message, preserving the original JSONL structure.
 */
export interface SessionContentBlock {
	type: string;
	text?: string | undefined;
	thinking?: string | undefined;
	name?: string | undefined;
	id?: string | undefined;
	input?: SerializableValue | undefined;
	tool_use_id?: string | undefined;
	content?: string | Array<{type: string; text: string}> | undefined;
	is_error?: boolean | undefined;
	source?: {type: string; media_type: string; data: string} | undefined;
}

/**
 * Information about a tool_result paired with its tool_use.
 */
export interface ToolResultInfo {
	result: string;
	isError: boolean;
	resultUuid: string;
	duration?: number | undefined;
}

/**
 * Raw session data: parsed lines + lookup maps for pairing and decorations.
 */
export interface SessionLines {
	id: string;
	title: string;
	projectName: string;
	projectId: string;
	lines: SessionLine[];
	/** Maps tool_use.id to its tool_result data */
	toolResultMap: Map<string, ToolResultInfo>;
	/** Maps uuid to JSONL file line index */
	uuidToLine: Map<string, number>;
}

/** Match a complete command-message block and capture its inner content. */
const COMMAND_MESSAGE_RE = /<command-message[^>]*>([\s\S]*?)<\/command-message>/;

/** Strip entire blocks whose content is internal metadata (not user-facing). */
const STRIP_BLOCK_RE =
	/<(?:command-name|command-args|local-command-stdout)[^>]*>[\s\S]*?<\/(?:command-name|command-args|local-command-stdout)>/g;

/** Strip only opening/closing tags, keeping inner content (for tags that wrap user text). */
const STRIP_TAG_RE =
	/<\/?(?:command-message|command-name|command-args|command|local-command-caveat|local-command-stdout)[^>]*>/g;

/**
 * Clean command markup from text for display.
 * If a command-message block is present, extracts its inner content (stripping nested tags)
 * to avoid duplication from sibling command-name/command-args blocks.
 */
function cleanCommandText(text: string): string {
	const msgMatch = text.match(COMMAND_MESSAGE_RE);
	if (msgMatch) {
		// Use the command-message inner text, stripping any nested tags
		return msgMatch[1]!.replace(STRIP_TAG_RE, '').trim();
	}
	// No command-message wrapper: strip metadata blocks then remaining tags
	return text.replace(STRIP_BLOCK_RE, '').replace(STRIP_TAG_RE, '').trim();
}

export function stripCommandTags(text: string): string {
	return cleanCommandText(text);
}

const BASH_INPUT_RE = /^\s*<bash-input>([\s\S]*?)<\/bash-input>\s*$/;
const BASH_OUTPUT_RE = /^\s*<bash-stdout>([\s\S]*?)<\/bash-stdout>\s*<bash-stderr>([\s\S]*?)<\/bash-stderr>\s*$/;

export function parseBashInput(text: string): {command: string} | null {
	const m = text.match(BASH_INPUT_RE);
	if (!m) return null;
	return {command: m[1]!};
}

export function parseBashOutput(text: string): {stdout: string; stderr: string} | null {
	const m = text.match(BASH_OUTPUT_RE);
	if (!m) return null;
	return {stdout: m[1]!, stderr: m[2]!};
}

export function parseCommandBlock(text: string): {name: string; args?: string} | null {
	const nameMatch = text.match(/<command-name>(.*?)<\/command-name>/);
	if (!nameMatch) return null;
	const argsMatch = text.match(/<command-args>(.*?)<\/command-args>/s);
	const args = argsMatch?.[1]?.trim();
	const result: {name: string; args?: string} = {name: nameMatch[1]!};
	if (args) result.args = args;
	return result;
}

export function extractSessionTitle(text: string, fallback?: string): string {
	const cleaned = cleanCommandText(text);
	if (!cleaned) return fallback ?? 'Untitled Session';

	if (cleaned.length <= 80) return cleaned;

	const truncated = cleaned.slice(0, 80);
	const lastSpace = truncated.lastIndexOf(' ');
	if (lastSpace > 40) {
		return truncated.slice(0, lastSpace) + '...';
	}
	return truncated + '...';
}

/**
 * Tool labels keyed by category. Each entry maps to a function that produces
 * the human label for the given count (and any extra context). Order of keys
 * here is also the desired display order in the summary string.
 */
const TOOL_CATEGORIES = [
	'edit',
	'grep',
	'read',
	'glob',
	'webfetch',
	'websearch',
	'agent',
	'unknown',
	'bash',
	'recall',
	'memwrite',
] as const;
type ToolCategory = (typeof TOOL_CATEGORIES)[number];

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);

/**
 * Return true if `filePath` looks like a Claude memory file.
 *
 * Memory files live under either `~/.claude/memory/` (global) or
 * `~/.claude/projects/{project}/memory/` (per-project), and end in `.md`.
 */
function isMemoryPath(filePath: string): boolean {
	if (!filePath.endsWith('.md')) return false;
	if (!filePath.includes('/.claude/')) return false;
	return /\/\.claude\/(?:memory\/|projects\/[^/]+\/memory\/)/.test(filePath);
}

/**
 * Extract `+added -removed` line counts from an Edit/MultiEdit/Write input.
 * Falls back to zeros when the input doesn't contain enough information.
 */
function diffStatsForEditCall(call: ToolCallInfo): {added: number; removed: number} {
	const input = call.input;
	if (call.name === 'Write') {
		const content = typeof input['content'] === 'string' ? (input['content'] as string) : '';
		// Treat a Write as adding all lines (we don't have the prior file content here).
		const added = content === '' ? 0 : content.split('\n').length;
		return {added, removed: 0};
	}
	if (call.name === 'Edit') {
		const oldStr = typeof input['old_string'] === 'string' ? (input['old_string'] as string) : '';
		const newStr = typeof input['new_string'] === 'string' ? (input['new_string'] as string) : '';
		return countDiffLines(oldStr, newStr);
	}
	if (call.name === 'MultiEdit') {
		const edits = Array.isArray(input['edits']) ? (input['edits'] as Array<Record<string, unknown>>) : [];
		let added = 0;
		let removed = 0;
		if (edits.length > 0) {
			for (const e of edits) {
				const oldStr = typeof e['old_string'] === 'string' ? (e['old_string'] as string) : '';
				const newStr = typeof e['new_string'] === 'string' ? (e['new_string'] as string) : '';
				const stats = countDiffLines(oldStr, newStr);
				added += stats.added;
				removed += stats.removed;
			}
			return {added, removed};
		}
		// MultiEdit with top-level old_string/new_string (older format)
		const oldStr = typeof input['old_string'] === 'string' ? (input['old_string'] as string) : '';
		const newStr = typeof input['new_string'] === 'string' ? (input['new_string'] as string) : '';
		return countDiffLines(oldStr, newStr);
	}
	return {added: 0, removed: 0};
}

/**
 * Approximate added/removed line counts without computing the full LCS diff.
 * Lines present in `newStr` but not in `oldStr` count as added; lines present
 * in `oldStr` but not in `newStr` count as removed. This matches the way the
 * Claude Code summary reports diff totals at a glance.
 */
function countDiffLines(oldStr: string, newStr: string): {added: number; removed: number} {
	if (oldStr === newStr) return {added: 0, removed: 0};
	const oldLines = oldStr === '' ? [] : oldStr.split('\n');
	const newLines = newStr === '' ? [] : newStr.split('\n');
	const oldCounts = new Map<string, number>();
	for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1);
	const newCounts = new Map<string, number>();
	for (const line of newLines) newCounts.set(line, (newCounts.get(line) ?? 0) + 1);

	let added = 0;
	for (const [line, count] of newCounts) {
		const inOld = oldCounts.get(line) ?? 0;
		if (count > inOld) added += count - inOld;
	}
	let removed = 0;
	for (const [line, count] of oldCounts) {
		const inNew = newCounts.get(line) ?? 0;
		if (count > inNew) removed += count - inNew;
	}
	return {added, removed};
}

function categorize(call: ToolCallInfo): ToolCategory {
	const filePath = typeof call.input['file_path'] === 'string' ? (call.input['file_path'] as string) : '';
	if (call.name === 'Read') {
		return isMemoryPath(filePath) ? 'recall' : 'read';
	}
	if (call.name === 'Write') {
		return isMemoryPath(filePath) ? 'memwrite' : 'edit';
	}
	if (EDIT_TOOLS.has(call.name)) return 'edit';
	if (call.name === 'Bash') return 'bash';
	if (call.name === 'Grep') return 'grep';
	if (call.name === 'Glob') return 'glob';
	if (call.name === 'Agent') return 'agent';
	if (call.name === 'WebFetch') return 'webfetch';
	if (call.name === 'WebSearch') return 'websearch';
	return 'unknown';
}

function pluralize(count: number, singular: string, plural: string): string {
	if (count === 1) return singular;
	return plural.replace('{n}', String(count));
}

export function summarizeToolCalls(calls: ToolCallInfo[]): string {
	if (calls.length === 0) return '';

	const counts = new Map<ToolCategory, number>();
	const editStats = {added: 0, removed: 0};

	for (const call of calls) {
		const cat = categorize(call);
		counts.set(cat, (counts.get(cat) ?? 0) + 1);
		if (cat === 'edit') {
			const s = diffStatsForEditCall(call);
			editStats.added += s.added;
			editStats.removed += s.removed;
		}
	}

	const parts: string[] = [];
	for (const cat of TOOL_CATEGORIES) {
		const count = counts.get(cat) ?? 0;
		if (count === 0) continue;
		switch (cat) {
			case 'edit': {
				let label = pluralize(count, 'edited a file', 'edited {n} files');
				const {added, removed} = editStats;
				if (added > 0 && removed > 0) label += ` +${added} -${removed}`;
				else if (added > 0) label += ` +${added}`;
				else if (removed > 0) label += ` -${removed}`;
				parts.push(label);
				break;
			}
			case 'grep':
				parts.push(pluralize(count, 'searched for a pattern', 'searched for {n} patterns'));
				break;
			case 'read':
				parts.push(pluralize(count, 'read a file', 'read {n} files'));
				break;
			case 'glob':
				parts.push(pluralize(count, 'globbed for files', 'ran {n} glob searches'));
				break;
			case 'webfetch':
				parts.push(pluralize(count, 'fetched a page', 'fetched {n} pages'));
				break;
			case 'websearch':
				parts.push(pluralize(count, 'searched the web', 'ran {n} web searches'));
				break;
			case 'agent':
				parts.push(pluralize(count, 'ran an agent', 'ran {n} agents'));
				break;
			case 'unknown':
				parts.push(pluralize(count, 'called a tool', 'called {n} tools'));
				break;
			case 'bash':
				parts.push(pluralize(count, 'ran a bash command', 'ran {n} bash commands'));
				break;
			case 'recall':
				parts.push(pluralize(count, 'recalled a memory', 'recalled {n} memories'));
				break;
			case 'memwrite':
				parts.push(pluralize(count, 'wrote a memory', 'wrote {n} memories'));
				break;
		}
	}

	return parts.join(', ');
}

interface JsonlEntry {
	type: string;
	uuid?: string;
	timestamp?: string;
	customTitle?: string;
	sessionId?: string;
	message?: {
		role?: string;
		content?: string | ContentBlock[];
	};
}

interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	id?: string;
	input?: Record<string, unknown>;
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
	source?: {type: string; media_type: string; data: string};
}

function extractFirstUserText(line: string): string | null {
	try {
		const obj = JSON.parse(line) as JsonlEntry;
		if (obj.type !== 'user') return null;

		const content = obj.message?.content;
		if (!content) return null;

		if (typeof content === 'string') return content;

		if (Array.isArray(content)) {
			for (const block of content) {
				if (block.type === 'text' && typeof block.text === 'string') {
					return block.text;
				}
			}
		}
	} catch {
		// skip malformed lines
	}
	return null;
}

async function readFirstUserMessage(filePath: string): Promise<string | null> {
	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});

	try {
		for await (const line of rl) {
			if (!line.trim()) continue;
			const text = extractFirstUserText(line);
			if (text !== null) return text;
		}
	} finally {
		rl.close();
	}
	return null;
}

function resolveTitle(entry: {
	customTitle?: string | undefined;
	summary?: string | undefined;
	firstPrompt?: string | undefined;
	sessionId: string;
}): string {
	if (entry.customTitle) return entry.customTitle;
	if (entry.summary) return entry.summary;
	if (entry.firstPrompt) return extractSessionTitle(entry.firstPrompt, entry.sessionId);
	return entry.sessionId;
}

export async function listSessionsForProject(projectsDir: string, project: string): Promise<SessionEntry[] | null> {
	const projectDir = join(projectsDir, project);
	const indexPath = join(projectDir, 'sessions-index.json');
	let raw: string;
	try {
		raw = await readFile(indexPath, 'utf-8');
	} catch {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}

	const result = SessionsIndexSchema.safeParse(parsed);
	if (!result.success) {
		return null;
	}

	const firstProjectPath = result.data.entries[0]?.projectPath;
	const projectName = decodeProjectDir(project, firstProjectPath);
	const sessions: SessionEntry[] = [];
	const indexedIds = new Set<string>();

	for (const entry of result.data.entries) {
		indexedIds.add(entry.sessionId);
		if (entry.isSidechain) continue;

		const title = resolveTitle({
			summary: entry.summary,
			firstPrompt: entry.firstPrompt,
			sessionId: entry.sessionId,
		});

		sessions.push({
			id: entry.sessionId,
			title,
			firstPrompt: entry.firstPrompt,
			summary: entry.summary,
			mtime: new Date(entry.fileMtime),
			created: entry.created ? new Date(entry.created) : new Date(entry.fileMtime),
			project,
			projectName,
			projectPath: entry.projectPath,
			messageCount: entry.messageCount ?? 0,
			gitBranch: entry.gitBranch,
			isSidechain: entry.isSidechain ?? false,
		});
	}

	// Pick up JSONL files not in the index (created after index was last rebuilt)
	let files: string[];
	try {
		files = await readdir(projectDir);
	} catch {
		return sessions;
	}

	for (const file of files) {
		if (!file.endsWith('.jsonl')) continue;
		const id = file.replace(/\.jsonl$/, '');
		if (indexedIds.has(id)) continue;

		const filePath = join(projectDir, file);
		try {
			const fileStat = await stat(filePath);
			const text = await readFirstUserMessage(filePath);
			const title = extractSessionTitle(text ?? '', id);
			sessions.push({
				id,
				title,
				firstPrompt: text ?? undefined,
				mtime: fileStat.mtime,
				created: fileStat.birthtime,
				project,
				projectName,
				projectPath: firstProjectPath,
				messageCount: 0,
				isSidechain: false,
			});
		} catch {
			// skip
		}
	}

	return sessions;
}

export async function listSessionsFromJsonl(projectsDir: string, project: string): Promise<SessionEntry[]> {
	const projectPath = join(projectsDir, project);
	let files: string[];
	try {
		files = await readdir(projectPath);
	} catch {
		return [];
	}

	const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
	if (jsonlFiles.length === 0) return [];

	const projectName = await resolveProjectName(project);
	const sessions: SessionEntry[] = [];

	for (const file of jsonlFiles) {
		const filePath = join(projectPath, file);
		try {
			const fileStat = await stat(filePath);
			const id = file.replace(/\.jsonl$/, '');
			const text = await readFirstUserMessage(filePath);
			const title = extractSessionTitle(text ?? '', id);
			sessions.push({
				id,
				title,
				firstPrompt: text ?? undefined,
				mtime: fileStat.mtime,
				created: fileStat.birthtime,
				project,
				projectName,
				messageCount: 0,
				isSidechain: false,
			});
		} catch {
			// skip unreadable files
		}
	}

	return sessions;
}

export async function listSessions(projectsDir: string): Promise<SessionProjectGroup[]> {
	let projectDirs: string[];
	try {
		projectDirs = await readdir(projectsDir);
	} catch {
		return [];
	}

	const groups: SessionProjectGroup[] = [];

	for (const project of projectDirs) {
		const projectPath = join(projectsDir, project);
		try {
			const dirStat = await stat(projectPath);
			if (!dirStat.isDirectory()) continue;
		} catch {
			continue;
		}

		let sessions = await listSessionsForProject(projectsDir, project);
		if (!sessions) {
			sessions = await listSessionsFromJsonl(projectsDir, project);
		}

		if (sessions.length === 0) continue;
		sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
		const projectName = sessions[0]?.projectName ?? (await resolveProjectName(project));
		groups.push({project, projectName, sessions});
	}

	const maxMtimes = new Map(groups.map((g) => [g.project, Math.max(...g.sessions.map((s) => s.mtime.getTime()))]));
	groups.sort((a, b) => maxMtimes.get(b.project)! - maxMtimes.get(a.project)!);

	return groups;
}

function extractToolResultContent(content: unknown): string | undefined {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		const texts: string[] = [];
		for (const item of content) {
			if (typeof item === 'object' && item !== null && 'type' in item && 'text' in item) {
				const block = item as {type: string; text: string};
				if (block.type === 'text' && typeof block.text === 'string') {
					texts.push(block.text);
				}
			}
		}
		return texts.length > 0 ? texts.join('\n') : undefined;
	}
	return undefined;
}

function stripResultTags(text: string): string {
	let result = text;
	result = result.replace(/<\/?tool_use_error>/g, '');
	result = result.replace(/<\/?persisted-output>/g, '');
	result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
	if (result !== text) result = result.trim();
	return result;
}

function truncateResult(text: string, maxLines: number): string {
	const lines = text.split('\n');
	if (lines.length <= maxLines) return text;
	const truncated = lines.slice(0, maxLines);
	truncated.push(`... (${lines.length - maxLines} more lines)`);
	return truncated.join('\n');
}

const SESSION_ID_RE = /^[a-z0-9-]+$/;

async function resolveSessionFilePath(
	projectsDir: string,
	sessionId: string,
): Promise<{filePath: string; project: string} | null> {
	if (!SESSION_ID_RE.test(sessionId)) return null;
	if (sessionId.includes('..')) return null;

	let projectDirs: string[];
	try {
		projectDirs = await readdir(projectsDir);
	} catch {
		return null;
	}

	const filename = `${sessionId}.jsonl`;

	for (const dir of projectDirs) {
		const candidate = join(projectsDir, dir, filename);
		try {
			await stat(candidate);
			return {filePath: candidate, project: dir};
		} catch {
			// not in this dir
		}
	}

	if (sessionId.startsWith('agent-')) {
		for (const dir of projectDirs) {
			const subagentsDir = join(projectsDir, dir);
			let sessionDirs: string[];
			try {
				sessionDirs = await readdir(subagentsDir);
			} catch {
				continue;
			}

			for (const sessionDir of sessionDirs) {
				const candidate = join(projectsDir, dir, sessionDir, 'subagents', filename);
				try {
					await stat(candidate);
					return {filePath: candidate, project: dir};
				} catch {
					// not in this subagent dir
				}
			}
		}
	}

	return null;
}

export interface RawJsonlLine {
	raw: string;
	lineIndex: number;
	uuid?: string;
	parseError?: boolean;
}

export interface RawWindow {
	focal: RawJsonlLine;
	before: RawJsonlLine[];
	after: RawJsonlLine[];
}

function parseRawLine(raw: string, lineIndex: number): RawJsonlLine {
	try {
		const parsed = JSON.parse(raw) as Record<string, unknown>;
		const uuid = typeof parsed['uuid'] === 'string' ? parsed['uuid'] : undefined;
		const result: RawJsonlLine = {raw, lineIndex};
		if (uuid !== undefined) result.uuid = uuid;
		return result;
	} catch {
		return {raw, lineIndex, parseError: true};
	}
}

export async function readSessionRawWindow(
	projectsDir: string,
	sessionId: string,
	focalUuid: string,
	contextN = 5,
): Promise<RawWindow | null> {
	const resolved = await resolveSessionFilePath(projectsDir, sessionId);
	if (!resolved) return null;

	const rl = createInterface({
		input: createReadStream(resolved.filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});

	const ringBuffer: RawJsonlLine[] = [];
	let focal: RawJsonlLine | null = null;
	const after: RawJsonlLine[] = [];
	let lineIndex = -1;

	try {
		for await (const line of rl) {
			lineIndex++;
			if (!line.trim()) continue;
			const entry = parseRawLine(line, lineIndex);

			if (focal === null) {
				if (entry.uuid === focalUuid) {
					focal = entry;
				} else {
					ringBuffer.push(entry);
					if (ringBuffer.length > contextN) ringBuffer.shift();
				}
			} else {
				after.push(entry);
				if (after.length >= contextN) break;
			}
		}
	} finally {
		rl.close();
	}

	if (!focal) return null;

	return {focal, before: ringBuffer, after};
}

export async function readSession(projectsDir: string, sessionId: string): Promise<SessionDetail | null> {
	const resolved = await resolveSessionFilePath(projectsDir, sessionId);
	if (!resolved) return null;
	const {filePath, project} = resolved;

	const projectName = await resolveProjectName(project);
	const messages: SessionMessage[] = [];
	let title = sessionId;
	let customTitle: string | undefined;
	const toolCallMap = new Map<string, ToolCallInfo>();
	const toolStartTimes = new Map<string, number>();
	const uuidToLine = new Map<string, number>();

	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});

	let lineIndex = -1;
	try {
		for await (const line of rl) {
			lineIndex++;
			if (!line.trim()) continue;

			let obj: JsonlEntry;
			try {
				obj = JSON.parse(line) as JsonlEntry;
			} catch {
				continue;
			}

			const sourceUuid = typeof obj.uuid === 'string' ? obj.uuid : '';
			if (sourceUuid) uuidToLine.set(sourceUuid, lineIndex);

			if (obj.type === 'custom-title') {
				const parsed = CustomTitleRecordSchema.safeParse(obj);
				if (parsed.success) {
					customTitle = parsed.data.customTitle;
				}
				continue;
			}

			const type = obj.type;
			if (type !== 'user' && type !== 'assistant') continue;

			const message = obj.message;
			if (!message) continue;

			const timestamp = obj.timestamp ?? '';
			const textBlocks: string[] = [];
			const contentBlocks: MessageContent[] = [];
			const toolCalls: ToolCallInfo[] = [];
			const content = message.content;
			let isCommand = false;

			if (type === 'user') {
				const processUserText = (text: string) => {
					const cmd = parseCommandBlock(text);
					if (cmd) {
						isCommand = true;
						const label = cmd.args ? `${cmd.name} ${cmd.args}` : cmd.name;
						textBlocks.push(label);
						const cmdContent = {type: 'command', name: cmd.name, sourceUuid} as MessageContent & {
							type: 'command';
						};
						if (cmd.args) cmdContent.args = cmd.args;
						contentBlocks.push(cmdContent);
						return;
					}
					const bashIn = parseBashInput(text);
					if (bashIn) {
						contentBlocks.push({type: 'bash-input', command: bashIn.command, sourceUuid});
						return;
					}
					const bashOut = parseBashOutput(text);
					if (bashOut) {
						contentBlocks.push({
							type: 'bash-output',
							stdout: bashOut.stdout,
							stderr: bashOut.stderr,
							sourceUuid,
						});
						return;
					}
					if (/<local-command-caveat>/.test(text)) return;
					const cleaned = stripCommandTags(text);
					if (cleaned) {
						textBlocks.push(cleaned);
						contentBlocks.push({type: 'text', text: cleaned, sourceUuid});
					}
				};

				if (typeof content === 'string') {
					processUserText(content);
				} else if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === 'text' && typeof block.text === 'string') {
							processUserText(block.text);
						} else if (block.type === 'image' && block.source) {
							contentBlocks.push({
								type: 'image',
								mediaType: block.source.media_type,
								data: block.source.data,
								sourceUuid,
							});
						} else if (block.type === 'document' && block.source) {
							contentBlocks.push({
								type: 'document',
								mediaType: block.source.media_type,
								data: block.source.data,
								sourceUuid,
							});
						} else if (block.type === 'tool_result' && block.tool_use_id) {
							const rawResult = extractToolResultContent(block.content);
							const info = toolCallMap.get(block.tool_use_id);
							if (info && rawResult !== undefined) {
								const resultText = stripResultTags(rawResult);
								info.result = truncateResult(resultText, 150);
								if (block.is_error) info.isError = true;
								if (sourceUuid) info.resultUuid = sourceUuid;
								const startTime = toolStartTimes.get(block.tool_use_id);
								if (startTime && timestamp) {
									const resultTime = new Date(timestamp).getTime();
									if (!isNaN(resultTime) && resultTime > startTime) {
										info.duration = resultTime - startTime;
									}
								}
							}
						}
					}
				}
			} else {
				if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === 'text' && typeof block.text === 'string') {
							textBlocks.push(block.text);
							contentBlocks.push({type: 'text', text: block.text, sourceUuid});
						} else if (block.type === 'thinking' && typeof block.thinking === 'string') {
							contentBlocks.push({type: 'thinking', thinking: block.thinking, sourceUuid});
						} else if (block.type === 'tool_use') {
							const tc: ToolCallInfo = {
								id: block.id ?? '',
								name: block.name as string,
								input: block.input ?? {},
								sourceUuid,
							};
							if (timestamp) tc.startedAt = timestamp;
							toolCalls.push(tc);
							if (tc.id) {
								toolCallMap.set(tc.id, tc);
								if (timestamp) {
									const t = new Date(timestamp).getTime();
									if (!isNaN(t)) toolStartTimes.set(tc.id, t);
								}
							}
							contentBlocks.push({
								type: 'tool_use',
								id: tc.id,
								name: tc.name,
								input: tc.input,
								sourceUuid,
							});
						}
					}
				}
			}

			if (textBlocks.length === 0 && toolCalls.length === 0 && contentBlocks.length === 0) continue;

			if (type === 'user' && textBlocks.length > 0 && title === sessionId) {
				title = extractSessionTitle(textBlocks[0]!, sessionId);
			}

			const last = messages[messages.length - 1];
			if (last && last.role === type) {
				if (last.isCommand) {
					last.toolCalls.push(...toolCalls);
					last.content.push(...contentBlocks);
				} else {
					last.textBlocks.push(...textBlocks);
					last.toolCalls.push(...toolCalls);
					last.content.push(...contentBlocks);
				}
			} else {
				const msg: SessionMessage = {
					role: type as 'user' | 'assistant',
					textBlocks,
					content: contentBlocks,
					toolCalls,
					timestamp,
				};
				if (isCommand) msg.isCommand = true;
				messages.push(msg);
			}
		}
	} finally {
		rl.close();
	}

	if (customTitle) title = customTitle;

	return {id: sessionId, title, projectName, projectId: project, messages, uuidToLine};
}

export async function readSessionLines(projectsDir: string, sessionId: string): Promise<SessionLines | null> {
	const resolved = await resolveSessionFilePath(projectsDir, sessionId);
	if (!resolved) return null;
	const {filePath, project} = resolved;

	const projectName = await resolveProjectName(project);
	const lines: SessionLine[] = [];
	let title = sessionId;
	let customTitle: string | undefined;
	const uuidToLine = new Map<string, number>();
	const toolResultMap = new Map<string, ToolResultInfo>();
	const toolStartTimes = new Map<string, number>();

	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});

	let lineIndex = -1;
	try {
		for await (const line of rl) {
			lineIndex++;
			if (!line.trim()) continue;

			let obj: Record<string, unknown>;
			try {
				obj = JSON.parse(line) as Record<string, unknown>;
			} catch {
				continue;
			}

			const uuid = typeof obj['uuid'] === 'string' ? obj['uuid'] : undefined;
			if (uuid) uuidToLine.set(uuid, lineIndex);

			const type = obj['type'] as string;

			if (type === 'custom-title') {
				const parsed = CustomTitleRecordSchema.safeParse(obj);
				if (parsed.success) {
					customTitle = parsed.data.customTitle;
				}
				continue;
			}

			// Extract title from first user text
			if (type === 'user' && title === sessionId) {
				const message = obj['message'] as {content?: string | SessionContentBlock[]} | undefined;
				if (message?.content) {
					if (typeof message.content === 'string') {
						const cleaned = stripCommandTags(message.content);
						if (cleaned) title = extractSessionTitle(cleaned, sessionId);
					} else if (Array.isArray(message.content)) {
						for (const block of message.content) {
							if (block.type === 'text' && typeof block.text === 'string') {
								const cleaned = stripCommandTags(block.text);
								if (cleaned) {
									title = extractSessionTitle(cleaned, sessionId);
									break;
								}
							}
						}
					}
				}
			}

			// Build tool_use -> tool_result pairing map
			if (type === 'assistant') {
				const message = obj['message'] as {content?: SessionContentBlock[]} | undefined;
				const timestamp = typeof obj['timestamp'] === 'string' ? obj['timestamp'] : undefined;
				if (Array.isArray(message?.content)) {
					for (const block of message.content) {
						if (block.type === 'tool_use' && block.id) {
							if (timestamp) {
								const t = new Date(timestamp).getTime();
								if (!isNaN(t)) toolStartTimes.set(block.id, t);
							}
						}
					}
				}
			}

			if (type === 'user') {
				const message = obj['message'] as {content?: string | SessionContentBlock[]} | undefined;
				const timestamp = typeof obj['timestamp'] === 'string' ? obj['timestamp'] : undefined;
				if (Array.isArray(message?.content)) {
					for (const block of message.content as SessionContentBlock[]) {
						if (block.type === 'tool_result' && block.tool_use_id) {
							const rawResult = extractToolResultContent(block.content);
							if (rawResult !== undefined) {
								const resultText = stripResultTags(rawResult);
								const info: ToolResultInfo = {
									result: truncateResult(resultText, 150),
									isError: block.is_error === true,
									resultUuid: uuid ?? '',
								};
								const startTime = toolStartTimes.get(block.tool_use_id);
								if (startTime && timestamp) {
									const resultTime = new Date(timestamp).getTime();
									if (!isNaN(resultTime) && resultTime > startTime) {
										info.duration = resultTime - startTime;
									}
								}
								toolResultMap.set(block.tool_use_id, info);
							}
						}
					}
				}
			}

			// Only include user/assistant lines for the rendering tree
			if (type !== 'user' && type !== 'assistant') continue;

			const sessionLine: SessionLine = {
				type,
				lineIndex,
			};
			if (uuid !== undefined) sessionLine.uuid = uuid;
			const parentUuid = obj['parentUuid'];
			if (typeof parentUuid === 'string') sessionLine.parentUuid = parentUuid;
			const timestamp = obj['timestamp'];
			if (typeof timestamp === 'string') sessionLine.timestamp = timestamp;
			const message = obj['message'] as {role?: string; content?: string | SessionContentBlock[]} | undefined;
			if (message) sessionLine.message = message;

			lines.push(sessionLine);
		}
	} finally {
		rl.close();
	}

	if (customTitle) title = customTitle;

	return {id: sessionId, title, projectName, projectId: project, lines, toolResultMap, uuidToLine};
}

export function getSessionsDir(): string {
	return join(homedir(), '.claude', 'projects');
}
