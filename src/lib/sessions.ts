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
}

export type MessageContent =
	| {type: 'text'; text: string}
	| {type: 'thinking'; thinking: string}
	| {type: 'image'; mediaType: string; data: string}
	| {type: 'document'; mediaType: string; data: string}
	| {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>}
	| {type: 'tool_result'; toolUseId: string; content: string; isError: boolean}
	| {type: 'command'; name: string; args?: string};

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

const TOOL_LABELS: Record<string, {singular: string; plural: string}> = {
	Read: {singular: 'read a file', plural: 'read {n} files'},
	Edit: {singular: 'edited a file', plural: 'edited {n} files'},
	MultiEdit: {singular: 'edited a file', plural: 'edited {n} files'},
	Write: {singular: 'wrote a file', plural: 'wrote {n} files'},
	Bash: {singular: 'ran a command', plural: 'ran {n} commands'},
	Glob: {singular: 'found files', plural: 'found files'},
	Grep: {singular: 'searched code', plural: 'searched code'},
	Agent: {singular: 'ran an agent', plural: 'ran {n} agents'},
	WebFetch: {singular: 'fetched a page', plural: 'fetched {n} pages'},
	WebSearch: {singular: 'searched the web', plural: 'searched the web'},
	ToolSearch: {singular: 'searched tools', plural: 'searched tools'},
};

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);

export function summarizeToolCalls(calls: ToolCallInfo[]): string {
	if (calls.length === 0) return '';

	const counts = new Map<string, number>();
	for (const call of calls) {
		const key = EDIT_TOOLS.has(call.name) ? 'Edit' : call.name;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}

	const parts: string[] = [];
	for (const [name, count] of counts) {
		const labels = TOOL_LABELS[name];
		if (!labels) {
			parts.push(count === 1 ? `used ${name}` : `used ${name} ${count} times`);
			continue;
		}
		if (count === 1) {
			parts.push(labels.singular);
		} else {
			parts.push(labels.plural.replace('{n}', String(count)));
		}
	}

	return parts.join(', ');
}

interface JsonlEntry {
	type: string;
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

export async function readSession(projectsDir: string, sessionId: string): Promise<SessionDetail | null> {
	if (!SESSION_ID_RE.test(sessionId)) return null;
	if (sessionId.includes('..')) return null;

	let projectDirs: string[];
	try {
		projectDirs = await readdir(projectsDir);
	} catch {
		return null;
	}

	const filename = `${sessionId}.jsonl`;
	let filePath: string | null = null;
	let project = '';

	// First, try to find the session as a regular top-level file
	for (const dir of projectDirs) {
		const candidate = join(projectsDir, dir, filename);
		try {
			await stat(candidate);
			filePath = candidate;
			project = dir;
			break;
		} catch {
			// not in this dir
		}
	}

	// If not found and sessionId starts with 'agent-', try looking in subagent directories
	if (!filePath && sessionId.startsWith('agent-')) {
		for (const dir of projectDirs) {
			// Look for the agent file in nested session subagent directories
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
					filePath = candidate;
					project = dir;
					break;
				} catch {
					// not in this subagent dir
				}
			}

			if (filePath) break;
		}
	}

	if (!filePath) return null;

	const projectName = await resolveProjectName(project);
	const messages: SessionMessage[] = [];
	let title = sessionId;
	let customTitle: string | undefined;
	const toolCallMap = new Map<string, ToolCallInfo>();
	const toolStartTimes = new Map<string, number>();

	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});

	try {
		for await (const line of rl) {
			if (!line.trim()) continue;

			let obj: JsonlEntry;
			try {
				obj = JSON.parse(line) as JsonlEntry;
			} catch {
				continue;
			}

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
						const cmdContent = {type: 'command', name: cmd.name} as MessageContent & {type: 'command'};
						if (cmd.args) cmdContent.args = cmd.args;
						contentBlocks.push(cmdContent);
						return;
					}
					if (/<local-command-caveat>/.test(text)) return;
					const cleaned = stripCommandTags(text);
					if (cleaned) {
						textBlocks.push(cleaned);
						contentBlocks.push({type: 'text', text: cleaned});
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
							});
						} else if (block.type === 'document' && block.source) {
							contentBlocks.push({
								type: 'document',
								mediaType: block.source.media_type,
								data: block.source.data,
							});
						} else if (block.type === 'tool_result' && block.tool_use_id) {
							const rawResult = extractToolResultContent(block.content);
							const info = toolCallMap.get(block.tool_use_id);
							if (info && rawResult !== undefined) {
								const resultText = stripResultTags(rawResult);
								info.result = truncateResult(resultText, 150);
								if (block.is_error) info.isError = true;
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
							contentBlocks.push({type: 'text', text: block.text});
						} else if (block.type === 'thinking' && typeof block.thinking === 'string') {
							contentBlocks.push({type: 'thinking', thinking: block.thinking});
						} else if (block.type === 'tool_use') {
							const tc: ToolCallInfo = {
								id: block.id ?? '',
								name: block.name as string,
								input: block.input ?? {},
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
							contentBlocks.push({type: 'tool_use', id: tc.id, name: tc.name, input: tc.input});
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

	return {id: sessionId, title, projectName, projectId: project, messages};
}

export function getSessionsDir(): string {
	return join(homedir(), '.claude', 'projects');
}
