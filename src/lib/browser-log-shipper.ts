type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'onerror' | 'unhandledrejection';

interface LogEntry {
	level: LogLevel;
	messages: unknown[];
	stack?: string | undefined;
	url?: string | undefined;
	line?: number | undefined;
	col?: number | undefined;
}

const BATCH_INTERVAL = 500;
let batch: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function safeStringify(value: unknown): string {
	const seen = new WeakSet();
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === 'object' && val !== null) {
			if (seen.has(val)) return '[Circular]';
			seen.add(val);
		}
		if (val instanceof Error) return {message: val.message, stack: val.stack, name: val.name};
		if (typeof val === 'function') return `[Function: ${val.name || 'anonymous'}]`;
		if (typeof val === 'symbol') return val.toString();
		return val;
	});
}

function flush() {
	if (batch.length === 0) return;
	const entries = batch;
	batch = [];
	timer = null;

	fetch('/api/client-errors', {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: safeStringify(entries),
	}).catch(() => {});
}

function enqueue(entry: LogEntry) {
	batch.push(entry);
	if (!timer) timer = setTimeout(flush, BATCH_INTERVAL);
}

function patchConsole(level: 'log' | 'info' | 'warn' | 'error') {
	const original = console[level];
	console[level] = (...args: unknown[]) => {
		original.apply(console, args);
		enqueue({level, messages: args});
	};
}

export function installBrowserLogShipper() {
	if (typeof window === 'undefined') return;

	patchConsole('log');
	patchConsole('info');
	patchConsole('warn');
	patchConsole('error');

	window.onerror = (message, url, line, col, error) => {
		const entry: LogEntry = {
			level: 'onerror',
			messages: [String(message)],
		};
		if (error?.stack) entry.stack = error.stack;
		if (url) entry.url = url;
		if (line != null) entry.line = line;
		if (col != null) entry.col = col;
		enqueue(entry);
	};

	window.addEventListener('unhandledrejection', (event) => {
		const reason = event.reason;
		const entry: LogEntry = {
			level: 'unhandledrejection',
			messages: [reason instanceof Error ? reason.message : String(reason)],
		};
		if (reason instanceof Error && reason.stack) entry.stack = reason.stack;
		enqueue(entry);
	});
}
