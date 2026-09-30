import {z} from "zod";
import {queryOptions} from "@tanstack/react-query";
import {apiFetch} from "./client";
import {SessionSummaryStateSchema} from "./sessions";

const FileSearchMatchSchema = z
	.object({
		lineNumber: z.number().int().positive(),
		snippet: z.string(),
	})
	.strict();

const FileSearchFileSchema = z
	.object({
		path: z.string(),
		matchCount: z.number().int().nonnegative(),
		matches: z.array(FileSearchMatchSchema),
		mtime: z.string(),
		rank: z.number(),
	})
	.strict();

export const FileSearchResponse = z
	.object({
		files: z.array(FileSearchFileSchema),
		totalResults: z.number().int().nonnegative(),
		totalFiles: z.number().int().nonnegative(),
		isTruncated: z.boolean(),
	})
	.strict();
export type FileSearchResult = z.infer<typeof FileSearchResponse>;

export const FileSearchRootsResponse = z
	.object({
		roots: z.array(z.string()),
	})
	.strict();

export const fileSearchQueryOptions = (query: string, scopeRoot: string) =>
	queryOptions({
		queryKey: ["search", "files", query, scopeRoot] as const,
		queryFn: ({signal}) => {
			const parameters = new URLSearchParams({query, scopeRoot});
			return apiFetch(`/api/search/files?${parameters.toString()}`, FileSearchResponse, {signal});
		},
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

export const UnifiedSearchTypeSchema = z.enum(["all", "sessions", "plans", "memories", "files"]);
export type UnifiedSearchType = z.infer<typeof UnifiedSearchTypeSchema>;

export const UnifiedSearchDateSchema = z.enum(["today", "week", "month"]);
export type UnifiedSearchDate = z.infer<typeof UnifiedSearchDateSchema>;

export const UnifiedSearchKindSchema = z.enum(["session", "plan", "memory", "file"]);

const UNIFIED_SEARCH_DEFAULT_LIMIT = 25;
const UNIFIED_SEARCH_MAX_LIMIT = 100;

/** Query-string parameters of `GET /api/search`. */
export const UnifiedSearchParamsSchema = z
	.object({
		query: z.string().trim().default(""),
		type: UnifiedSearchTypeSchema.default("all"),
		project: z.string().trim().min(1).optional(),
		date: UnifiedSearchDateSchema.optional(),
		limit: z.coerce.number().int().min(1).max(UNIFIED_SEARCH_MAX_LIMIT).default(UNIFIED_SEARCH_DEFAULT_LIMIT),
	})
	.strict();
export type UnifiedSearchParams = z.infer<typeof UnifiedSearchParamsSchema>;

/** A half-open `[start, end)` range of UTF-16 code units. */
const TextMatchSchema = z
	.object({
		start: z.number().int().nonnegative(),
		end: z.number().int().nonnegative(),
	})
	.strict();

const UnifiedSearchItemSchema = z
	.object({
		kind: UnifiedSearchKindSchema,
		id: z.string(),
		title: z.string(),
		titleMatches: z.array(TextMatchSchema),
		snippet: z
			.object({
				text: z.string(),
				matches: z.array(TextMatchSchema),
			})
			.strict()
			.optional(),
		/** App route for kinds that open a page by md-slug (plans and memories). */
		href: z.string().optional(),
		projectId: z.string(),
		projectName: z.string(),
		mtime: z.string(),
		state: SessionSummaryStateSchema.optional(),
	})
	.strict();
export type UnifiedSearchItem = z.infer<typeof UnifiedSearchItemSchema>;

export const UnifiedSearchResponse = z
	.object({
		items: z.array(UnifiedSearchItemSchema),
	})
	.strict();

/** `GET /api/search` params the palette and page send; `type` defaults to all and `limit` to 25. */
export type UnifiedSearchRequest = Pick<UnifiedSearchParams, "query"> &
	Partial<Pick<UnifiedSearchParams, "type" | "project" | "date" | "limit">>;

function unifiedSearchUrl({query, type, project, date, limit}: UnifiedSearchRequest): string {
	const parameters = new URLSearchParams({query});
	if (type !== undefined && type !== "all") parameters.set("type", type);
	if (project !== undefined) parameters.set("project", project);
	if (date !== undefined) parameters.set("date", date);
	if (limit !== undefined) parameters.set("limit", String(limit));
	return `/api/search?${parameters.toString()}`;
}

export const unifiedSearchQueryOptions = (request: UnifiedSearchRequest) =>
	queryOptions({
		queryKey: ["search", "unified", unifiedSearchUrl(request)] as const,
		queryFn: ({signal}) => apiFetch(unifiedSearchUrl(request), UnifiedSearchResponse, {signal}),
		staleTime: 30_000,
		gcTime: 5 * 60_000,
	});

export const fileSearchRootsQueryOptions = queryOptions({
	queryKey: ["search", "file-roots"] as const,
	queryFn: ({signal}) => apiFetch("/api/search/file-roots", FileSearchRootsResponse, {signal}),
	staleTime: 30_000,
	gcTime: 5 * 60_000,
});
