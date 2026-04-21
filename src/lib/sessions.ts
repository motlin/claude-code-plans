import {createReadStream} from 'node:fs';
import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import {decodeProjectDir, resolveProjectName} from './memory';
import {SessionsIndexSchema, CustomTitleRecordSchema, JsonlRecordSchema} from './schemas';

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
	cwd?: string | undefined;
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

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- TanStack serialization narrows unknown to {}
type SerializableValue = Record<string, {}>;

/**
 * A content block serializable via TanStack. Mirrors the Zod ContentBlock
 * discriminated union but uses SerializableValue for the tool_use input field
 * so TanStack's serialization validation passes. The `type` field is a string
 * literal union matching all known content block types from the Zod schema.
 */
export interface SerializableContentBlock {
	type: 'text' | 'tool_use' | 'thinking' | 'tool_result' | 'image' | 'document';
	text?: string | undefined;
	thinking?: string | undefined;
	signature?: string | undefined;
	name?: string | undefined;
	id?: string | undefined;
	input?: SerializableValue | undefined;
	caller?: string | SerializableValue | undefined;
	tool_use_id?: string | undefined;
	content?: string | Array<{type: string; text: string}> | undefined;
	is_error?: boolean | undefined;
	source?: {type: string; media_type: string; data: string} | undefined;
}

/**
 * SessionContentBlock is the serializable content block type used
 * in SessionLine and passed across the TanStack serialization boundary.
 */
export type SessionContentBlock = SerializableContentBlock;

/**
 * A single parsed JSONL line for rendering. Only user and assistant records
 * are included in the rendering array. The `type` field is a string literal
 * union so TypeScript narrows the message shape after checking it.
 */
export interface SessionLine {
	type: 'user' | 'assistant';
	uuid?: string | undefined;
	parentUuid?: string | undefined;
	timestamp?: string | undefined;
	message?:
		| {
				role?: string | undefined;
				content?: string | SerializableContentBlock[] | undefined;
		  }
		| undefined;
	customTitle?: string | undefined;
	sessionId?: string | undefined;
	lineIndex: number;
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

import {
	stripCommandTags,
	parseBashInput,
	parseBashOutput,
	parseCommandBlock,
	extractSessionTitle,
	summarizeToolCalls,
} from './session-utils';

export {stripCommandTags, parseBashInput, parseBashOutput, parseCommandBlock, extractSessionTitle, summarizeToolCalls};

interface RawContentBlock {
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

interface JsonlEntry {
	type: string;
	uuid?: string;
	timestamp?: string;
	customTitle?: string;
	sessionId?: string;
	message?: {
		role?: string;
		content?: string | RawContentBlock[];
	};
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
		for await (const rawLine of rl) {
			lineIndex++;
			if (!rawLine.trim()) continue;

			let json: unknown;
			try {
				json = JSON.parse(rawLine);
			} catch {
				continue;
			}

			const parsed = JsonlRecordSchema.safeParse(json);
			if (!parsed.success) continue;
			const record = parsed.data;

			const uuid = 'uuid' in record && typeof record.uuid === 'string' ? record.uuid : undefined;
			if (uuid) uuidToLine.set(uuid, lineIndex);

			if (record.type === 'custom-title') {
				customTitle = record.customTitle;
				continue;
			}

			// Extract title from first user text
			if (record.type === 'user' && title === sessionId) {
				const {content} = record.message;
				if (typeof content === 'string') {
					const cleaned = stripCommandTags(content);
					if (cleaned) title = extractSessionTitle(cleaned, sessionId);
				} else if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === 'text') {
							const cleaned = stripCommandTags(block.text);
							if (cleaned) {
								title = extractSessionTitle(cleaned, sessionId);
								break;
							}
						}
					}
				}
			}

			// Build tool_use -> tool_result pairing map
			if (record.type === 'assistant') {
				const {content} = record.message;
				const timestamp = record.timestamp;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === 'tool_use') {
							if (timestamp) {
								const t = new Date(timestamp).getTime();
								if (!isNaN(t)) toolStartTimes.set(block.id, t);
							}
						}
					}
				}
			}

			if (record.type === 'user') {
				const {content} = record.message;
				const timestamp = record.timestamp;
				if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === 'tool_result') {
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
			if (record.type !== 'user' && record.type !== 'assistant') continue;

			const sessionLine: SessionLine = {
				type: record.type,
				lineIndex,
			};
			if (uuid !== undefined) sessionLine.uuid = uuid;
			if (typeof record.parentUuid === 'string') sessionLine.parentUuid = record.parentUuid;
			if (record.timestamp !== undefined) sessionLine.timestamp = record.timestamp;
			// The Zod-parsed message is structurally compatible with SessionLine.message
			// but uses Record<string, unknown> for tool input vs SerializableValue.
			// Cast is safe because the runtime data is identical.
			sessionLine.message = record.message as SessionLine['message'];

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
