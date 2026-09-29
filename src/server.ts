import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { homedir } from "node:os";
import { join } from "node:path";
import { withHeadBodyCancel } from "./lib/head-request";
import {
  closeWatcher,
  createWatcher,
  rebroadcastProjectSessions,
  resolveIgnoredDirNames,
} from "./lib/watcher";
import { getDb, initDb, runInitialScan } from "./lib/db";
import { startSweep, stopSweep } from "./lib/active-session-store";
import { startNotificationsSweep, stopNotificationsSweep } from "./lib/notifications-store";
import { startLiveSubagentSweep, stopLiveSubagentSweep } from "./lib/live-subagent-store";
import { DOMAIN_EVENTS, type SubagentStoppedPayload } from "./lib/hook-events";
import { broadcastTyped } from "./lib/sse-broadcast";
import { getCacheDir } from "./lib/db/connection";
import { initPendingApprovalsCache } from "./lib/db/pending-approvals-cache";
import { startHerdrEventBridge } from "./lib/herdr/subscribe";
import { resolveFileSearchRoots } from "./lib/config";
import type { RecursiveWatcher } from "./lib/recursive-watch";
import { initPrStatusService } from "./lib/pr-status-service";
import { onServerShutdown } from "./lib/server-shutdown";

const PLANS_DIR = join(homedir(), ".claude", "plans");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const COMMANDS_DIR = join(homedir(), ".claude", "commands");
const PLUGINS_DIR = join(homedir(), ".claude", "plugins", "cache");
const TASKS_DIR = join(homedir(), ".claude", "tasks");
const JOBS_DIR = join(homedir(), ".claude", "jobs");
const STATUSLINE_DIR = join(getCacheDir(), "statusline");

let stopHerdrEventBridge: (() => void) | null = null;

// Release every long-lived handle startup creates so the process can exit
// once the HTTP server closes (server/plugins/shutdown.ts runs this).
onServerShutdown(async () => {
  stopSweep();
  stopNotificationsSweep();
  stopLiveSubagentSweep();
  stopHerdrEventBridge?.();
  stopHerdrEventBridge = null;
  await closeWatcher();
});

void (async () => {
  try {
    await initDb();
  } catch (err) {
    console.error("Failed to initialize database:", err);
    return;
  }

  try {
    await initPendingApprovalsCache(getDb().index);
  } catch (err) {
    console.error("Failed to initialize pending approvals cache:", err);
  }

  let watcher: RecursiveWatcher;
  const fileContentRoots = await resolveFileSearchRoots(getDb().index);
  const ignoredDirNames = resolveIgnoredDirNames();
  try {
    watcher = await createWatcher(
      [PLANS_DIR, PROJECTS_DIR, COMMANDS_DIR, PLUGINS_DIR, TASKS_DIR, STATUSLINE_DIR, JOBS_DIR],
      PROJECTS_DIR,
      PLANS_DIR,
      STATUSLINE_DIR,
      fileContentRoots,
      JOBS_DIR,
    );
  } catch (err) {
    console.error("Failed to create watcher:", err);
    return;
  }

  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

  try {
    await runInitialScan(fileContentRoots, ignoredDirNames);
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
      endedAt: node.endedAt!,
    } satisfies SubagentStoppedPayload);
  });
  stopHerdrEventBridge = startHerdrEventBridge();
  initPrStatusService(rebroadcastProjectSessions);
})();

export default createServerEntry({
  fetch: withHeadBodyCancel((request) => handler.fetch(request)),
});
