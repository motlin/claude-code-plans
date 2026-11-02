import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/** Which changes the Changes pane shows. Git scopes read the session's checkout; the rest read its JSONL. */
export type SessionDiffScope =
	|
	  {
			kind: "branch";
	  }
	|
	  {
			kind: "uncommitted";
	  }
	|
	  {
			kind: "commit";
			sha: string;
	  }
	|
	  {
			kind: "session";
	  }
	|
	  {
			kind: "turn";
			uuid: string;
	  };

const COMMIT_SHA_PATTERN = /^[0-9a-f]{4,64}$/i;

/** Parse the `scope` query value; returns null for anything malformed. */
export function parseDiffScope(value: string): SessionDiffScope | null
{
	if (value === "branch" || value === "uncommitted" || value === "session")
		return {
			kind: value,
		};
	if (value.startsWith("commit:"))
	{
		const sha = value.slice("commit:".length);
		return COMMIT_SHA_PATTERN.test(sha)
			?
				{
					kind: "commit",
					sha,
				}
			: null;
	}
	if (value.startsWith("turn:"))
	{
		const uuid = value.slice("turn:".length);
		return uuid === ""
			? null
			:
				{
					kind: "turn",
					uuid,
				};
	}
	return null;
}

export function formatDiffScope(scope: SessionDiffScope): string
{
	switch (scope.kind)
	{
		case "commit":
			return `commit:${scope.sha}`;
		case "turn":
			return `turn:${scope.uuid}`;
		default:
			return scope.kind;
	}
}

const SessionDiffFileSchema = z
	.object(
		{
			path: z.string(),
			oldPath: z.string().optional(),
			status: z.enum(["added", "deleted", "modified", "renamed"]),
			additions: z.number().int().nonnegative(),
			deletions: z.number().int().nonnegative(),
			binary: z.boolean(),
			patchLineCount: z.number().int().nonnegative(),
			/** Null when the patch is too large to inline; fetch it with `&file=<path>`. */
			patch: z.string().nullable(),
		},
	)
	.strict();

export type SessionDiffFile = z.infer<typeof SessionDiffFileSchema>;

export const SessionDiffResponseSchema = z
	.object(
		{
			/** The scope actually served; `session` when a git scope fell back because the repo is gone. */
			scope: z.string(),
			source: z.enum(["git", "session-edits"]),
			/** What relative file paths are relative to: the repository toplevel for git, the session cwd for session edits. */
			root: z.string(),
			stats: z
				.object(
					{
						files: z.number().int().nonnegative(),
						additions: z.number().int().nonnegative(),
						deletions: z.number().int().nonnegative(),
					},
				)
				.strict(),
			files: z.array(SessionDiffFileSchema),
		},
	)
	.strict();

export type SessionDiffResponse = z.infer<typeof SessionDiffResponseSchema>;

export const SessionDiffFileResponseSchema = z
	.object(
		{
			scope: z.string(),
			root: z.string(),
			file: SessionDiffFileSchema,
		},
	)
	.strict();

/** Both sides of one diff file (`&lines=1`); a side is null when it couldn't be read. */
export const SessionDiffFileLinesResponseSchema = z
	.object(
		{
			scope: z.string(),
			oldText: z.string().nullable(),
			newText: z.string().nullable(),
		},
	)
	.strict();

type SessionDiffFileLinesResponse = z.infer<typeof SessionDiffFileLinesResponseSchema>;

/** A diff path made absolute against the response's `root`; absolute paths (outside-cwd session edits) pass through. */
export function resolveAbsoluteDiffPath(root: string, path: string): string
{
	if (path.startsWith("/")) return path;
	return `${root.replace(/\/+$/, "")}/${path}`;
}

const SessionDiffCommitSchema = z
	.object(
		{
			sha: z.string(),
			shortSha: z.string(),
			subject: z.string(),
			author: z.string(),
			date: z.string(),
		},
	)
	.strict();

export const SessionDiffScopesResponseSchema = z.discriminatedUnion("kind", [
	z
		.object(
			{
				kind: z.literal("git"),
				base: z.string(),
				baseRef: z.string(),
				mergeBase: z.string(),
				head: z.string().nullable(),
				uncommittedAvailable: z.boolean(),
				commits: z.array(SessionDiffCommitSchema),
				totalCommits: z.number().int().nonnegative(),
			},
		)
		.strict(),
	z
		.object(
			{
				kind: z.literal("no-git"),
			},
		)
		.strict(),
]);

export type SessionDiffScopesResponse = z.infer<typeof SessionDiffScopesResponseSchema>;

export const SessionDiffErrorResponseSchema = z
	.object(
		{
			error: z.string(),
		},
	)
	.strict();

export interface SessionDiffQueryFlags
{
	hideWhitespace?: boolean;
}

const sessionDiffQueryKeys =
{
	diff: (sessionId: string, scope: string, hideWhitespace: boolean) =>
		["sessions", sessionId, "diff", scope, hideWhitespace] as const,
	file: (sessionId: string, scope: string, hideWhitespace: boolean, path: string) =>
		["sessions", sessionId, "diff", scope, hideWhitespace, "file", path] as const,
	lines: (sessionId: string, scope: string, path: string, contentKey: string) =>
		["sessions", sessionId, "diff", scope, "lines", path, contentKey] as const,
	scopes: (sessionId: string) => ["sessions", sessionId, "diff", "scopes"] as const,
};

function diffUrl(sessionId: string, scope: string, hideWhitespace: boolean, file?: string, lines = false): string
{
	const parameters = new URLSearchParams(
		{
			scope,
			ws: hideWhitespace ? "1" : "0",
		},
	);
	if (file !== undefined) parameters.set("file", file);
	if (lines) parameters.set("lines", "1");
	return `/api/sessions/${encodeURIComponent(sessionId)}/diff?${parameters.toString()}`;
}

export const sessionDiffQueryOptions = (sessionId: string, scope: string, flags: SessionDiffQueryFlags = {}) =>
{
	const hideWhitespace = flags.hideWhitespace === true;
	return queryOptions(
		{
			queryKey: sessionDiffQueryKeys.diff(sessionId, scope, hideWhitespace),
			queryFn: async () => apiFetch(diffUrl(sessionId, scope, hideWhitespace), SessionDiffResponseSchema),
		},
	);
};

/** One file's full patch, for files whose patch was omitted from the list response. */
export const sessionDiffFileQueryOptions = (
	sessionId: string,
	scope: string,
	path: string,
	flags: SessionDiffQueryFlags = {},
) =>
{
	const hideWhitespace = flags.hideWhitespace === true;
	return queryOptions(
		{
			queryKey: sessionDiffQueryKeys.file(sessionId, scope, hideWhitespace, path),
			queryFn: async () =>
				apiFetch(diffUrl(sessionId, scope, hideWhitespace, path), SessionDiffFileResponseSchema),
		},
	);
};

/** Upstream `td`'s line cache lifetime: five minutes after the last diff that used it. */
const FILE_LINES_GC_TIME = 300_000;
/** Upstream `id`: how soon to recheck a side that should exist but couldn't be read. */
const MISSING_SIDE_STALE_TIME = 30_000;

export interface SessionDiffFileLinesFlags
{
	/** Upstream `ed`: identifies the patch the lines are read for, so a changed file reads them afresh. */
	contentKey: string;
	/** The file's status: an added file has no old side and a deleted one no new side. */
	status?: SessionDiffFile["status"];
	/** Upstream `bd` passes `fresh` on every retry so a cached unreadable side is read again. */
	fresh?: boolean;
}

/** Upstream `id`: keep readable sides forever, recheck a missing expected side after 30s, never trust a null. */
function fileLinesStaleTime(data: SessionDiffFileLinesResponse | null | undefined, status: SessionDiffFile["status"])
{
	if (data === null) return 0;
	if (data === undefined) return Infinity;
	const oldMissing = data.oldText === null && status !== "added";
	const newMissing = data.newText === null && status !== "deleted";
	return oldMissing || newMissing ? MISSING_SIDE_STALE_TIME : Infinity;
}

/** Both sides of one file of a git scope, which `DiffFile` hydrates a patch-only diff with (upstream `td`). */
export const sessionDiffFileLinesQueryOptions = (
	sessionId: string,
	scope: string,
	path: string,
	{contentKey, status = "modified", fresh = false}: SessionDiffFileLinesFlags,
) =>
	queryOptions(
		{
			queryKey: sessionDiffQueryKeys.lines(sessionId, scope, path, contentKey),
			queryFn: async () =>
				apiFetch(diffUrl(sessionId, scope, false, path, true), SessionDiffFileLinesResponseSchema),
			gcTime: FILE_LINES_GC_TIME,
			staleTime: fresh ? 0 : (query) => fileLinesStaleTime(query.state.data, status),
		},
	);

export const sessionDiffScopesQueryOptions = (sessionId: string) =>
	queryOptions(
		{
			queryKey: sessionDiffQueryKeys.scopes(sessionId),
			queryFn: async () =>
				apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/diff/scopes`, SessionDiffScopesResponseSchema),
		},
	);
