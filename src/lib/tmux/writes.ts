import {execFile} from "node:child_process";
import {terminalWritesEnabled} from "../config";
import type {HerdrResult} from "../herdr/client";
import type {HerdrRequester} from "../herdr/panes";
import {BRACKETED_PASTE_END, BRACKETED_PASTE_START, type HerdrPromptTarget} from "../herdr/prompt";
import type {ActiveSessionEntry} from "../active-session-store";
import {asRecord, errorMessage} from "../narrow";
import type {ActivityState} from "../session-state";
import {
	getTmuxSessionPanes,
	lookupTmuxSessionPanes,
	type TmuxListedPane,
	type TmuxSessionPane,
	type TmuxSessionPaneSources,
} from "./session-panes";

/** Runs `tmux <args>`; resolves once tmux exits cleanly. */
export type TmuxCommandRunner = (args: readonly string[]) => Promise<void>;

export interface TmuxWriteIo {
	run: TmuxCommandRunner;
	/** Waits between keystrokes so the TUI reads each as its own press. */
	pause: () => Promise<void>;
	/** The Live terminal input setting. */
	writesEnabled: () => boolean;
	/** A tmux paste buffer name no other write shares. */
	createBufferName: () => string;
}

/**
 * Which operation is typing. tmux types into anything, so each one may only
 * type in the hook-reported states where the CLI is showing what it expects.
 */
export type TmuxWriteKind =
	| "prompt"
	| "mid-turn-prompt"
	| "interrupt"
	| "question"
	| "permission"
	| "plan"
	| "live-option"
	| "rewind";

/**
 * Prompts and live option changes go into an idle composer; a mid-turn prompt
 * (sent right after a skipped question) goes into a working one with no
 * permission dialog open; an interrupt needs a turn to stop; a question dialog
 * shows while waiting. A permission dialog opens after PreToolUse already said
 * working, so it takes either, as does the plan approval dialog. A rewind
 * opens the CLI's message selector, which only an idle session shows.
 */
const READY_STATES = {
	prompt: ["idle"],
	"mid-turn-prompt": ["working"],
	interrupt: ["working", "waiting"],
	question: ["waiting"],
	permission: ["working", "waiting"],
	plan: ["working", "waiting"],
	"live-option": ["idle"],
	rewind: ["idle"],
} as const satisfies Record<TmuxWriteKind, readonly ActivityState[]>;

const NAMED_KEYS: Readonly<Record<string, string>> = {
	esc: "Escape",
	enter: "Enter",
	tab: "Tab",
	"shift+tab": "BTab",
	up: "Up",
	down: "Down",
	left: "Left",
	right: "Right",
	backspace: "BSpace",
	space: "Space",
	"ctrl+c": "C-c",
};

/** The tmux `send-keys` name for a herdr-style key ccp sends, or null when it has none. */
export function tmuxKeyName(key: string): string | null {
	if (/^[0-9]$/.test(key)) return key;
	return NAMED_KEYS[key] ?? null;
}

function failure(code: string, message: string): HerdrResult<never> {
	return {ok: false, code, message};
}

function sessionPane(sessionId: string, panes: readonly TmuxSessionPane[]): HerdrResult<TmuxListedPane> {
	const match = panes.find((pane) => pane.sessionId === sessionId);
	return match === undefined
		? failure("session-not-found", "session is not attached to a live tmux pane")
		: {ok: true, value: match.pane};
}

/** The session's pane right now, from a fresh `list-panes`. */
async function currentPane(sessionId: string, sources: TmuxSessionPaneSources): Promise<HerdrResult<TmuxListedPane>> {
	return sessionPane(sessionId, await getTmuxSessionPanes(sources));
}

function readyCheck(
	kind: TmuxWriteKind,
	entry: Pick<ActiveSessionEntry, "state" | "pendingPermissionRequest"> | undefined,
): HerdrResult<null> {
	const state = entry?.state;
	if (state === undefined) {
		return failure(
			"agent_not_ready",
			"No hook has reported this session's state; tmux input refuses to type blind",
		);
	}
	const ready: readonly ActivityState[] = READY_STATES[kind];
	if (kind === "mid-turn-prompt" && entry?.pendingPermissionRequest !== undefined) {
		return failure("agent_not_ready", "A permission dialog is open; tmux input will not type into it");
	}
	if (ready.includes(state)) return {ok: true, value: null};
	return failure("agent_not_ready", `The session is ${state}; tmux input needs it ${ready.join(" or ")}`);
}

function stringParam(params: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = params?.[key];
	return typeof value === "string" ? value : undefined;
}

/** One tmux command; Enter after typed text waits first, so the TUI does not read it as part of a paste. */
interface TmuxStep {
	args: string[];
	pauseBefore: boolean;
}

function steps(...commands: string[][]): TmuxStep[] {
	return commands.map((args) => ({args, pauseBefore: false}));
}

/**
 * The text inside herdr-style bracketed-paste markers, or null when it is not
 * wrapped. tmux may not pass those bytes through as a paste, so wrapped text
 * goes through a paste buffer, whose `-p` brackets it only when the pane asked.
 */
function bracketedPasteBody(text: string): string | null {
	if (!text.startsWith(BRACKETED_PASTE_START) || !text.endsWith(BRACKETED_PASTE_END)) return null;
	return text.slice(BRACKETED_PASTE_START.length, text.length - BRACKETED_PASTE_END.length);
}

function pasteSteps(text: string, pane: string[], buffer: string): TmuxStep[] {
	return steps(["set-buffer", "-b", buffer, "--", text], ["paste-buffer", "-p", "-d", "-b", buffer, ...pane]);
}

/** The tmux commands for one herdr-style write call, or a failure for keys or methods tmux cannot send. */
function tmuxSteps(
	method: unknown,
	params: Record<string, unknown> | undefined,
	pane: string[],
	createBufferName: () => string,
): HerdrResult<TmuxStep[]> {
	switch (method) {
		case "agent.send_keys": {
			const keys = params?.["keys"];
			if (!Array.isArray(keys) || keys.length === 0) return failure("invalid_key", "keys are required");
			const names = keys.map((key) => (typeof key === "string" ? tmuxKeyName(key) : null));
			if (names.some((name) => name === null)) return failure("invalid_key", "tmux has no name for that key");
			return {ok: true, value: steps(["send-keys", ...pane, ...names.filter((name) => name !== null)])};
		}
		case "pane.send_text": {
			const text = stringParam(params, "text") ?? "";
			const pasted = bracketedPasteBody(text);
			return {
				ok: true,
				value:
					pasted === null
						? steps(["send-keys", ...pane, "-l", "--", text])
						: pasteSteps(pasted, pane, createBufferName()),
			};
		}
		case "agent.prompt": {
			const text = stringParam(params, "text") ?? "";
			if (text.trim() === "") return failure("empty_agent_prompt", "The prompt is empty");
			const enter = {args: ["send-keys", ...pane, "Enter"], pauseBefore: true};
			const typed = text.includes("\n")
				? pasteSteps(text, pane, createBufferName())
				: steps(["send-keys", ...pane, "-l", "--", text]);
			return {ok: true, value: [...typed, enter]};
		}
		default:
			return failure("unsupported", "tmux cannot run that terminal request");
	}
}

/**
 * The write half of a herdr handler's dependencies, typing through tmux. The
 * handler resolves its session once; every typed call then re-resolves the
 * session's pane, refuses when it moved on, and re-checks the hook state, so a
 * multi-key answer stops the moment the pane stops being the one it started on.
 */
export function tmuxWriteDependencies(
	kind: TmuxWriteKind,
	sources: TmuxSessionPaneSources,
	io: TmuxWriteIo,
): {
	resolveTarget: (sessionId: string) => Promise<HerdrResult<HerdrPromptTarget>>;
	request: HerdrRequester;
	createRequestId: () => string;
} {
	let resolved: {sessionId: string; pane: TmuxListedPane} | null = null;
	return {
		resolveTarget: async (sessionId) => {
			const pane = sessionPane(sessionId, await lookupTmuxSessionPanes(sources));
			if (!pane.ok) return pane;
			resolved = {sessionId, pane: pane.value};
			return {
				ok: true,
				value: {terminalId: `tmux:${pane.value.socketPath}:${pane.value.paneId}`, paneId: pane.value.paneId},
			};
		},
		request: async (request) => {
			if (resolved === null) return failure("session-not-found", "No tmux pane was resolved for this write");
			const fields = asRecord(request);
			const params = asRecord(fields?.["params"]);
			const target = stringParam(params, "target") ?? stringParam(params, "pane_id");
			if (target !== resolved.pane.paneId) return failure("pane-moved", "The write names a different tmux pane");

			const now = await currentPane(resolved.sessionId, sources);
			if (!now.ok) return now;
			if (now.value.paneId !== target || now.value.socketPath !== resolved.pane.socketPath) {
				return failure("pane-moved", `The session's tmux pane moved on from ${target}`);
			}
			const ready = readyCheck(
				kind,
				sources.entries().find((entry) => entry.sessionId === resolved?.sessionId),
			);
			if (!ready.ok) return ready;

			const socket = now.value.socketPath === "" ? [] : ["-S", now.value.socketPath];
			const planned = tmuxSteps(fields?.["method"], params, ["-t", target], io.createBufferName);
			if (!planned.ok) return planned;
			try {
				for (const step of planned.value) {
					if (step.pauseBefore) await io.pause();
					await io.run([...socket, ...step.args]);
				}
			} catch (error) {
				return failure("tmux-failed", errorMessage(error));
			}
			return {ok: true, value: null};
		},
		createRequestId: () => `ccp:tmux:${kind}`,
	};
}

const TMUX_WRITE_TIMEOUT_MS = 2000;

/** Runs `tmux <args>` and resolves with its stdout. */
export type TmuxCapture = (args: readonly string[]) => Promise<string>;

const defaultTmuxCapture: TmuxCapture = async (args) =>
	new Promise((resolve, reject) => {
		execFile("tmux", [...args], {timeout: TMUX_WRITE_TIMEOUT_MS}, (error: Error | null, stdout: string) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});

/** The session's tmux pane's visible screen, refused when the pane moved on from `paneId`. */
export async function readTmuxScreen(
	sessionId: string,
	paneId: string,
	sources: TmuxSessionPaneSources,
	capture: TmuxCapture = defaultTmuxCapture,
	{ansi = false}: {ansi?: boolean} = {},
): Promise<HerdrResult<string>> {
	const now = await currentPane(sessionId, sources);
	if (!now.ok) return now;
	if (now.value.paneId !== paneId) return failure("pane-moved", `The session's tmux pane moved on from ${paneId}`);
	const socket = now.value.socketPath === "" ? [] : ["-S", now.value.socketPath];
	try {
		const escapes = ansi ? ["-e"] : [];
		return {ok: true, value: await capture([...socket, "capture-pane", "-p", ...escapes, "-t", paneId])};
	} catch (error) {
		return failure("tmux-failed", errorMessage(error));
	}
}
const KEY_PAUSE_MS = 80;

export const defaultTmuxWriteIo: TmuxWriteIo = {
	run: async (args) =>
		new Promise((resolve, reject) => {
			execFile("tmux", [...args], {timeout: TMUX_WRITE_TIMEOUT_MS}, (error: Error | null) => {
				if (error) reject(error);
				else resolve();
			});
		}),
	pause: async () =>
		new Promise((resolve) => {
			setTimeout(resolve, KEY_PAUSE_MS);
		}),
	writesEnabled: terminalWritesEnabled,
	createBufferName: () => `ccp-${crypto.randomUUID()}`,
};
