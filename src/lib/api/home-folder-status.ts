import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {apiFetch} from "./client";

/** The home launch folder's working tree (upstream `dt.getWorkingTreeStatus`), for the folder-scoped Next steps rows. */
export const FolderGitStatusSchema = z.strictObject({
	/** False for an absolute folder that no longer exists (the home bar's blocking line); every other field is empty then. */
	exists: z.boolean(),
	isGitRepo: z.boolean(),
	/** null on a detached HEAD or outside a repo. */
	headBranch: z.string().nullable(),
	/** `origin/HEAD`'s branch, null when unset. */
	defaultBranch: z.string().nullable(),
	uncommittedFiles: z.number().int().nonnegative(),
});
export type FolderGitStatus = z.infer<typeof FolderGitStatusSchema>;

/** Upstream `["epitaxy","turn0","working-tree",folder]`, staleTime 30000. */
export function homeFolderStatusQueryOptions(path: string | undefined) {
	return queryOptions({
		queryKey: ["home", "folder-status", path] as const,
		queryFn: async () =>
			apiFetch(
				`/api/home/folder-status?${new URLSearchParams({path: path ?? ""}).toString()}`,
				FolderGitStatusSchema,
			),
		staleTime: 30_000,
		enabled: path !== undefined,
	});
}
