import { z } from "zod";

/**
 * CLI background jobs under `~/.claude/jobs/<short>/`: `state.json` holds the
 * job's latest state and `timeline.jsonl` one line per state transition. The
 * Background jobs page is the local analogue of claude.ai's Dispatch Tasks.
 */

/** Job state; `running` only appears in timeline entries so far. */
export const JobStateSchema = z.enum(["working", "running", "blocked", "done", "failed"]);
export type JobState = z.infer<typeof JobStateSchema>;

export const JobTempoSchema = z.enum(["idle", "blocked"]);

export const JobNameSourceSchema = z.enum(["auto", "user"]);

export const JobChildKindSchema = z.enum(["frame", "pr"]);

export const JobFanKindSchema = z.enum(["agent"]);

const JobChildSchema = z.strictObject({
  id: z.string(),
  href: z.string(),
  kind: JobChildKindSchema,
  title: z.string().optional(),
});

const JobFanEntrySchema = z.strictObject({
  id: z.string(),
  kind: JobFanKindSchema,
  label: z.string(),
  startedAt: z.number(),
  doneAt: z.number(),
});

const JobBlockSchema = z.strictObject({
  questions: z.array(
    z.strictObject({
      question: z.string(),
      options: z.array(z.strictObject({ label: z.string(), description: z.string() })),
    }),
  ),
});

export const JobStateFileSchema = z.strictObject({
  state: JobStateSchema,
  detail: z.string(),
  tempo: JobTempoSchema,
  inFlight: z
    .strictObject({
      tasks: z.number(),
      queued: z.number(),
      kinds: z.array(z.string()),
      drainableMonitors: z.number().optional(),
    })
    .optional(),
  fan: z.array(JobFanEntrySchema).optional(),
  tokens: z.number().optional(),
  needs: z.string().optional(),
  block: JobBlockSchema.optional(),
  output: z.strictObject({ result: z.string() }).nullable(),
  children: z.array(JobChildSchema).nullable(),
  linkScanOffset: z.number(),
  linkScanPath: z.string().optional(),
  template: z.literal("bg"),
  respawnFlags: z.array(z.string()),
  providerEnv: z.record(z.string(), z.string()).optional(),
  forkSourceAlive: z.boolean().optional(),
  forkBoundaryAt: z.string().optional(),
  forkSessionId: z.string().optional(),
  forkParentSessionId: z.string().optional(),
  interactiveLineage: z.boolean().optional(),
  intent: z.string(),
  name: z.string(),
  nameSource: JobNameSourceSchema,
  sessionId: z.string(),
  resumeSessionId: z.string(),
  daemonShort: z.string(),
  cliVersion: z.string().optional(),
  cwd: z.string(),
  bgIsolation: z.literal("none").optional(),
  backend: z.literal("daemon"),
  createdAt: z.string(),
  updatedAt: z.string(),
  firstTerminalAt: z.string().nullable().optional(),
  lastTerminalAt: z.string().optional(),
  reapedMidWorkAt: z.string().optional(),
  bridgeSessionId: z.string().optional(),
  bridgeOwnerAccountUuid: z.string().optional(),
  bridgeOwnerOrganizationUuid: z.string().optional(),
  bridgeOutboundOnly: z.boolean().optional(),
  bridgeSessionSeq: z.number().optional(),
});
export type JobStateFile = z.infer<typeof JobStateFileSchema>;

export const JobTimelineEntrySchema = z.strictObject({
  at: z.string(),
  state: JobStateSchema,
  detail: z.string(),
  text: z.string(),
});
export type JobTimelineEntry = z.infer<typeof JobTimelineEntrySchema>;

/** Parse `timeline.jsonl`; throws on a malformed or schema-violating line. */
export function parseJobTimeline(text: string): JobTimelineEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JobTimelineEntrySchema.parse(JSON.parse(line)));
}

/** The session transcript a job writes to, from its `linkScanPath`. */
export function jobSessionLink(
  linkScanPath: string | undefined,
): { sessionId: string; projectId: string } | null {
  if (linkScanPath === undefined || !linkScanPath.endsWith(".jsonl")) return null;
  const segments = linkScanPath.split("/");
  const file = segments.at(-1) ?? "";
  const projectId = segments.at(-2) ?? "";
  const sessionId = file.slice(0, -".jsonl".length);
  if (sessionId === "" || projectId === "") return null;
  return { sessionId, projectId };
}

export interface JobChild {
  id: string;
  href: string;
  kind: z.infer<typeof JobChildKindSchema>;
  title: string | null;
}

export interface Job {
  id: string;
  name: string;
  intent: string;
  state: JobState;
  detail: string;
  needs: string | null;
  result: string | null;
  cwd: string;
  createdAt: number;
  updatedAt: number;
  sessionId: string | null;
  projectId: string | null;
  children: JobChild[];
  timeline: Array<{ at: number; state: JobState; detail: string; text: string }>;
}

export function toJob(id: string, state: JobStateFile, timeline: JobTimelineEntry[]): Job {
  const link = jobSessionLink(state.linkScanPath);
  return {
    id,
    name: state.name,
    intent: state.intent,
    state: state.state,
    detail: state.detail,
    needs: state.needs ?? null,
    result: state.output?.result ?? null,
    cwd: state.cwd,
    createdAt: Date.parse(state.createdAt),
    updatedAt: Date.parse(state.updatedAt),
    sessionId: link?.sessionId ?? null,
    projectId: link?.projectId ?? null,
    children: (state.children ?? []).map((child) => ({
      id: child.id,
      href: child.href,
      kind: child.kind,
      title: child.title ?? null,
    })),
    timeline: timeline.map((entry) => ({ ...entry, at: Date.parse(entry.at) })),
  };
}

/** Most recently updated first. */
export function sortJobs(jobs: readonly Job[]): Job[] {
  return [...jobs].sort((a, b) => b.updatedAt - a.updatedAt);
}
