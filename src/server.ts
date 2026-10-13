import handler, {createServerEntry} from "@tanstack/react-start/server-entry";
import {homedir} from "node:os";
import {join} from "node:path";
import {withHeadBodyCancel} from "./lib/head-request";
import {withServerTiming} from "./lib/perf/server-timing";
import {formatStall, startStallMonitor, trackActivity, withActivityTracking} from "./lib/perf/event-loop-stalls";
import {
	closeWatcher,
	createWatcher,
	rebroadcastProjectSessions,
	rebroadcastSessionsById,
	resolveIgnoredDirNames,
} from "./lib/watcher";
import {getDb, getShutdownSignal, initDb, runInitialScan, shutdownDb} from "./lib/db";
import {startSweep, stopSweep} from "./lib/active-session-store";
import {SESSION_REGISTRY_DIR} from "./lib/session-registry";
import {startSessionRegistryMonitor, stopSessionRegistryMonitor} from "./lib/session-registry-store";
import {persistPendingQuestionsTo} from "./lib/pending-question-store";
import {startNotificationsSweep, stopNotificationsSweep} from "./lib/notifications-store";
import {startLiveSubagentSweep, stopLiveSubagentSweep} from "./lib/live-subagent-store";
import {DOMAIN_EVENTS, type SubagentStoppedPayload} from "./lib/hook-events";
import {broadcastTyped} from "./lib/sse-broadcast";
import {getCacheDir} from "./lib/db/connection";
import {initPendingApprovalsCache} from "./lib/db/pending-approvals-cache";
import {startHerdrEventBridge} from "./lib/herdr/subscribe";
import {resolveFileSearchRoots} from "./lib/config";
import type {RecursiveWatcher} from "./lib/recursive-watch";
import {initPrStatusService} from "./lib/pr-status-service";
import {takeOverServerShutdown} from "./lib/server-shutdown";
import {announceThisDevEnvReady} from "./lib/dev-env-ready-gate";
import {defined} from "./lib/defined";

const PLANS_DIR = join(homedir(), ".claude", "plans");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const COMMANDS_DIR = join(homedir(), ".claude", "commands");
const PLUGINS_DIR = join(homedir(), ".claude", "plugins", "cache");
const TASKS_DIR = join(homedir(), ".claude", "tasks");
const JOBS_DIR = join(homedir(), ".claude", "jobs");
const STATUSLINE_DIR = join(getCacheDir(), "statusline");

let stopHerdrEventBridge: (() => void) | null = null;

// In dev, log every event-loop stall longer than this with the requests and scan steps that ran during it.
const EVENT_LOOP_STALL_LOG_MS = 500;
let stopStallMonitor: (() => void) | null = import.meta.env.DEV
	? startStallMonitor({
			thresholdMs: EVENT_LOOP_STALL_LOG_MS,
			onStall: (stall) => {
				console.warn(formatStall(stall));
			},
		})
	: null;

void (async () => {
	// Release every long-lived handle startup creates so the process can exit
	// once the HTTP server closes (server/plugins/shutdown.ts runs this), and
	// so a restarted dev server's scan never races this instance's.
	await takeOverServerShutdown(async () => {
		stopSweep();
		stopSessionRegistryMonitor();
		stopNotificationsSweep();
		stopLiveSubagentSweep();
		stopHerdrEventBridge?.();
		stopHerdrEventBridge = null;
		stopStallMonitor?.();
		stopStallMonitor = null;
		await closeWatcher();
		await shutdownDb();
	});

	try {
		await trackActivity("startup open database", async () => initDb());
	} catch (err) {
		console.error("Failed to initialize database:", err);
		return;
	}

	// Live status from the CLI's ~/.claude/sessions registry, re-broadcast as session:updated rows.
	// Started before the slow scans: summaries read it directly, so rows show live state at once.
	startSessionRegistryMonitor({
		onChange: (sessionIds) => {
			rebroadcastSessionsById(sessionIds);
		},
	});

	// Questions sessions asked before this server started still dock.
	persistPendingQuestionsTo(join(getCacheDir(), "pending-questions.json"));

	try {
		await trackActivity("startup pending-approvals scan", async () =>
			initPendingApprovalsCache(getDb().index, getShutdownSignal()),
		);
	} catch (err) {
		console.error("Failed to initialize pending approvals cache:", err);
	}

	let watcher: RecursiveWatcher;
	const fileContentRoots = await trackActivity("startup file search roots", async () =>
		resolveFileSearchRoots(getDb().index),
	);
	const ignoredDirNames = resolveIgnoredDirNames();
	try {
		watcher = await trackActivity("startup watcher", async () =>
			createWatcher(
				[
					PLANS_DIR,
					PROJECTS_DIR,
					COMMANDS_DIR,
					PLUGINS_DIR,
					TASKS_DIR,
					STATUSLINE_DIR,
					JOBS_DIR,
					SESSION_REGISTRY_DIR,
				],
				PROJECTS_DIR,
				PLANS_DIR,
				STATUSLINE_DIR,
				fileContentRoots,
				JOBS_DIR,
				SESSION_REGISTRY_DIR,
			),
		);
	} catch (err) {
		console.error("Failed to create watcher:", err);
		return;
	}

	await trackActivity(
		"startup watcher ready",
		async () =>
			new Promise<void>((resolve) => {
				watcher.once("ready", () => {
					resolve();
				});
			}),
	);

	try {
		await trackActivity("startup initial scan", async () => runInitialScan(fileContentRoots, ignoredDirNames));
	} catch (err) {
		console.error("Initial scan failed:", err);
	}

	startSweep();
	startNotificationsSweep();
	startLiveSubagentSweep((node) => {
		broadcastTyped(DOMAIN_EVENTS.SUBAGENT_STOPPED, {
			sessionId: node.sessionId,
			agentType: node.agentType,
			agentId: node.agentId,
			endedAt: defined(node.endedAt, "a stopped subagent has an end time"),
		} satisfies SubagentStoppedPayload);
	});
	stopHerdrEventBridge = startHerdrEventBridge();
	initPrStatusService(rebroadcastProjectSessions);
})();

export default createServerEntry({
	fetch: withHeadBodyCancel(
		withServerTiming(withActivityTracking((request): Response | Promise<Response> => handler.fetch(request))),
	),
});

// Last statement of the SSR entry: tells the dev server's request gate (holdNitroRequestsUntilReady in
// vite.config.ts) that this environment has loaded. A no-op in production.
announceThisDevEnvReady();
