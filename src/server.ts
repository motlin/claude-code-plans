import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { homedir } from "node:os";
import { join } from "node:path";
import { createWatcher } from "./lib/watcher";
import { getDb, initDb, runInitialScan } from "./lib/db";
import { startSweep } from "./lib/active-session-store";
import { startNotificationsSweep } from "./lib/notifications-store";
import { getCacheDir } from "./lib/db/connection";
import { initPendingApprovalsCache } from "./lib/db/pending-approvals-cache";

const PLANS_DIR = join(homedir(), ".claude", "plans");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");
const COMMANDS_DIR = join(homedir(), ".claude", "commands");
const PLUGINS_DIR = join(homedir(), ".claude", "plugins", "cache");
const TASKS_DIR = join(homedir(), ".claude", "tasks");
const STATUSLINE_DIR = join(getCacheDir(), "statusline");

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

  let watcher;
  try {
    watcher = await createWatcher(
      [PLANS_DIR, PROJECTS_DIR, COMMANDS_DIR, PLUGINS_DIR, TASKS_DIR, STATUSLINE_DIR],
      PROJECTS_DIR,
      PLANS_DIR,
      STATUSLINE_DIR,
    );
  } catch (err) {
    console.error("Failed to create watcher:", err);
    return;
  }

  await new Promise<void>((resolve) => watcher.once("ready", () => resolve()));

  try {
    await runInitialScan();
  } catch (err) {
    console.error("Initial scan failed:", err);
  }

  startSweep();
  startNotificationsSweep();
})();

export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
