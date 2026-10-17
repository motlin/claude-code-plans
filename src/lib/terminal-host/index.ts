import type {ActiveSessionEntry} from "../active-session-store";
import {terminalHostSetting} from "../config";
import type {HookEvent} from "../hook-events";
import type {TerminalPlacementProvider} from "../terminal-placements";
import type {TerminalHostSetting} from "../terminal-host-setting";
import {createTmuxPlacementProvider} from "../tmux-windows";
import {toTmuxPaneLink} from "../tmux/pane-links";
import {
	defaultTmuxSessionPaneSources,
	lookupTmuxSessionPanes,
	type TmuxSessionPaneSources,
} from "../tmux/session-panes";
import {TERMINAL_HOST_CAPABILITIES} from "../terminal-host-capabilities";
import {defaultTmuxLaunchIo, launchClaudeInTmux, type TmuxLaunchIo} from "../tmux/launch";
import {defaultTmuxWriteIo, readTmuxScreen, tmuxWriteDependencies, type TmuxWriteIo} from "../tmux/writes";
import {startTmuxPaneEvents} from "../tmux/pane-events";
import {
	defaultTmuxTerminalStreamIo,
	startTmuxTerminalStream,
	stopAllTmuxTerminalStreams,
	type TmuxTerminalStreamIo,
} from "../tmux/terminal-stream";
import {defaultHerdrInterruptDependencies, handleHerdrInterrupt} from "../herdr/interrupt";
import {defaultHerdrLaunchDependencies, handleHerdrLaunch} from "../herdr/launch";
import {defaultHerdrLiveOptionDependencies, handleHerdrLiveOption} from "../herdr/live-option";
import {createHerdrPlacementProvider, getHerdrPanes, type HerdrPaneLink} from "../herdr/panes";
import {defaultHerdrPermissionDependencies, handleHerdrPermission} from "../herdr/permission";
import {defaultHerdrPlanDependencies, handleHerdrPlan, handleHerdrPlanDialog} from "../herdr/plan";
import {defaultHerdrPromptDependencies, handleHerdrPrompt, midTurnPromptReady} from "../herdr/prompt";
import {getPendingQuestion} from "../pending-question-store";
import {defaultHerdrQuestionDependencies, handleHerdrQuestion} from "../herdr/question";
import {reportHookStateToHerdr} from "../herdr/report-state";
import {startHerdrEventBridge} from "../herdr/subscribe";
import {controlHerdrSession, type TerminalController} from "../herdr/terminal-controller";
import {
	observeHerdrSession,
	stopAllTerminalObservers,
	parseViewport,
	type TerminalObserver,
	type TerminalObserverSocket,
} from "../herdr/terminal-observer";
import {getHerdrWorkspaces, type HerdrWorkspace} from "../herdr/workspaces";
import {defaultTerminalHostProbes, selectTerminalHost, type TerminalHostProbes} from "./selection";

export type {TerminalController, TerminalObserver, TerminalObserverSocket};
export {addViewedStateToHerdrPanes as addViewedStateToPanes} from "../herdr/pane-viewed-state";
/** Upgrade gate for a control stream, whatever the host: same-origin and Live terminal input on. */
export {authorizeTerminalControl} from "../herdr/terminal-controller";

/**
 * Everything ccp asks of a terminal multiplexer, so herdr and tmux can sit
 * behind one seam. Callers outside `src/lib/herdr/` go through a host from
 * `getTerminalHost()` rather than importing herdr modules.
 *
 * Write operations take the API request whole: each one checks same-origin,
 * the Live terminal input setting, and re-resolves the session's pane before
 * typing (send keys, send text, prompt, with the agent ready check), then
 * answers with the JSON the browser already expects.
 */
export interface TerminalHost {
	/** `none` when no host is available. */
	readonly id: "herdr" | "tmux" | "none";
	/** Whether this host can type into panes at all; Live terminal input still gates it. */
	readonly canWrite: boolean;
	/** Whether this host can stream a pane into the live terminal tab. */
	readonly canStream: boolean;
	/** List panes: live panes linked to Claude sessions. */
	listPanes: () => Promise<HerdrPaneLink[]>;
	/** Every pane by workspace, including panes no Claude session owns. */
	listWorkspaces: () => Promise<HerdrWorkspace[]>;
	/** Session to pane: placements of sessions in this host's panes, or null for none. */
	placementProvider: () => TerminalPlacementProvider | null;
	/** Prompt the session's agent (refused while it is not ready). */
	prompt: (request: Request) => Promise<Response>;
	/** Send keys: Esc, or ctrl+c when forced. */
	interrupt: (request: Request) => Promise<Response>;
	/** Send keys and text that answer a pending question. */
	answerQuestion: (request: Request) => Promise<Response>;
	/** Send the keys that answer a permission prompt. */
	answerPermission: (request: Request) => Promise<Response>;
	/** Read the session's open plan approval dialog: what it offers to accept into. */
	readPlanDialog: (request: Request) => Promise<Response>;
	/** Send the keys and feedback text that answer a plan approval dialog. */
	answerPlan: (request: Request) => Promise<Response>;
	/** Send the keys that change model, effort or mode in the live session. */
	applyLiveOption: (request: Request) => Promise<Response>;
	/** Launch: open a new pane running `claude`. */
	launch: (request: Request) => Promise<Response>;
	/** State reporting: mirror a hook event onto the session's pane. Never rejects. */
	reportHookState: (event: HookEvent, entry: ActiveSessionEntry | null) => void;
	/** Pane events: start the live pane-event bridge; returns its stop. */
	startPaneEvents: () => () => void;
	/** Live terminal: stream the session's pane read-only. */
	observe: (
		sessionId: string,
		columns: number,
		rows: number,
		socket: TerminalObserverSocket,
	) => Promise<TerminalObserver>;
	/** Live terminal: stream the session's pane and accept keyboard frames. */
	control: (
		sessionId: string,
		columns: number,
		rows: number,
		socket: TerminalObserverSocket,
	) => Promise<TerminalController>;
	/** Stop every live terminal stream this host has open. */
	stopAllStreams: () => void;
}

const herdrTerminalHost: TerminalHost = {
	id: "herdr",
	...TERMINAL_HOST_CAPABILITIES.herdr,
	listPanes: async () => getHerdrPanes(),
	listWorkspaces: async () => getHerdrWorkspaces(),
	placementProvider: () => createHerdrPlacementProvider(),
	prompt: async (request) => handleHerdrPrompt(request),
	interrupt: async (request) => handleHerdrInterrupt(request),
	answerQuestion: async (request) => handleHerdrQuestion(request),
	answerPermission: async (request) => handleHerdrPermission(request),
	readPlanDialog: async (request) => handleHerdrPlanDialog(request),
	answerPlan: async (request) => handleHerdrPlan(request),
	applyLiveOption: async (request) => handleHerdrLiveOption(request),
	launch: async (request) => handleHerdrLaunch(request),
	reportHookState: (event, entry) => {
		reportHookStateToHerdr(event, entry);
	},
	startPaneEvents: startHerdrEventBridge,
	observe: async (sessionId, columns, rows, socket) => observeHerdrSession(sessionId, columns, rows, socket),
	control: async (sessionId, columns, rows, socket) => controlHerdrSession(sessionId, columns, rows, socket),
	stopAllStreams: stopAllTerminalObservers,
};

const NO_HOST_MESSAGE = "No terminal host is available for live input";

async function noHostWrite(): Promise<Response> {
	return Promise.resolve(Response.json({error: NO_HOST_MESSAGE, code: "no-terminal-host"}, {status: 503}));
}

async function noHostStream(): Promise<never> {
	return Promise.reject(new Error("No terminal host can stream this session"));
}

/** No host: no panes, and every write is refused. */
const noTerminalHost: TerminalHost = {
	id: "none",
	canWrite: false,
	canStream: false,
	listPanes: async () => Promise.resolve([]),
	listWorkspaces: async () => Promise.resolve([]),
	placementProvider: () => null,
	prompt: noHostWrite,
	interrupt: noHostWrite,
	answerQuestion: noHostWrite,
	answerPermission: noHostWrite,
	readPlanDialog: noHostWrite,
	answerPlan: noHostWrite,
	applyLiveOption: noHostWrite,
	launch: noHostWrite,
	reportHookState: () => undefined,
	startPaneEvents: () => () => undefined,
	observe: noHostStream,
	control: noHostStream,
	stopAllStreams: () => undefined,
};

/**
 * tmux: panes and session-to-pane mapping (hook `TMUX_PANE`, else the session
 * pid's process tree), and writes through `tmux send-keys` behind herdr's
 * handlers, gated by the hook-reported state (see `tmux/writes.ts`), and
 * launches into new detached windows (see `tmux/launch.ts`), and pane events
 * from a 2 s `list-panes` poll (see `tmux/pane-events.ts`), and live
 * terminals from a control-mode client per watched pane (see
 * `tmux/terminal-stream.ts`).
 */
export function createTmuxTerminalHost(
	sources: TmuxSessionPaneSources = defaultTmuxSessionPaneSources,
	io: TmuxWriteIo = defaultTmuxWriteIo,
	launchIo: TmuxLaunchIo = defaultTmuxLaunchIo,
	streamIo: TmuxTerminalStreamIo = defaultTmuxTerminalStreamIo,
): TerminalHost {
	const writes = {writesEnabled: io.writesEnabled};
	const planDependencies = () => ({
		...defaultHerdrPlanDependencies,
		...writes,
		pause: io.pause,
		hasPendingPlan: (sessionId: string) =>
			sources.entries().find((entry) => entry.sessionId === sessionId)?.pendingPermissionRequest?.toolName ===
			"ExitPlanMode",
		readScreen: async (sessionId: string, paneId: string) => readTmuxScreen(sessionId, paneId, sources),
		...tmuxWriteDependencies("plan", sources, io),
	});
	const stream = async (
		sessionId: string,
		columns: number,
		rows: number,
		socket: TerminalObserverSocket,
		interactive: boolean,
	): Promise<TerminalController> => {
		parseViewport(columns, rows);
		const match = (await lookupTmuxSessionPanes(sources)).find((candidate) => candidate.sessionId === sessionId);
		if (match === undefined) throw new Error("No live tmux pane is linked to this session");
		return startTmuxTerminalStream({pane: match.pane, interactive}, socket, streamIo);
	};
	return {
		...noTerminalHost,
		id: "tmux",
		...TERMINAL_HOST_CAPABILITIES.tmux,
		listPanes: async () => (await lookupTmuxSessionPanes(sources)).map(toTmuxPaneLink),
		startPaneEvents: startTmuxPaneEvents,
		placementProvider: () => createTmuxPlacementProvider(sources),
		prompt: async (request) =>
			handleHerdrPrompt(request, {
				...defaultHerdrPromptDependencies,
				...writes,
				...tmuxWriteDependencies("prompt", sources, io),
				midTurn: {
					ready: (sessionId) =>
						midTurnPromptReady(
							sources.entries().find((entry) => entry.sessionId === sessionId),
							getPendingQuestion(sessionId),
						),
					pause: io.pause,
					...tmuxWriteDependencies("mid-turn-prompt", sources, io),
				},
			}),
		interrupt: async (request) =>
			handleHerdrInterrupt(request, {
				...defaultHerdrInterruptDependencies,
				...writes,
				...tmuxWriteDependencies("interrupt", sources, io),
			}),
		answerQuestion: async (request) =>
			handleHerdrQuestion(request, {
				...defaultHerdrQuestionDependencies,
				...writes,
				pause: io.pause,
				...tmuxWriteDependencies("question", sources, io),
			}),
		answerPermission: async (request) =>
			handleHerdrPermission(request, {
				...defaultHerdrPermissionDependencies,
				...writes,
				...tmuxWriteDependencies("permission", sources, io),
			}),
		readPlanDialog: async (request) => handleHerdrPlanDialog(request, planDependencies()),
		answerPlan: async (request) => handleHerdrPlan(request, planDependencies()),
		applyLiveOption: async (request) =>
			handleHerdrLiveOption(request, {
				...defaultHerdrLiveOptionDependencies,
				...writes,
				...tmuxWriteDependencies("live-option", sources, io),
			}),
		launch: async (request) =>
			handleHerdrLaunch(request, {
				...defaultHerdrLaunchDependencies,
				...writes,
				launchClaude: async (launch) => launchClaudeInTmux(launch, launchIo),
			}),
		observe: async (sessionId, columns, rows, socket) => stream(sessionId, columns, rows, socket, false),
		control: async (sessionId, columns, rows, socket) => stream(sessionId, columns, rows, socket, true),
		stopAllStreams: stopAllTmuxTerminalStreams,
	};
}

const tmuxTerminalHost = createTmuxTerminalHost();

export async function resolveTerminalHost(
	setting: TerminalHostSetting,
	probes: TerminalHostProbes = defaultTerminalHostProbes,
): Promise<TerminalHost> {
	const id = await selectTerminalHost(setting, probes);
	return id === "herdr" ? herdrTerminalHost : tmuxTerminalHost;
}

/** The host the Terminal host setting picks right now. */
export async function getTerminalHost(): Promise<TerminalHost> {
	return resolveTerminalHost(terminalHostSetting());
}

interface PaneEventStarters {
	herdr: () => () => void;
	tmux: () => () => void;
}

const defaultPaneEventStarters: PaneEventStarters = {
	herdr: herdrTerminalHost.startPaneEvents,
	tmux: tmuxTerminalHost.startPaneEvents,
};

/**
 * Start pane events at server startup for every host the setting can pick:
 * `auto` runs both, since the Terminals view lists herdr and tmux panes
 * together. herdr's bridge reconnects on its own, so herdr starting after ccp
 * still gets events.
 */
export function startTerminalHostEvents(
	setting: TerminalHostSetting = terminalHostSetting(),
	starters: PaneEventStarters = defaultPaneEventStarters,
): () => void {
	const stops = [
		...(setting === "tmux" ? [] : [starters.herdr()]),
		...(setting === "herdr" ? [] : [starters.tmux()]),
	];
	return () => {
		for (const stop of stops) stop();
	};
}

/** Server shutdown: stop the live terminal streams of every host that can open one. */
export function stopAllTerminalHostStreams(): void {
	herdrTerminalHost.stopAllStreams();
	tmuxTerminalHost.stopAllStreams();
}

/** Placement providers for the Terminals view: tmux windows always, plus herdr's panes when herdr is the host. */
export async function terminalPlacementProviders(): Promise<TerminalPlacementProvider[]> {
	const host = await getTerminalHost();
	const hostProvider = host.id === "tmux" ? null : host.placementProvider();
	return hostProvider === null ? [createTmuxPlacementProvider()] : [createTmuxPlacementProvider(), hostProvider];
}
