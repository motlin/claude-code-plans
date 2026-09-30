import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/** Which changes the Changes pane shows. Git scopes read the session's checkout; the rest read its JSONL. */
export type SessionDiffScope =
	| {kind: "branch"}
	| {kind: "uncommitted"}
	| {kind: "commit"; sha: string}
	| {kind: "session"}
	| {kind: "turn"; uuid: string};

const COMMIT_SHA_PATTERN = /^[0-9a-f]{4,64}$/i;

/** Parse the `scope` query value; returns null for anything malformed. */
export function parseDiffScope(value: string): SessionDiffScope | null {
	if (value === "branch" || value === "uncommitted" || value === "session") return {kind: value};
	if (value.startsWith("commit:")) {
		const sha = value.slice("commit:".length);
		return COMMIT_SHA_PATTERN.test(sha) ? {kind: "commit", sha} : null;
	}
	if (value.startsWith("turn:")) {
		const uuid = value.slice("turn:".length);
		return uuid === "" ? null : {kind: "turn", uuid};
	}
	return null;
}

export function formatDiffScope(scope: SessionDiffScope): string {
	switch (scope.kind) {
		case "commit":
			return `commit:${scope.sha}`;
		case "turn":
			return `turn:${scope.uuid}`;
		default:
			return scope.kind;
	}
}

const SessionDiffFileSchema = z
	.object({
		path: z.string(),
		oldPath: z.string().optional(),
		status: z.enum(["added", "deleted", "modified", "renamed"]),
		additions: z.number().int().nonnegative(),
		deletions: z.number().int().nonnegative(),
		binary: z.boolean(),
		patchLineCount: z.number().int().nonnegative(),
		/** Null when the patch is too large to inline; fetch it with `&file=<path>`. */
		patch: z.string().nullable(),
	})
	.strict();

export type SessionDiffFile = z.infer<typeof SessionDiffFileSchema>;

export const SessionDiffResponseSchema = z
	.object({
		/** The scope actually served; `session` when a git scope fell back because the repo is gone. */
		scope: z.string(),
		source: z.enum(["git", "session-edits"]),
		stats: z
			.object({
				files: z.number().int().nonnegative(),
				additions: z.number().int().nonnegative(),
				deletions: z.number().int().nonnegative(),
			})
			.strict(),
		files: z.array(SessionDiffFileSchema),
	})
	.strict();

export type SessionDiffResponse = z.infer<typeof SessionDiffResponseSchema>;

export const SessionDiffFileResponseSchema = z.object({scope: z.string(), file: SessionDiffFileSchema}).strict();

const SessionDiffCommitSchema = z
	.object({
		sha: z.string(),
		shortSha: z.string(),
		subject: z.string(),
		author: z.string(),
		date: z.string(),
	})
	.strict();

export const SessionDiffScopesResponseSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("git"),
			base: z.string(),
			baseRef: z.string(),
			mergeBase: z.string(),
			head: z.string().nullable(),
			uncommittedAvailable: z.boolean(),
			commits: z.array(SessionDiffCommitSchema),
			totalCommits: z.number().int().nonnegative(),
		})
		.strict(),
	z.object({kind: z.literal("no-git")}).strict(),
]);

export type SessionDiffScopesResponse = z.infer<typeof SessionDiffScopesResponseSchema>;

export const SessionDiffErrorResponseSchema = z.object({error: z.string()}).strict();

export interface SessionDiffQueryFlags {
	hideWhitespace?: boolean;
}

const sessionDiffQueryKeys = {
	diff: (sessionId: string, scope: string, hideWhitespace: boolean) =>
		["sessions", sessionId, "diff", scope, hideWhitespace] as const,
	file: (sessionId: string, scope: string, hideWhitespace: boolean, path: string) =>
		["sessions", sessionId, "diff", scope, hideWhitespace, "file", path] as const,
	scopes: (sessionId: string) => ["sessions", sessionId, "diff", "scopes"] as const,
};

function diffUrl(sessionId: string, scope: string, hideWhitespace: boolean, file?: string): string {
	const parameters = new URLSearchParams({scope, ws: hideWhitespace ? "1" : "0"});
	if (file !== undefined) parameters.set("file", file);
	return `/api/sessions/${encodeURIComponent(sessionId)}/diff?${parameters.toString()}`;
}

export const sessionDiffQueryOptions = (sessionId: string, scope: string, flags: SessionDiffQueryFlags = {}) => {
	const hideWhitespace = flags.hideWhitespace === true;
	return queryOptions({
		queryKey: sessionDiffQueryKeys.diff(sessionId, scope, hideWhitespace),
		queryFn: () => apiFetch(diffUrl(sessionId, scope, hideWhitespace), SessionDiffResponseSchema),
	});
};

/** One file's full patch, for files whose patch was omitted from the list response. */
export const sessionDiffFileQueryOptions = (
	sessionId: string,
	scope: string,
	path: string,
	flags: SessionDiffQueryFlags = {},
) => {
	const hideWhitespace = flags.hideWhitespace === true;
	return queryOptions({
		queryKey: sessionDiffQueryKeys.file(sessionId, scope, hideWhitespace, path),
		queryFn: () => apiFetch(diffUrl(sessionId, scope, hideWhitespace, path), SessionDiffFileResponseSchema),
	});
};

export const sessionDiffScopesQueryOptions = (sessionId: string) =>
	queryOptions({
		queryKey: sessionDiffQueryKeys.scopes(sessionId),
		queryFn: () =>
			apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/diff/scopes`, SessionDiffScopesResponseSchema),
	});
