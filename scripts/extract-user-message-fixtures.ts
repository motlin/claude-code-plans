#!/usr/bin/env npx tsx
/**
 * Scan real JSONL files in ~/.claude/projects and extract one user record per
 * shape (A-F) defined in .llm/plans/2026-05-07-user-message-categories.md.
 *
 * Output: tests/fixtures/user-message-shapes.json
 *
 * Shapes:
 *   A — plain string content, no flags. Just userType:'external' + plain text.
 *   B — content text matches /^\[Request interrupted by user.*\]$/.
 *   C — isCompactSummary=true and isVisibleInTranscriptOnly=true; content
 *       begins with 'This session is being continued from a previous
 *       conversation that ran out of context.'
 *   D — isMeta=true, content begins with 'Stop hook feedback:'.
 *   E — isMeta=true, content is the expanded body of a slash command .md file.
 *   F — content has a block of type 'document' with source.type 'base64'.
 */

import {readdirSync, readFileSync, statSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const projectsDir = join(homedir(), '.claude', 'projects');
const outPath = join(here, '..', 'tests', 'fixtures', 'user-message-shapes.json');

type Shape = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
const shapes: Shape[] = ['A', 'B', 'C', 'D', 'E', 'F'];

function findJsonlFiles(dir: string): string[] {
	const results: string[] = [];
	let entries;
	try {
		entries = readdirSync(dir, {withFileTypes: true});
	} catch {
		return results;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findJsonlFiles(full));
		} else if (entry.name.endsWith('.jsonl')) {
			results.push(full);
		}
	}
	return results;
}

function extractText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (block && typeof block === 'object' && 'type' in block) {
				const b = block as {type: string; text?: string};
				if (b.type === 'text' && typeof b.text === 'string') {
					parts.push(b.text);
				}
			}
		}
		return parts.join('');
	}
	return '';
}

function hasDocumentBlock(content: unknown): boolean {
	if (!Array.isArray(content)) return false;
	for (const block of content) {
		if (block && typeof block === 'object' && 'type' in block) {
			const b = block as {type: string; source?: {type?: string}};
			if (b.type === 'document') return true;
		}
	}
	return false;
}

function classify(record: Record<string, unknown>): Shape | null {
	if (record['type'] !== 'user') return null;
	const message = record['message'];
	if (!message || typeof message !== 'object') return null;
	const content = (message as {content?: unknown}).content;
	const text = extractText(content);

	if (hasDocumentBlock(content)) return 'F';

	if (record['isCompactSummary'] === true || record['isVisibleInTranscriptOnly'] === true) {
		if (text.startsWith('This session is being continued from a previous conversation')) {
			return 'C';
		}
	}

	if (/^\[Request interrupted by user.*\]$/m.test(text.trim())) return 'B';

	if (record['isMeta'] === true) {
		if (text.startsWith('Stop hook feedback:')) return 'D';
		if (typeof content !== 'undefined') return 'E';
	}

	if (typeof content === 'string' && text.length > 0 && record['isMeta'] !== true) {
		return 'A';
	}
	return null;
}

function redactDocumentData(record: Record<string, unknown>): Record<string, unknown> {
	const message = record['message'] as {content?: unknown} | undefined;
	if (!message) return record;
	const content = message.content;
	if (!Array.isArray(content)) return record;
	const redacted = content.map((block) => {
		if (block && typeof block === 'object' && 'type' in block) {
			const b = block as {type: string; source?: {type?: string; data?: string; media_type?: string}};
			if (b.type === 'document' && b.source && typeof b.source.data === 'string') {
				return {
					...b,
					source: {
						...b.source,
						data: `<redacted ${b.source.data.length} base64 chars>`,
					},
				};
			}
		}
		return block;
	});
	return {
		...record,
		message: {
			...message,
			content: redacted,
		},
	};
}

const found: Record<Shape, Record<string, unknown> | null> = {
	A: null,
	B: null,
	C: null,
	D: null,
	E: null,
	F: null,
};

const files = findJsonlFiles(projectsDir);
const sorted = files
	.map((p) => ({path: p, mtime: statSync(p).mtimeMs}))
	.sort((a, b) => b.mtime - a.mtime)
	.map((f) => f.path);

console.log(`Scanning ${sorted.length} JSONL files (newest first)...`);

let scanned = 0;
outer: for (const file of sorted) {
	scanned += 1;
	let raw: string;
	try {
		raw = readFileSync(file, 'utf-8');
	} catch {
		continue;
	}
	for (const line of raw.split('\n')) {
		if (!line.trim()) continue;
		let record: Record<string, unknown>;
		try {
			record = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		const shape = classify(record);
		if (shape && !found[shape]) {
			found[shape] = shape === 'F' ? redactDocumentData(record) : record;
			console.log(`  Found shape ${shape} in ${file}`);
			if (shapes.every((s) => found[s])) break outer;
		}
	}
}

console.log(`Scanned ${scanned} files.`);
const missing = shapes.filter((s) => !found[s]);
if (missing.length > 0) {
	console.error(`Missing shapes: ${missing.join(', ')}`);
	process.exit(1);
}

mkdirSync(dirname(outPath), {recursive: true});
writeFileSync(outPath, JSON.stringify(found, null, 2) + '\n', 'utf-8');
console.log(`Wrote ${outPath}`);
