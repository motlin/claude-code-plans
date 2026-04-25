/**
 * Minimal shape needed by summarizeToolCalls, categorize, and diffStatsForEditCall.
 * Satisfied by raw content blocks, readSession tool call objects, and test data alike.
 */
export interface ToolCallLike {
	name: string;
	input: Record<string, unknown>;
}

const COMMAND_MESSAGE_RE = /<command-message[^>]*>([\s\S]*?)<\/command-message>/;
const STRIP_BLOCK_RE =
	/<(?:command-name|command-args|local-command-stdout)[^>]*>[\s\S]*?<\/(?:command-name|command-args|local-command-stdout)>/g;
const STRIP_TAG_RE =
	/<\/?(?:command-message|command-name|command-args|command|local-command-caveat|local-command-stdout)[^>]*>/g;

function cleanCommandText(text: string): string {
	const msgMatch = text.match(COMMAND_MESSAGE_RE);
	if (msgMatch) {
		return msgMatch[1]!.replace(STRIP_TAG_RE, '').trim();
	}
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

const TOOL_CATEGORIES = [
	'edit',
	'grep',
	'read',
	'glob',
	'webfetch',
	'websearch',
	'agent',
	'bash',
	'recall',
	'memwrite',
] as const;
type ToolCategory = (typeof TOOL_CATEGORIES)[number];

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);

function isMemoryPath(filePath: string): boolean {
	if (!filePath.endsWith('.md')) return false;
	if (!filePath.includes('/.claude/')) return false;
	return /\/\.claude\/(?:memory\/|projects\/[^/]+\/memory\/)/.test(filePath);
}

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

function diffStatsForEditCall(call: ToolCallLike): {added: number; removed: number} {
	const input = call.input;
	if (call.name === 'Write') {
		const content = typeof input['content'] === 'string' ? (input['content'] as string) : '';
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
		const oldStr = typeof input['old_string'] === 'string' ? (input['old_string'] as string) : '';
		const newStr = typeof input['new_string'] === 'string' ? (input['new_string'] as string) : '';
		return countDiffLines(oldStr, newStr);
	}
	return {added: 0, removed: 0};
}

function categorize(call: ToolCallLike): ToolCategory | null {
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
	return null;
}

export function formatToolName(toolName: string): string {
	if (toolName.startsWith('mcp__')) {
		const withoutPrefix = toolName.slice('mcp__'.length);
		const serverName = withoutPrefix.split('__')[0]!;
		if (serverName.startsWith('plugin_')) {
			const segments = serverName.split('_');
			return segments[segments.length - 1]!;
		}
		return serverName;
	}
	return toolName;
}

function pluralize(count: number, singular: string, plural: string): string {
	if (count === 1) return singular;
	return plural.replace('{n}', String(count));
}

/**
 * Extract text from a tool_result content field.
 * Content can be a plain string or an array of {type: 'text', text: string} blocks.
 */
export function extractToolResultContent(content: unknown): string | undefined {
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

/**
 * Strip non-rendering wrapper tags from tool result text.
 */
export function stripResultTags(text: string): string {
	let result = text;
	result = result.replace(/<\/?tool_use_error>/g, '');
	result = result.replace(/<\/?persisted-output>/g, '');
	result = result.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '');
	if (result !== text) result = result.trim();
	return result;
}

/**
 * Truncate text to a maximum number of lines, appending a count of omitted lines.
 */
export function truncateResult(text: string, maxLines: number): string {
	const lines = text.split('\n');
	if (lines.length <= maxLines) return text;
	const truncated = lines.slice(0, maxLines);
	truncated.push(`... (${lines.length - maxLines} more lines)`);
	return truncated.join('\n');
}

export function summarizeToolCalls(calls: ToolCallLike[]): string {
	if (calls.length === 0) return '';

	const counts = new Map<ToolCategory, number>();
	const editStats = {added: 0, removed: 0};
	const unknownTools = new Map<string, number>();

	for (const call of calls) {
		const cat = categorize(call);
		if (cat === null) {
			const displayName = formatToolName(call.name);
			unknownTools.set(displayName, (unknownTools.get(displayName) ?? 0) + 1);
		} else {
			counts.set(cat, (counts.get(cat) ?? 0) + 1);
			if (cat === 'edit') {
				const s = diffStatsForEditCall(call);
				editStats.added += s.added;
				editStats.removed += s.removed;
			}
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

	for (const [displayName, count] of unknownTools) {
		if (count === 1) {
			parts.push(`called ${displayName}`);
		} else {
			parts.push(`called ${displayName} ${count} times`);
		}
	}

	return parts.join(', ');
}
