import { z } from "zod";

import { PullRequestStateSchema, type PullRequestState } from "./session-state";
import type { SessionPrLink } from "./sessions";

/** A session's pull request: its number and a normalized state. */
export const PrStatusSchema = z
  .object({ number: z.number().int().positive(), state: PullRequestStateSchema })
  .strict();
export type PrStatus = z.infer<typeof PrStatusSchema>;

/** One row of `gh pr list|view --json number,state,isDraft`. */
export const GhPrStateSchema = z.enum(["OPEN", "CLOSED", "MERGED"]);
const GhPrItemSchema = z
  .object({ number: z.number().int().positive(), state: GhPrStateSchema, isDraft: z.boolean() })
  .strict();
type GhPrItem = z.infer<typeof GhPrItemSchema>;

const GH_PR_FIELDS = "number,state,isDraft";

function fromGhItem(item: GhPrItem): PrStatus {
  const state: PullRequestState =
    item.state === "OPEN"
      ? item.isDraft
        ? "draft"
        : "open"
      : item.state === "MERGED"
        ? "merged"
        : "closed";
  return { number: item.number, state };
}

/** Parse `gh pr view --json number,state,isDraft`; throws on anything off-schema. */
export function parseGhPrView(stdout: string): PrStatus {
  return fromGhItem(GhPrItemSchema.parse(JSON.parse(stdout)));
}

/**
 * Parse `gh pr list --head <branch> --json number,state,isDraft` (newest first). An open PR wins
 * over newer closed ones; otherwise the newest PR. Throws on anything off-schema.
 */
export function parseGhPrList(stdout: string): PrStatus | null {
  const items = z.array(GhPrItemSchema).parse(JSON.parse(stdout));
  const chosen = items.find((item) => item.state === "OPEN") ?? items[0];
  return chosen === undefined ? null : fromGhItem(chosen);
}

/** `state` values in the statusline's `~/.claude/gh-pr-status-cache.json`. */
export const GhPrStatusCacheStateSchema = z.enum(["OPEN", "DRAFT", "MERGED", "CLOSED"]);
export const GhPrReviewDecisionSchema = z.enum([
  "APPROVED",
  "CHANGES_REQUESTED",
  "REVIEW_REQUIRED",
]);

const GhPrStatusCacheEntrySchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string(),
    state: GhPrStatusCacheStateSchema,
    checks: z
      .object({ passed: z.number().int(), failed: z.number().int(), pending: z.number().int() })
      .strict(),
    review: GhPrReviewDecisionSchema.nullable(),
    additions: z.number().int(),
    deletions: z.number().int(),
  })
  .strict();

const CACHE_STATES = {
  OPEN: "open",
  DRAFT: "draft",
  MERGED: "merged",
  CLOSED: "closed",
} as const satisfies Record<z.infer<typeof GhPrStatusCacheStateSchema>, PullRequestState>;

/**
 * Parse `~/.claude/gh-pr-status-cache.json` (PR url → status). Entries that fail the strict
 * schema are skipped so one odd entry cannot hide the rest; unparseable JSON is an empty cache.
 */
export function parseGhPrStatusCache(text: string): Map<string, PrStatus> {
  const statuses = new Map<string, PrStatus>();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return statuses;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return statuses;
  for (const [url, value] of Object.entries(raw)) {
    const parsed = GhPrStatusCacheEntrySchema.safeParse(value);
    if (parsed.success) {
      statuses.set(url, { number: parsed.data.number, state: CACHE_STATES[parsed.data.state] });
    }
  }
  return statuses;
}

/**
 * Source precedence: the indexed `pr-link` record names the PR; its state comes from the
 * statusline cache file, then from `gh`. Without a `pr-link`, a `gh pr list --head` hit stands alone.
 */
export function resolvePrStatus({
  prLink,
  cacheFile,
  gh,
}: {
  prLink: SessionPrLink | undefined;
  cacheFile: ReadonlyMap<string, PrStatus>;
  gh: PrStatus | null | undefined;
}): PrStatus | null {
  if (prLink !== undefined) {
    const state = cacheFile.get(prLink.url)?.state ?? gh?.state;
    return state === undefined ? null : { number: prLink.number, state };
  }
  return gh ?? null;
}

export interface GhPrLookup {
  /** Dedupe key shared by every session asking the same question. */
  key: string;
  args: string[];
  cwd: string | undefined;
  kind: "view" | "list";
}

const DEFAULT_BRANCHES = new Set(["main", "master", "HEAD"]);

/** The `gh` argv answering a session's PR question, or null when there is nothing to ask. */
export function ghPrLookup({
  prLink,
  cwd,
  branch,
}: {
  prLink: SessionPrLink | undefined;
  cwd: string | undefined;
  branch: string | undefined;
}): GhPrLookup | null {
  if (prLink !== undefined) {
    return {
      key: `url:${prLink.url}`,
      args: ["pr", "view", prLink.url, "--json", GH_PR_FIELDS],
      cwd: undefined,
      kind: "view",
    };
  }
  if (cwd === undefined || branch === undefined || DEFAULT_BRANCHES.has(branch)) return null;
  return {
    key: `branch:${cwd}\u0000${branch}`,
    args: [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      GH_PR_FIELDS,
    ],
    cwd,
    kind: "list",
  };
}

/** Upstream `--cds-text-git-*` states; each has a `--color-git-<state>` token in globals.css. */
export type GitPrState = "opened" | "draft" | "merged" | "closed" | "conflicting" | "queued";

const GIT_PR_STATES = {
  open: "opened",
  draft: "draft",
  merged: "merged",
  closed: "closed",
} as const satisfies Record<PullRequestState, GitPrState>;

/** The `SessionStateIcon` `pr` prop for a PR status. */
export function prGlyph(pr: PrStatus): { number: number; state: GitPrState } {
  return { number: pr.number, state: GIT_PR_STATES[pr.state] };
}
