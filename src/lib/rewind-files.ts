import {execFile} from "node:child_process";
import {z} from "zod";

import {getActiveSessionEntry} from "./active-session-store";
import {getDb} from "./db";
import {getSessionDirectory} from "./db/queries";
import {getPendingQuestion} from "./pending-question-store";
import {rejectCrossSite} from "./same-origin-guard";

/**
 * Code restore through the CLI's hidden, non-interactive
 * `claude --resume <session> --rewind-files <user message>` (CLI 2.1.310):
 * it writes the session's file checkpoint for that message back to disk
 * (deleting files created after it) and exits. It must run from the session's
 * cwd: elsewhere every tracked path is skipped. A non-interactive run only
 * reads checkpoints with CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING set, and a
 * session only has checkpoints when file checkpointing was on while it ran.
 */

export interface RewindFilesCommand {
	command: "claude";
	args: string[];
	cwd: string;
	env: Record<string, string>;
}

export function buildRewindFilesCommand({
	sessionId,
	message,
	cwd,
}: {
	sessionId: string;
	message: string;
	cwd: string;
}): RewindFilesCommand {
	return {
		command: "claude",
		args: ["--resume", sessionId, "--rewind-files", message],
		cwd,
		env: {CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: "1"},
	};
}

export interface RewindFilesRun {
	code: number | null;
	stdout: string;
	stderr: string;
}

export type RewindFilesOutcome =
	| {kind: "restored"; skipped: number}
	| {kind: "not-enabled"}
	| {kind: "no-checkpoint"}
	| {kind: "failed"; message: string};

const REWOUND = "Files rewound to state at message ";
const SKIPPED = /(\d+) tracked paths? (?:was|were) skipped/;
const ERROR_LINE = /^Error: (.*\S)\s*$/m;

export function parseRewindFilesResult({code, stdout, stderr}: RewindFilesRun): RewindFilesOutcome {
	if (code === 0 && stdout.includes(REWOUND)) {
		return {kind: "restored", skipped: Number(SKIPPED.exec(stderr)?.[1] ?? 0)};
	}
	const error = ERROR_LINE.exec(stderr)?.[1];
	if (error === "File rewinding is not enabled.") return {kind: "not-enabled"};
	if (error === "No file checkpoint found for this message.") return {kind: "no-checkpoint"};
	return {kind: "failed", message: error ?? "claude exited without restoring the files"};
}

export interface RewindFilesDependencies {
	rejectRequest: (request: Request) => Response | null;
	/** The session's working directory, or null when the session is unknown. */
	findCwd: (sessionId: string) => string | null;
	/** False while a live pane is working or waiting on a question or permission. */
	ready: (sessionId: string) => boolean;
	run: (command: RewindFilesCommand) => Promise<RewindFilesRun>;
}

/** Long enough for a resume to load a big transcript on a loaded machine. */
const RUN_TIMEOUT_MS = 120_000;

async function runCommand({command, args, cwd, env}: RewindFilesCommand): Promise<RewindFilesRun> {
	return new Promise((resolve) => {
		const child = execFile(
			command,
			args,
			{cwd, env: {...process.env, ...env}, timeout: RUN_TIMEOUT_MS, maxBuffer: 1024 * 1024},
			(error, stdout, stderr) => {
				const code = error === null ? 0 : typeof error.code === "number" ? error.code : null;
				resolve({code, stdout, stderr});
			},
		);
		child.stdin?.end();
	});
}

export const defaultRewindFilesDependencies: RewindFilesDependencies = {
	rejectRequest: rejectCrossSite,
	findCwd: (sessionId) => getSessionDirectory(getDb().index, sessionId),
	ready: (sessionId) => {
		const entry = getActiveSessionEntry(sessionId);
		if (entry === null) return true;
		return (
			entry.state === "idle" &&
			entry.pendingPermissionRequest === undefined &&
			getPendingQuestion(sessionId) === null
		);
	},
	run: runCommand,
};

const RewindFilesBodySchema = z.strictObject({message: z.uuid()});

const RESTORE_FAILED = "Couldn’t restore the code from this point. Try again.";
const IN_FLIGHT = "Restoring the code is taking longer than expected. Your files may still change.";

const restoring = new Set<string>();

/** A `--rewind-files` run for the session hasn't finished yet. */
export function isRestoringFiles(sessionId: string): boolean {
	return restoring.has(sessionId);
}

/**
 * POST `{message}`: restore the session's files to how they were when that
 * user message was sent. 409 while the pane is working or a restore for the
 * session is still running; 422 with a `reason` when the CLI can't restore.
 */
export async function handleRewindFiles(
	sessionId: string,
	request: Request,
	dependencies: RewindFilesDependencies = defaultRewindFilesDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		body = null;
	}
	const parsed = RewindFilesBodySchema.safeParse(body);
	if (!parsed.success) return Response.json({error: "A user message UUID is required"}, {status: 400});
	const cwd = dependencies.findCwd(sessionId);
	if (cwd === null) return Response.json({error: "Session not found"}, {status: 404});
	if (!dependencies.ready(sessionId)) {
		return Response.json({error: "Rewind is unavailable while Claude is working"}, {status: 409});
	}
	if (restoring.has(sessionId)) return Response.json({error: IN_FLIGHT, inFlight: true}, {status: 409});

	restoring.add(sessionId);
	try {
		const outcome = parseRewindFilesResult(
			await dependencies.run(buildRewindFilesCommand({sessionId, message: parsed.data.message, cwd})),
		);
		if (outcome.kind === "restored") return Response.json({restored: true, skipped: outcome.skipped});
		return Response.json(
			{error: RESTORE_FAILED, reason: outcome.kind === "failed" ? "failed" : outcome.kind},
			{status: 422},
		);
	} finally {
		restoring.delete(sessionId);
	}
}
