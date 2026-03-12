import {execFile} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {join} from 'node:path';
import {readdir, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {eq} from 'drizzle-orm';
import type {BetterSQLite3Database} from 'drizzle-orm/better-sqlite3';
import * as schema from './db/schema';

type SummariesDb = BetterSQLite3Database<typeof schema>;

const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
const MAX_CHARS = 150_000;

interface JsonlMessage {
	type: string;
	uuid?: string;
	message?: {
		role?: string;
		content?: string | Array<{type: string; text?: string}>;
	};
}

function extractText(msg: JsonlMessage): string | null {
	const content = msg.message?.content;
	if (!content) return null;
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		const texts: string[] = [];
		for (const block of content) {
			if (block.type === 'text' && typeof block.text === 'string') {
				texts.push(block.text);
			}
		}
		return texts.length > 0 ? texts.join('\n') : null;
	}
	return null;
}

async function readSessionMessages(
	sessionId: string,
): Promise<{messages: Array<{role: string; text: string}>; lastMessageId: string | null} | null> {
	let projectDirs: string[];
	try {
		projectDirs = await readdir(PROJECTS_DIR);
	} catch {
		return null;
	}

	const filename = `${sessionId}.jsonl`;
	let filePath: string | null = null;

	for (const dir of projectDirs) {
		const candidate = join(PROJECTS_DIR, dir, filename);
		try {
			await stat(candidate);
			filePath = candidate;
			break;
		} catch {
			// not here
		}
	}

	if (!filePath) return null;

	const messages: Array<{role: string; text: string}> = [];
	let lastMessageId: string | null = null;

	const rl = createInterface({
		input: createReadStream(filePath, {encoding: 'utf-8'}),
		crlfDelay: Infinity,
	});

	try {
		for await (const line of rl) {
			if (!line.trim()) continue;
			try {
				const obj = JSON.parse(line) as JsonlMessage;
				if (obj.type !== 'user' && obj.type !== 'assistant') continue;
				const text = extractText(obj);
				if (!text) continue;
				messages.push({role: obj.type, text});
				if (obj.uuid) lastMessageId = obj.uuid;
			} catch {
				// skip
			}
		}
	} finally {
		rl.close();
	}

	return {messages, lastMessageId};
}

function serializeForSummary(messages: Array<{role: string; text: string}>): string {
	if (messages.length === 0) return '';

	const totalLen = messages.reduce((sum, m) => sum + m.text.length, 0);

	if (totalLen <= MAX_CHARS) {
		return messages.map((m) => `[${m.role}]\n${m.text}`).join('\n\n');
	}

	// First ~20% + last ~60% of messages
	const firstCount = Math.max(1, Math.floor(messages.length * 0.2));
	const lastCount = Math.max(1, Math.floor(messages.length * 0.6));
	const firstMessages = messages.slice(0, firstCount);
	const lastMessages = messages.slice(-lastCount);

	const parts = [
		...firstMessages.map((m) => `[${m.role}]\n${m.text}`),
		'\n[... middle messages omitted ...]\n',
		...lastMessages.map((m) => `[${m.role}]\n${m.text}`),
	];

	let result = parts.join('\n\n');
	if (result.length > MAX_CHARS) {
		result = result.slice(0, MAX_CHARS) + '\n[truncated]';
	}
	return result;
}

function runClaude(prompt: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			'claude',
			['-p', '--no-session-persistence', '--model', 'haiku'],
			{maxBuffer: 1024 * 1024, timeout: 60_000},
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(`claude CLI failed: ${error.message}\n${stderr}`));
					return;
				}
				resolve(stdout.trim());
			},
		);
		child.stdin?.write(prompt);
		child.stdin?.end();
	});
}

let generating = false;

export async function generateSummary(summariesDb: SummariesDb, sessionId: string): Promise<string | null> {
	if (generating) return null;
	generating = true;

	try {
		const data = await readSessionMessages(sessionId);
		if (!data || data.messages.length === 0) return null;

		const serialized = serializeForSummary(data.messages);
		const prompt = `Summarize this Claude Code conversation in 1-2 sentences. Focus on what was accomplished. Be concise.\n\n${serialized}`;

		const summary = await runClaude(prompt);
		if (!summary) return null;

		summariesDb
			.insert(schema.summaries)
			.values({
				sessionId,
				lastMessageId: data.lastMessageId ?? 'unknown',
				summary,
				generatedAt: Date.now(),
			})
			.onConflictDoUpdate({
				target: schema.summaries.sessionId,
				set: {
					lastMessageId: data.lastMessageId ?? 'unknown',
					summary,
					generatedAt: Date.now(),
				},
			})
			.run();

		return summary;
	} finally {
		generating = false;
	}
}

export function getSummary(summariesDb: SummariesDb, sessionId: string): string | null {
	const row = summariesDb.select().from(schema.summaries).where(eq(schema.summaries.sessionId, sessionId)).get();
	return row?.summary ?? null;
}
