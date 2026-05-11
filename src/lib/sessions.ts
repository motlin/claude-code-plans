import {createReadStream} from 'node:fs';
import {readdir, readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {decodeProjectDir, resolveProjectName} from './memory';
import type {JsonValue} from './hook-events';
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
	cwd?: string | undefined;
	isSidechain: boolean;
}

export interface SessionProjectGroup {
	project: string;
	projectName: string;
	sessions: SessionEntry[];
}

/**
 * Internal type for readSession() tool call pairing.
 * Not exported -- consumers that need a tool call shape should use
 * ToolCallLike from session-utils.ts instead.
 */
interface ToolCallInfo {
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

type MessageContent =
	| {type: 'text'; text: string; sourceUuid: string}
	| {type: 'thinking'; thinking: string; sourceUuid: string}
	| {type: 'image'; mediaType: string; data: string; sourceUuid: string}
	| {type: 'document'; mediaType: string; data: string; sourceUuid: string}
	| {type: 'tool_use'; id: string; name: string; input: Record<string, unknown>; sourceUuid: string}
	| {type: 'tool_result'; toolUseId: string; content: string; isError: boolean; sourceUuid: string}
	| {type: 'command'; name: string; args?: string; sourceUuid: string}
	| {type: 'bash-input'; command: string; sourceUuid: string}
	| {type: 'bash-output'; stdout: string; stderr: string; sourceUuid: string};

interface SessionMessage {
	role: 'user' | 'assistant';
	textBlocks: string[];
	content: MessageContent[];
	toolCalls: ToolCallInfo[];
	timestamp: string;
	isCommand?: boolean;
}

interface SessionDetail {
	id: string;
	title: string;
	projectName: string;
	projectId: string;
	messages: SessionMessage[];
	uuidToLine: Map<string, number>;
}

export type {SessionLine, MessageSessionLine, SessionContentBlock} from './transcript';

/**
 * Information about a tool_result paired with its tool_use.
 */
export interface ToolResultInfo {
	result: string;
	isError: boolean;
	resultUuid: string;
	duration?: number | undefined;
}

import {
	stripCommandTags,
	parseBashInput,
	parseBashOutput,
	parseCommandBlock,
	extractSessionTitle,
	summarizeToolCalls,
	summarizeToolCallsStructured,
	formatToolName,
	extractToolResultContent,
	stripResultTags,
	truncateResult,
} from './session-utils';

export {parseCommandBlock, extractSessionTitle, summarizeToolCalls, summarizeToolCallsStructured, formatToolName};

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

async function listSessionsForProject(projectsDir: string, project: string): Promise<SessionEntry[] | null> {
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

async function listSessionsFromJsonl(projectsDir: string, project: string): Promise<SessionEntry[]> {
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

/**
 * Read new JSONL lines from a file starting at a byte offset.
 * Returns the parsed JSON objects and the next byte offset to resume from.
 * Tracks bytes per successfully-parsed line (not stat().size) to handle
 * partial writes: an incomplete trailing line is skipped and re-read on
 * the next call.
 */
export async function readNewJsonlLines(
	filePath: string,
	fromByteOffset: number,
): Promise<{lines: Record<string, JsonValue>[]; nextByteOffset: number}> {
	const lines: Record<string, JsonValue>[] = [];
	let bytesConsumed = 0;

	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8', start: fromByteOffset}),
		crlfDelay: Infinity,
	});

	try {
		for await (const line of rl) {
			// Each line in the stream has its newline stripped by readline.
			// Account for the line content + 1 byte for the newline character.
			const lineByteLength = Buffer.byteLength(line, 'utf-8') + 1;
			if (!line.trim()) {
				bytesConsumed += lineByteLength;
				continue;
			}
			try {
				const parsed = JSON.parse(line) as Record<string, JsonValue>;
				lines.push(parsed);
				bytesConsumed += lineByteLength;
			} catch {
				// Partial/malformed line at the end of the file. Do not advance
				// the byte offset past it so we re-read it on the next change.
				break;
			}
		}
	} finally {
		rl.close();
	}

	return {lines, nextByteOffset: fromByteOffset + bytesConsumed};
}
