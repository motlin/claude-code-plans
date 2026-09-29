import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  JobStateFileSchema,
  JobTimelineEntrySchema,
  jobSessionLink,
  parseJobTimeline,
  sortJobs,
  toJob,
  type JobStateFile,
} from "../src/lib/jobs";
import { readJobs } from "../src/lib/jobs-reader";
import { __testing } from "../src/lib/watcher";
import { DOMAIN_EVENTS } from "../src/lib/hook-events";

const DONE_STATE = {
  state: "done",
  detail: "Treemap of recurring expenses built",
  tempo: "idle",
  inFlight: { tasks: 0, queued: 0, kinds: [], drainableMonitors: 0 },
  tokens: 43332,
  output: { result: "Treemap visualization of recurring expenses by category" },
  children: [
    {
      id: "treemap.html",
      href: "https://claude.ai/code/artifact/0000",
      kind: "frame",
      title: "Where the money goes",
    },
    { id: "12", href: "https://github.com/alice/app/pull/12", kind: "pr" },
  ],
  linkScanOffset: 3273917,
  linkScanPath: "/Users/alice/.claude/projects/-Users-alice-projects-app/0b3837ca-bfa3-4316.jsonl",
  template: "bg",
  respawnFlags: ["--permission-mode", "auto"],
  providerEnv: {},
  forkSourceAlive: false,
  forkBoundaryAt: "2026-09-02T21:52:09.290Z",
  forkSessionId: "0b3837ca-bfa3-4316",
  forkParentSessionId: "ffff0000-1111",
  interactiveLineage: true,
  intent: "Build a treemap of recurring expenses",
  name: "expenses-treemap",
  nameSource: "auto",
  sessionId: "0b3837ca-bfa3-4316",
  resumeSessionId: "0b3837ca-bfa3-4316",
  daemonShort: "0b3837ca",
  cliVersion: "2.1.90",
  cwd: "/Users/alice/projects/app",
  createdAt: "2026-09-02T21:52:09.290Z",
  updatedAt: "2026-09-03T00:20:49.936Z",
  firstTerminalAt: "2026-09-03T00:20:07.652Z",
  lastTerminalAt: "2026-09-03T00:20:49.936Z",
  bridgeSessionId: "cse_0001",
  bridgeOwnerAccountUuid: "acct-0001",
  bridgeOwnerOrganizationUuid: "org-0001",
  bridgeOutboundOnly: true,
  backend: "daemon",
  bridgeSessionSeq: 4,
};

const BLOCKED_STATE = {
  state: "blocked",
  detail: "Which walk should this fork take?",
  tempo: "blocked",
  inFlight: { tasks: 4, queued: 0, kinds: ["in_process_teammate"] },
  fan: [
    {
      id: "tcs2z67mo",
      kind: "agent",
      label: "Read-only audit",
      startedAt: 1785726539092,
      doneAt: 0,
    },
  ],
  output: null,
  children: null,
  linkScanOffset: 99892,
  linkScanPath: "/Users/alice/.claude/projects/-Users-alice-Pictures/221f2efe-7e21.jsonl",
  template: "bg",
  respawnFlags: [],
  intent: "Rescan the photo library",
  name: "photo-rescan",
  nameSource: "user",
  sessionId: "221f2efe-7e21",
  resumeSessionId: "221f2efe-7e21",
  daemonShort: "221f2efe",
  cliVersion: "2.1.80",
  cwd: "/Users/alice/Pictures",
  bgIsolation: "none",
  providerEnv: {},
  backend: "daemon",
  createdAt: "2026-05-23T12:26:12.686Z",
  updatedAt: "2026-05-27T13:05:02.592Z",
  firstTerminalAt: null,
  needs: "answer: Which walk should this fork take?",
  block: {
    questions: [
      {
        question: "Which walk should this fork take?",
        options: [
          { label: "Take over the walk", description: "Continue where it stopped" },
          { label: "Read-only analysis", description: "Only report" },
        ],
      },
    ],
  },
};

const REAPED_STATE = {
  state: "failed",
  detail: "process gone while supervisor was down",
  tempo: "idle",
  output: null,
  children: null,
  linkScanOffset: 0,
  template: "bg",
  respawnFlags: [],
  bgIsolation: "none",
  providerEnv: {},
  intent: "Default test command",
  name: "test-command",
  nameSource: "auto",
  sessionId: "171ac680-c49d",
  resumeSessionId: "171ac680-c49d",
  daemonShort: "171ac680",
  cwd: "/Users/alice/projects/template",
  createdAt: "2026-05-27T11:39:54.933Z",
  updatedAt: "2026-08-03T01:00:28.270Z",
  firstTerminalAt: "2026-08-03T01:00:28.270Z",
  backend: "daemon",
  reapedMidWorkAt: "2026-06-26T18:20:57.936Z",
};

const TIMELINE = [
  { at: "2026-09-02T21:52:10.000Z", state: "running", detail: "Build the treemap", text: "" },
  { at: "2026-09-02T22:00:00.000Z", state: "working", detail: "Reading statements", text: "" },
  {
    at: "2026-09-03T00:20:49.936Z",
    state: "done",
    detail: "Treemap built",
    text: "Treemap built",
  },
];

function timelineText(entries: readonly object[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

describe("JobStateFileSchema", () => {
  it("parses done, blocked and reaped job state files", () => {
    expect(
      [DONE_STATE, BLOCKED_STATE, REAPED_STATE].map(
        (state) => JobStateFileSchema.safeParse(state).success,
      ),
    ).toStrictEqual([true, true, true]);
  });

  it("rejects unknown keys and unknown states", () => {
    expect({
      extraKey: JobStateFileSchema.safeParse({ ...DONE_STATE, surprise: 1 }).success,
      unknownState: JobStateFileSchema.safeParse({ ...DONE_STATE, state: "exploded" }).success,
    }).toStrictEqual({ extraKey: false, unknownState: false });
  });
});

describe("parseJobTimeline", () => {
  it("parses each timeline.jsonl line and skips blank lines", () => {
    expect(parseJobTimeline(timelineText(TIMELINE) + "\n")).toStrictEqual(TIMELINE);
  });

  it("rejects timeline entries with unknown keys", () => {
    expect(JobTimelineEntrySchema.safeParse({ ...TIMELINE[0], extra: true }).success).toBe(false);
  });
});

describe("jobSessionLink", () => {
  it("derives the session and project from linkScanPath", () => {
    expect(
      jobSessionLink(
        "/Users/alice/.claude/projects/-Users-alice-projects-app/0b3837ca-bfa3-4316.jsonl",
      ),
    ).toStrictEqual({ sessionId: "0b3837ca-bfa3-4316", projectId: "-Users-alice-projects-app" });
  });

  it("has no link without a linkScanPath or for a non-JSONL path", () => {
    expect([jobSessionLink(undefined), jobSessionLink("/Users/alice/notes.txt")]).toStrictEqual([
      null,
      null,
    ]);
  });
});

describe("toJob", () => {
  it("derives the list row from state.json and timeline.jsonl", () => {
    const state: JobStateFile = JobStateFileSchema.parse(DONE_STATE);
    expect(toJob("0b3837ca", state, parseJobTimeline(timelineText(TIMELINE)))).toStrictEqual({
      id: "0b3837ca",
      name: "expenses-treemap",
      intent: "Build a treemap of recurring expenses",
      state: "done",
      detail: "Treemap of recurring expenses built",
      needs: null,
      result: "Treemap visualization of recurring expenses by category",
      cwd: "/Users/alice/projects/app",
      createdAt: Date.parse("2026-09-02T21:52:09.290Z"),
      updatedAt: Date.parse("2026-09-03T00:20:49.936Z"),
      sessionId: "0b3837ca-bfa3-4316",
      projectId: "-Users-alice-projects-app",
      children: [
        {
          id: "treemap.html",
          href: "https://claude.ai/code/artifact/0000",
          kind: "frame",
          title: "Where the money goes",
        },
        { id: "12", href: "https://github.com/alice/app/pull/12", kind: "pr", title: null },
      ],
      timeline: TIMELINE.map((entry) => ({ ...entry, at: Date.parse(entry.at) })),
    });
  });

  it("carries needs for blocked jobs and no link for reaped jobs", () => {
    const blocked = toJob("221f2efe", JobStateFileSchema.parse(BLOCKED_STATE), []);
    const reaped = toJob("171ac680", JobStateFileSchema.parse(REAPED_STATE), []);
    expect({
      blocked: { needs: blocked.needs, result: blocked.result, sessionId: blocked.sessionId },
      reaped: { state: reaped.state, sessionId: reaped.sessionId, projectId: reaped.projectId },
    }).toStrictEqual({
      blocked: {
        needs: "answer: Which walk should this fork take?",
        result: null,
        sessionId: "221f2efe-7e21",
      },
      reaped: { state: "failed", sessionId: null, projectId: null },
    });
  });
});

describe("sortJobs", () => {
  it("lists the most recently updated jobs first", () => {
    const jobs = [
      toJob("reaped", JobStateFileSchema.parse(REAPED_STATE), []),
      toJob("blocked", JobStateFileSchema.parse(BLOCKED_STATE), []),
      toJob("done", JobStateFileSchema.parse(DONE_STATE), []),
    ];
    expect(sortJobs(jobs).map((job) => job.id)).toStrictEqual(["done", "reaped", "blocked"]);
  });
});

describe("readJobs", () => {
  let jobsDir: string;

  beforeEach(() => {
    jobsDir = mkdtempSync(join(tmpdir(), "jobs-test-"));
  });

  afterEach(() => {
    rmSync(jobsDir, { recursive: true, force: true });
  });

  function writeJob(id: string, state: object, timeline?: readonly object[]): void {
    mkdirSync(join(jobsDir, id, "tmp"), { recursive: true });
    writeFileSync(join(jobsDir, id, "state.json"), JSON.stringify(state));
    if (timeline) writeFileSync(join(jobsDir, id, "timeline.jsonl"), timelineText(timeline));
  }

  it("reads every job directory with a state.json, newest first", async () => {
    writeJob("0b3837ca", DONE_STATE, TIMELINE);
    writeJob("171ac680", REAPED_STATE);
    writeJob("broken00", { ...DONE_STATE, state: "exploded" });
    mkdirSync(join(jobsDir, "05108040"));
    writeFileSync(join(jobsDir, "pins.json"), "[]");

    const jobs = await readJobs(jobsDir);

    expect(
      jobs.map((job) => ({ id: job.id, state: job.state, timeline: job.timeline.length })),
    ).toStrictEqual([
      { id: "0b3837ca", state: "done", timeline: 3 },
      { id: "171ac680", state: "failed", timeline: 0 },
    ]);
  });

  it("returns no jobs when the jobs directory is missing", async () => {
    expect(await readJobs(join(jobsDir, "missing"))).toStrictEqual([]);
  });
});

describe("handleJobFileEvent", () => {
  it("broadcasts jobs:changed for a job's state.json or timeline.jsonl only", () => {
    const broadcasts: Array<{ type: string; data: Record<string, unknown> }> = [];
    const broadcast = (type: string, data: Record<string, unknown>) =>
      broadcasts.push({ type, data });
    const jobsDir = "/Users/alice/.claude/jobs";

    const handled = [
      __testing.handleJobFileEvent(`${jobsDir}/0b3837ca/state.json`, jobsDir, broadcast),
      __testing.handleJobFileEvent(`${jobsDir}/0b3837ca/timeline.jsonl`, jobsDir, broadcast),
      __testing.handleJobFileEvent(`${jobsDir}/0b3837ca/tmp/scratch.json`, jobsDir, broadcast),
      __testing.handleJobFileEvent(`${jobsDir}/pins.json`, jobsDir, broadcast),
      __testing.handleJobFileEvent(
        "/Users/alice/.claude/projects/p/timeline.jsonl",
        jobsDir,
        broadcast,
      ),
    ];

    expect({ handled, broadcasts }).toStrictEqual({
      handled: [true, true, true, true, false],
      broadcasts: [
        { type: DOMAIN_EVENTS.JOBS_CHANGED, data: { jobId: "0b3837ca" } },
        { type: DOMAIN_EVENTS.JOBS_CHANGED, data: { jobId: "0b3837ca" } },
      ],
    });
  });
});

describe("JobStateFileSchema against disk", () => {
  const jobsDir = join(homedir(), ".claude", "jobs");

  it("validates every job state.json and timeline.jsonl on disk", () => {
    let entries: string[];
    try {
      entries = readdirSync(jobsDir);
    } catch {
      return;
    }

    const failures: string[] = [];
    for (const entry of entries) {
      let stateRaw: string;
      try {
        stateRaw = readFileSync(join(jobsDir, entry, "state.json"), "utf-8");
      } catch {
        continue;
      }
      const state = JobStateFileSchema.safeParse(JSON.parse(stateRaw));
      if (!state.success) {
        failures.push(`${entry}/state.json: ${state.error.message}`);
      }
      let timelineRaw: string;
      try {
        timelineRaw = readFileSync(join(jobsDir, entry, "timeline.jsonl"), "utf-8");
      } catch {
        continue;
      }
      try {
        parseJobTimeline(timelineRaw);
      } catch (error) {
        failures.push(`${entry}/timeline.jsonl: ${String(error)}`);
      }
    }

    expect(failures).toStrictEqual([]);
  });
});
