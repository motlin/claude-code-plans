import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/**
 * The home launch folder branch's open PR (upstream `yce` + `bce` + `xce` + `wce`), for the folder-scoped Next steps
 * PR rows. `off` covers every gh failure, so the rows stay silent.
 */
export const FolderPrSchema = z.strictObject({
	status: z.enum(["found", "none", "off"]),
	pr: z
		.strictObject({
			/** `owner/name`. */
			repo: z.string(),
			number: z.number().int().positive(),
			title: z.string(),
			branch: z.string(),
			failing: z.boolean(),
			/** The first failing check in rollup order. */
			failingCheckName: z.string().optional(),
			/** `[headSha, ...sortedFailingNames].join("\n")`: changes on a push or a new set of failures. */
			failureStamp: z.string(),
			unansweredReviewComments: z.number().int().nonnegative(),
			newestReviewCommentId: z.number().int().nonnegative(),
		})
		.optional(),
});
export type FolderPr = z.infer<typeof FolderPrSchema>;

/** Upstream's review-thread query staleTime, 120000. */
export function homeFolderPrQueryOptions(path: string | undefined, branch: string | null) {
	return queryOptions({
		queryKey: ["home", "folder-pr", path, branch] as const,
		queryFn: async () =>
			apiFetch(
				`/api/home/folder-pr?${new URLSearchParams({path: path ?? "", branch: branch ?? ""}).toString()}`,
				FolderPrSchema,
			),
		staleTime: 120_000,
		enabled: path !== undefined && branch !== null,
	});
}
