import {createReadStream} from 'node:fs';
import {readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {createInterface} from 'node:readline';
import {homedir} from 'node:os';
import {decodeProjectDir} from './memory';

export interface SessionEntry {
	id: string;
	title: string;
	mtime: Date;
	project: string;
	projectName: string;
}

export interface SessionProjectGroup {
	project: string;
	projectName: string;
	sessions: SessionEntry[];
}

export interface ToolCallInfo {
	name: string;
	input: Record<string, unknown>;
}

export interface SessionMessage {
	role: 'user' | 'assistant';
	textBlocks: string[];
	toolCalls: ToolCallInfo[];
	timestamp: string;
}

export interface SessionDetail {
	id: string;
	title: string;
	projectName: string;
	messages: SessionMessage[];
}

const COMMAND_TAG_RE =
	/<\/?(?:command-message|command-name|local-command-caveat|command-args|command|local-command-stdout)[^>]*>/g;

export function stripCommandTags(text: string): string {
	return text.replace(COMMAND_TAG_RE, '').trim();
}

export function extractSessionTitle(text: string, fallback?: string): string {
	const cleaned = text.replace(COMMAND_TAG_RE, '').trim();
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
		let files: string[];
		try {
			const dirStat = await stat(projectPath);
			if (!dirStat.isDirectory()) continue;
			files = await readdir(projectPath);
		} catch {
			continue;
		}

		const jsonlFiles = files.filter((f) => f.endsWith('.jsonl'));
		if (jsonlFiles.length === 0) continue;

		const projectName = decodeProjectDir(project);
		const sessions: SessionEntry[] = [];

		for (const file of jsonlFiles) {
			const filePath = join(projectPath, file);
			try {
				const fileStat = await stat(filePath);
				const id = file.replace(/\.jsonl$/, '');
				const text = await readFirstUserMessage(filePath);
				const title = extractSessionTitle(text ?? '', id);
				sessions.push({id, title, mtime: fileStat.mtime, project, projectName});
			} catch {
				// skip unreadable files
			}
		}

		if (sessions.length === 0) continue;
		sessions.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
		groups.push({project, projectName, sessions});
	}

	const maxMtimes = new Map(groups.map((g) => [g.project, Math.max(...g.sessions.map((s) => s.mtime.getTime()))]));
	groups.sort((a, b) => maxMtimes.get(b.project)! - maxMtimes.get(a.project)!);

	return groups;
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

	if (!filePath) return null;

	const projectName = decodeProjectDir(project);
	const messages: SessionMessage[] = [];
	let title = sessionId;

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

			const type = obj.type;
			if (type !== 'user' && type !== 'assistant') continue;

			const message = obj.message;
			if (!message) continue;

			const timestamp = obj.timestamp ?? '';
			const textBlocks: string[] = [];
			const toolCalls: ToolCallInfo[] = [];
			const content = message.content;

			if (type === 'user') {
				if (typeof content === 'string') {
					const cleaned = stripCommandTags(content);
					if (cleaned) textBlocks.push(cleaned);
				} else if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === 'text' && typeof block.text === 'string') {
							const cleaned = stripCommandTags(block.text);
							if (cleaned) textBlocks.push(cleaned);
						}
					}
				}
			} else {
				if (Array.isArray(content)) {
					for (const block of content) {
						if (block.type === 'text' && typeof block.text === 'string') {
							textBlocks.push(block.text);
						} else if (block.type === 'tool_use') {
							toolCalls.push({
								name: block.name as string,
								input: block.input ?? {},
							});
						}
					}
				}
			}

			if (textBlocks.length === 0 && toolCalls.length === 0) continue;

			// Set title from first user text
			if (type === 'user' && textBlocks.length > 0 && title === sessionId) {
				title = extractSessionTitle(textBlocks[0]!, sessionId);
			}

			// Coalesce consecutive same-role messages
			const last = messages[messages.length - 1];
			if (last && last.role === type) {
				last.textBlocks.push(...textBlocks);
				last.toolCalls.push(...toolCalls);
			} else {
				messages.push({role: type as 'user' | 'assistant', textBlocks, toolCalls, timestamp});
			}
		}
	} finally {
		rl.close();
	}

	return {id: sessionId, title, projectName, messages};
}

export function getSessionsDir(): string {
	return join(homedir(), '.claude', 'projects');
}
