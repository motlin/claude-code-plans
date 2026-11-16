import {useSyncExternalStore} from "react";
import {z} from "zod";

import {resolveFuzzyDiffPath} from "./diff-scroll-target";
import
{
	REVIEW_LEVELS,
	type ParsedReportFindings,
	type ReportedFindingVerdict,
	type ReviewFindingStatus,
	type ReviewLevel,
} from "./report-findings";
import {setCurrentReviewFinding} from "./review-finding-cursor";

/*
 * claude.ai/code's `diff-annotations` store (cc8941b7b), for the findings a transcript "Code review" card seeds into
 * the Changes pane. Upstream's `rt` partialize persists only the findings, their statuses and the review level, so
 * the seeded tool ids, the latest settled review at activation and the resolved scopes live in memory: a fresh load
 * never auto-opens. The current finding is `review-finding-cursor`'s, shared with the working-copy review.
 */

export const REVIEW_FINDINGS_STORAGE_KEY = "ccb.reviewFindings.v1";

/** Upstream's seeded annotation (`F[i]` in c3fef5c6f `iC`). */
export interface StoreFinding
{
	id: string;
	filePath: string;
	side: "additions";
	startLine: number;
	endLine: number;
	line: number | undefined;
	body: string;
	detail: string | undefined;
	source: "finding";
	category: string | undefined;
	verdict: ReportedFindingVerdict | undefined;
	createdAt: number;
}

export interface ReviewFindingsState
{
	findingsBySession: Readonly<Record<string, readonly StoreFinding[]>>;
	findingStatusBySession: Readonly<Record<string, Readonly<Record<string, ReviewFindingStatus>>>>;
	reviewLevelBySession: Readonly<Record<string, ReviewLevel>>;
	seededToolIdsBySession: Readonly<Record<string, readonly string[]>>;
	latestSettledAtActivationBySession: Readonly<Record<string, string>>;
	/** Per session and diff scope: finding id -> the diff path it resolved to. */
	resolvedScopesBySession: Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, string>>>>>>;
}

const StatusSchema = z.enum(["open", "fixing", "addressed", "unchanged", "dismissed"]);

const StoreFindingSchema = z.object(
	{
		id: z.string(),
		filePath: z.string(),
		side: z.literal("additions"),
		startLine: z.number(),
		endLine: z.number(),
		line: z.number().optional(),
		body: z.string(),
		detail: z.string().optional(),
		source: z.literal("finding"),
		category: z.string().optional(),
		verdict: z.enum(["CONFIRMED", "PLAUSIBLE"]).optional(),
		createdAt: z.number(),
	},
);

const PersistedSchema = z.object(
	{
		findingsBySession: z.record(z.string(), z.array(StoreFindingSchema)),
		findingStatusBySession: z.record(z.string(), z.record(z.string(), StatusSchema)),
		reviewLevelBySession: z.record(z.string(), z.enum(REVIEW_LEVELS)),
	},
);

const EMPTY: ReviewFindingsState =
{
	findingsBySession: {},
	findingStatusBySession: {},
	reviewLevelBySession: {},
	seededToolIdsBySession: {},
	latestSettledAtActivationBySession: {},
	resolvedScopesBySession: {},
};

function browserStorage(): Storage | null
{
	if (typeof window === "undefined") return null;
	try
	{
		return window.localStorage;
	}
	catch
	{
		return null;
	}
}

function storeFinding(finding: z.infer<typeof StoreFindingSchema>): StoreFinding
{
	return {
		...finding,
		line: finding.line,
		detail: finding.detail,
		category: finding.category,
		verdict: finding.verdict,
	};
}

function load(): ReviewFindingsState
{
	const storage = browserStorage();
	if (storage === null) return EMPTY;
	try
	{
		const raw = storage.getItem(REVIEW_FINDINGS_STORAGE_KEY);
		if (raw === null) return EMPTY;
		const parsed = PersistedSchema.safeParse(JSON.parse(raw));
		if (!parsed.success) return EMPTY;
		return {
			...EMPTY,
			findingsBySession: Object.fromEntries(
				Object.entries(parsed.data.findingsBySession).map(([session, list]) => [
					session,
					list.map(storeFinding),
				]),
			),
			findingStatusBySession: parsed.data.findingStatusBySession,
			reviewLevelBySession: parsed.data.reviewLevelBySession,
		};
	}
	catch
	{
		return EMPTY;
	}
}

function save(next: ReviewFindingsState): void
{
	const storage = browserStorage();
	if (storage === null) return;
	try
	{
		storage.setItem(
			REVIEW_FINDINGS_STORAGE_KEY,
			JSON.stringify(
				{
					findingsBySession: next.findingsBySession,
					findingStatusBySession: next.findingStatusBySession,
					reviewLevelBySession: next.reviewLevelBySession,
				},
			),
		);
	}
	catch
	{
		// localStorage can be denied even when window exists; this is best-effort.
	}
}

let state: ReviewFindingsState | null = null;
const listeners = new Set<() => void>();

export function reviewFindingsSnapshot(): ReviewFindingsState
{
	state ??= load();
	return state;
}

function update(change: (previous: ReviewFindingsState) => ReviewFindingsState): void
{
	const previous = reviewFindingsSnapshot();
	const next = change(previous);
	if (next === previous) return;
	state = next;
	save(next);
	for (const listener of listeners) listener();
}

/** Re-read localStorage, dropping the in-memory state (a fresh page load). */
export function reloadReviewFindingsStore(): void
{
	state = load();
	for (const listener of listeners) listener();
}

function subscribeReviewFindings(listener: () => void): () => void
{
	listeners.add(listener);
	return () =>
	{
		listeners.delete(listener);
	};
}

function without<T>(record: Readonly<Record<string, T>>, key: string): Record<string, T>
{
	const {[key]: _dropped, ...rest} = record;
	return rest;
}

/** Upstream `iC`'s `F`: a call's parsed findings as store findings with ids `finding-{toolId}-{index}`. */
export function toStoreFindings(toolId: string, parsed: ParsedReportFindings, createdAt: number): StoreFinding[]
{
	return parsed.findings.map((finding, index) => (
	{
		id: `finding-${toolId}-${index}`,
		filePath: finding.file,
		side: "additions",
		startLine: finding.line ?? 1,
		endLine: finding.line ?? 1,
		line: finding.line,
		body: finding.summary,
		detail: finding.failure_scenario,
		source: "finding",
		category: finding.category,
		verdict: finding.verdict,
		createdAt,
	}));
}

export interface SeedOptions
{
	level?: ReviewLevel | undefined;
	toolId?: string | undefined;
	latestSettledToolId?: string | undefined;
}

/**
 * Upstream `setReviewFindings`: the session's findings become `list` minus dismissed ones, the tool joins the seeded
 * ids once, the latest settled review is recorded, resolved scopes reset and the first finding becomes current.
 */
export function setReviewFindings(sessionId: string, list: readonly StoreFinding[], options?: SeedOptions): void
{
	let first: string | null = null;
	update((previous) =>
	{
		const statuses = previous.findingStatusBySession[sessionId] ?? {};
		const findings = list.filter((finding) => statuses[finding.id] !== "dismissed");
		first = findings[0]?.id ?? null;
		const seeded = previous.seededToolIdsBySession[sessionId] ?? [];
		const {level, toolId, latestSettledToolId} = options ?? {};
		return {
			...previous,
			findingsBySession:
			{
				...previous.findingsBySession,
				[sessionId]: findings,
			},
			reviewLevelBySession:
				level === undefined
					? options === undefined
						? previous.reviewLevelBySession
						: without(previous.reviewLevelBySession, sessionId)
					:
						{
							...previous.reviewLevelBySession,
							[sessionId]: level,
						},
			seededToolIdsBySession:
				toolId === undefined || seeded.includes(toolId)
					? previous.seededToolIdsBySession
					:
						{
							...previous.seededToolIdsBySession,
							[sessionId]: [...seeded, toolId],
						},
			latestSettledAtActivationBySession:
				latestSettledToolId === undefined
					? previous.latestSettledAtActivationBySession
					:
						{
							...previous.latestSettledAtActivationBySession,
							[sessionId]: latestSettledToolId,
						},
			resolvedScopesBySession: without(previous.resolvedScopesBySession, sessionId),
		};
	});
	setCurrentReviewFinding(sessionId, first);
}

/** Upstream `consumeAutoOpen`: record the latest settled review without opening the pane. */
export function consumeAutoOpen(sessionId: string, toolId: string): void
{
	update((previous) => (
	{
		...previous,
		latestSettledAtActivationBySession:
		{
			...previous.latestSettledAtActivationBySession,
			[sessionId]: toolId,
		},
	}));
}

function setStatuses(sessionId: string, ids: readonly string[], status: ReviewFindingStatus): void
{
	if (ids.length === 0) return;
	update((previous) => (
	{
		...previous,
		findingStatusBySession:
		{
			...previous.findingStatusBySession,
			[sessionId]:
			{
				...previous.findingStatusBySession[sessionId],
				...Object.fromEntries(ids.map((id) => [id, status])),
			},
		},
	}));
}

/** Upstream `markReviewFindingsFixing`. */
export function markReviewFindingsFixing(sessionId: string, ids: readonly string[]): void
{
	setStatuses(sessionId, ids, "fixing");
}

/** Upstream `reopenReviewFindings`: a failed Apply puts its findings back to open. */
export function reopenReviewFindings(sessionId: string, ids: readonly string[]): void
{
	setStatuses(sessionId, ids, "open");
}

/** Upstream `dismissReviewFinding`'s status change. */
export function dismissReviewFinding(sessionId: string, id: string): void
{
	setStatuses(sessionId, [id], "dismissed");
}

/** Upstream `clearReviewFindings(session, keepStatuses)`: the session shows no transcript findings. */
export function clearReviewFindings(sessionId: string, keepStatuses: boolean): void
{
	update((previous) =>
	{
		const has =
			sessionId in previous.findingsBySession ||
			sessionId in previous.reviewLevelBySession ||
			(!keepStatuses && sessionId in previous.findingStatusBySession);
		if (!has) return previous;
		return {
			...previous,
			findingsBySession: without(previous.findingsBySession, sessionId),
			reviewLevelBySession: without(previous.reviewLevelBySession, sessionId),
			findingStatusBySession: keepStatuses
				? previous.findingStatusBySession
				: without(previous.findingStatusBySession, sessionId),
			resolvedScopesBySession: without(previous.resolvedScopesBySession, sessionId),
		};
	});
	setCurrentReviewFinding(sessionId, null);
}

/**
 * Upstream `resolveReviewFindingPaths`: map each finding to the scope's diff path, by exact path or the one path
 * ending with it. Findings with no single match stay unmapped for that scope.
 */
export function resolveReviewFindingPaths(sessionId: string, scope: string, paths: readonly string[]): void
{
	update((previous) =>
	{
		const findings = previous.findingsBySession[sessionId];
		if (findings === undefined || findings.length === 0) return previous;
		const mapped: Record<string, string> = {};
		for (const finding of findings)
		{
			const path = resolveFuzzyDiffPath(finding.filePath, paths);
			if (path !== null) mapped[finding.id] = path;
		}
		const scopes = previous.resolvedScopesBySession[sessionId] ?? {};
		const before = scopes[scope];
		if (before !== undefined && JSON.stringify(before) === JSON.stringify(mapped)) return previous;
		return {
			...previous,
			resolvedScopesBySession:
			{
				...previous.resolvedScopesBySession,
				[sessionId]:
				{
					...scopes,
					[scope]: mapped,
				},
			},
		};
	});
}

/** Upstream `Kt`: null until a scope has resolved, then the seeded findings no resolved scope maps. */
export function unanchoredFindingIds(sessionId: string): ReadonlySet<string> | null
{
	const snapshot = reviewFindingsSnapshot();
	const scopes = snapshot.resolvedScopesBySession[sessionId];
	if (scopes === undefined || Object.keys(scopes).length === 0) return null;
	const mapped = new Set(Object.values(scopes).flatMap((byId) => Object.keys(byId)));
	return new Set(
		(snapshot.findingsBySession[sessionId] ?? []).map((finding) => finding.id).filter((id) => !mapped.has(id)),
	);
}

export function useReviewFindingsState(): ReviewFindingsState
{
	return useSyncExternalStore(subscribeReviewFindings, reviewFindingsSnapshot, () => EMPTY);
}
