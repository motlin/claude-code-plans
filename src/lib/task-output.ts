import {open, realpath} from "node:fs/promises";
import {isAbsolute, resolve} from "node:path";

/** How much of a task's output the pane shows: its last 64 KB. */
const TASK_OUTPUT_TAIL_BYTES = 64 * 1024;

export interface TaskOutputOptions {
	/** Real (symlink-free) temp directories the CLI writes `claude-<uid>/` under. */
	roots: readonly string[];
	uid: number;
	/** The session's project directory name, e.g. `-Users-me-projects-app`. */
	projectId: string;
	maxBytes?: number;
}

export type TaskOutputResult =
	| {status: "ok"; output: string; truncated: boolean}
	| {status: "missing"}
	| {status: "refused"};

const PROJECT_SEGMENT = /^-[A-Za-z0-9._-]*$/;
const SESSION_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const OUTPUT_NAME = /^[A-Za-z0-9_-]+\.output$/;

/**
 * Whether `file` is `<root>/claude-<uid>/<projectId>/<cli session>/tasks/<id>.output`,
 * spelled with no `.`/`..` segments, for one of the given roots.
 */
function matchesTaskOutputPattern(file: string, options: TaskOutputOptions): boolean {
	if (!isAbsolute(file) || resolve(file) !== file) return false;
	if (!PROJECT_SEGMENT.test(options.projectId)) return false;
	return options.roots.some((root) => {
		const prefix = `${root}/claude-${options.uid}/${options.projectId}/`;
		if (!file.startsWith(prefix)) return false;
		const [session, tasks, name, ...rest] = file.slice(prefix.length).split("/");
		return (
			rest.length === 0 &&
			session !== undefined &&
			SESSION_SEGMENT.test(session) &&
			tasks === "tasks" &&
			name !== undefined &&
			OUTPUT_NAME.test(name)
		);
	});
}

function errorCode(error: unknown): string | undefined {
	return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

/**
 * The tail of a background task's CLI output file, read only when the path is
 * the CLI's task-output file for this session's project and nothing on the way
 * to it is a symlink. A truncated tail starts at its first whole line.
 */
export async function readTaskOutput(file: string, options: TaskOutputOptions): Promise<TaskOutputResult> {
	if (!matchesTaskOutputPattern(file, options)) return {status: "refused"};
	let real: string;
	try {
		real = await realpath(file);
	} catch (error) {
		if (errorCode(error) === "ENOENT") return {status: "missing"};
		throw error;
	}
	if (real !== file) return {status: "refused"};

	const maxBytes = options.maxBytes ?? TASK_OUTPUT_TAIL_BYTES;
	let handle;
	try {
		handle = await open(real, "r");
	} catch (error) {
		if (errorCode(error) === "ENOENT") return {status: "missing"};
		throw error;
	}
	try {
		const {size} = await handle.stat();
		const length = Math.min(size, maxBytes);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, size - length);
		const truncated = size > maxBytes;
		const text = buffer.toString("utf8");
		if (!truncated) return {status: "ok", output: text, truncated};
		const newline = text.indexOf("\n");
		return {status: "ok", output: newline === -1 ? text : text.slice(newline + 1), truncated};
	} finally {
		await handle.close();
	}
}

/** The real temp directories the CLI may write task output under (`/tmp` and the OS temp dir). */
export async function defaultTaskOutputRoots(): Promise<string[]> {
	const {tmpdir} = await import("node:os");
	const roots = await Promise.all(["/tmp", tmpdir()].map(async (dir) => realpath(dir).catch(() => null)));
	return [...new Set(roots.filter((root) => root !== null))];
}
