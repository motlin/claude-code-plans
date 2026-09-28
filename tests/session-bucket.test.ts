import { describe, expect, it } from "vite-plus/test";

import {
  resolveSessionBucket,
  type SessionBucketResolution,
  type SessionBucketSignals,
} from "../src/lib/session-state";

const NOW = 946_598_400_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const BASE: SessionBucketSignals = {
  mainState: "idle",
  pendingInput: false,
  unseenError: false,
  liveAgentCount: 0,
  backgroundTasks: [],
  lastSubagentActivityAt: null,
  herdrStatus: null,
  prState: null,
  unseen: false,
  fileMtime: NOW - 10 * MINUTE,
  now: NOW,
};

interface BucketCase {
  name: string;
  signals: Partial<SessionBucketSignals>;
  expected: SessionBucketResolution;
}

const TRANSITIONS: BucketCase[] = [
  {
    name: "1: done + main UserPromptSubmit -> working",
    signals: { mainState: "working" },
    expected: { bucket: "working", reason: "main-working" },
  },
  {
    name: "2: working + main AskUserQuestion/ExitPlanMode PreToolUse -> blocked",
    signals: { mainState: "waiting" },
    expected: { bucket: "blocked", reason: "waiting" },
  },
  {
    name: "2: working + PermissionRequest -> blocked",
    signals: { mainState: "working", pendingInput: true },
    expected: { bucket: "blocked", reason: "pending-input" },
  },
  {
    name: "3: blocked + PostToolUse / approval resolved -> working",
    signals: { mainState: "working", pendingInput: false },
    expected: { bucket: "working", reason: "main-working" },
  },
  {
    name: "4: working + main Stop, nothing running, unseen -> review",
    signals: { mainState: "idle", unseen: true },
    expected: { bucket: "review", reason: "unseen" },
  },
  {
    name: "4: review after markSeen -> done",
    signals: { mainState: "idle", unseen: false },
    expected: { bucket: "done", reason: "idle" },
  },
  {
    name: "5: main Stop with a running background local_agent -> stays working",
    signals: {
      mainState: "idle",
      unseen: true,
      backgroundTasks: [{ status: "running" }],
    },
    expected: { bucket: "working", reason: "background-tasks" },
  },
  {
    name: "5: main Stop with live subagent nodes -> stays working",
    signals: { mainState: "idle", unseen: true, liveAgentCount: 2 },
    expected: { bucket: "working", reason: "live-agents" },
  },
  {
    name: "6: last SubagentStop with no live agents -> review",
    signals: {
      mainState: "idle",
      unseen: true,
      liveAgentCount: 0,
      backgroundTasks: [{ status: "completed" }, { status: "failed" }, { status: "killed" }],
      lastSubagentActivityAt: NOW - 2 * MINUTE,
    },
    expected: { bucket: "review", reason: "unseen" },
  },
  {
    name: "7: recent subagent PreToolUse refreshes subagentActivity only",
    signals: { mainState: "idle", lastSubagentActivityAt: NOW - 30 * SECOND },
    expected: { bucket: "working", reason: "subagent-activity" },
  },
  {
    name: "8: subagent permission request -> blocked via pendingInput",
    signals: {
      mainState: "idle",
      liveAgentCount: 1,
      lastSubagentActivityAt: NOW - SECOND,
      pendingInput: true,
    },
    expected: { bucket: "blocked", reason: "pending-input" },
  },
  {
    name: "9: SessionEnd -> done even with live agents",
    signals: { mainState: "ended", liveAgentCount: 3, unseen: true },
    expected: { bucket: "done", reason: "ended" },
  },
  {
    name: "10: working via agents only, stale for over 10 min, no herdr working -> done",
    signals: {
      mainState: "idle",
      liveAgentCount: 0,
      lastSubagentActivityAt: NOW - 11 * MINUTE,
      herdrStatus: "idle",
    },
    expected: { bucket: "done", reason: "idle" },
  },
];

const PRECEDENCE: BucketCase[] = [
  {
    name: "ended with pending input stays blocked",
    signals: { mainState: "ended", pendingInput: true },
    expected: { bucket: "blocked", reason: "pending-input" },
  },
  {
    name: "unseen error is blocked",
    signals: { mainState: "idle", unseenError: true, unseen: true },
    expected: { bucket: "blocked", reason: "error" },
  },
  {
    name: "blocked beats working",
    signals: { mainState: "waiting", liveAgentCount: 1, backgroundTasks: [{ status: "running" }] },
    expected: { bucket: "blocked", reason: "waiting" },
  },
  {
    name: "working beats review",
    signals: { mainState: "working", unseen: true, prState: "open" },
    expected: { bucket: "working", reason: "main-working" },
  },
  {
    name: "herdr working keeps the session working when hooks are missing",
    signals: { mainState: "idle", herdrStatus: "working" },
    expected: { bucket: "working", reason: "herdr-working" },
  },
  {
    name: "open pull request is review even when seen",
    signals: { mainState: "idle", prState: "open" },
    expected: { bucket: "review", reason: "pull-request" },
  },
  {
    name: "draft pull request is review",
    signals: { mainState: "idle", prState: "draft" },
    expected: { bucket: "review", reason: "pull-request" },
  },
  {
    name: "merged pull request falls through to done",
    signals: { mainState: "idle", prState: "merged" },
    expected: { bucket: "done", reason: "idle" },
  },
  {
    name: "fs-only unknown session with a fresh jsonl is working",
    signals: { mainState: "unknown", fileMtime: NOW - 59 * SECOND },
    expected: { bucket: "working", reason: "recent-file" },
  },
  {
    name: "fs-only unknown session with a stale jsonl is done",
    signals: { mainState: "unknown", fileMtime: NOW - 61 * SECOND, unseen: true },
    expected: { bucket: "done", reason: "stale-file" },
  },
];

describe("resolveSessionBucket", () => {
  it.each(TRANSITIONS)("transition $name", ({ signals, expected }) => {
    expect(resolveSessionBucket({ ...BASE, ...signals })).toStrictEqual(expected);
  });

  it.each(PRECEDENCE)("precedence: $name", ({ signals, expected }) => {
    expect(resolveSessionBucket({ ...BASE, ...signals })).toStrictEqual(expected);
  });
});
