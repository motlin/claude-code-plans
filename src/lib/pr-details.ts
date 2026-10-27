import {z} from "zod";

/**
 * Server-only: the `gh api graphql` PR review details fetch (head branch, failing check names,
 * unresolved review threads), kept out of `pr-status.ts` so client bundles never carry it.
 */

/** The review fields only `gh api graphql` knows, merged over a PR status. */
export interface PrDetails {
	headBranch: string;
	failingChecks: string[];
	unresolvedReviewThreads: number;
}

/** GraphQL `CheckConclusionState`: a finished check run's outcome. */
export const GhCheckRunConclusionSchema = z.enum([
	"ACTION_REQUIRED",
	"CANCELLED",
	"FAILURE",
	"NEUTRAL",
	"SKIPPED",
	"STALE",
	"STARTUP_FAILURE",
	"SUCCESS",
	"TIMED_OUT",
]);

/** GraphQL `StatusState`: a commit status context's state. */
export const GhStatusContextStateSchema = z.enum(["ERROR", "EXPECTED", "FAILURE", "PENDING", "SUCCESS"]);

/** The conclusions `gh pr checks` reports as failing. */
const FAILING_CONCLUSIONS = {
	ACTION_REQUIRED: true,
	CANCELLED: true,
	FAILURE: true,
	NEUTRAL: false,
	SKIPPED: false,
	STALE: false,
	STARTUP_FAILURE: true,
	SUCCESS: false,
	TIMED_OUT: true,
} as const satisfies Record<z.infer<typeof GhCheckRunConclusionSchema>, boolean>;

const FAILING_STATES = {
	ERROR: true,
	EXPECTED: false,
	FAILURE: true,
	PENDING: false,
	SUCCESS: false,
} as const satisfies Record<z.infer<typeof GhStatusContextStateSchema>, boolean>;

const GhCheckContextSchema = z.discriminatedUnion("__typename", [
	z
		.object({
			__typename: z.literal("CheckRun"),
			name: z.string(),
			conclusion: GhCheckRunConclusionSchema.nullable(),
		})
		.strict(),
	z.object({__typename: z.literal("StatusContext"), context: z.string(), state: GhStatusContextStateSchema}).strict(),
]);

const GhPrDetailsReplySchema = z
	.object({
		data: z
			.object({
				repository: z
					.object({
						pullRequest: z
							.object({
								headRefName: z.string(),
								reviewThreads: z
									.object({nodes: z.array(z.object({isResolved: z.boolean()}).strict())})
									.strict(),
								commits: z
									.object({
										nodes: z.array(
											z
												.object({
													commit: z
														.object({
															statusCheckRollup: z
																.object({
																	contexts: z
																		.object({nodes: z.array(GhCheckContextSchema)})
																		.strict(),
																})
																.strict()
																.nullable(),
														})
														.strict(),
												})
												.strict(),
										),
									})
									.strict(),
							})
							.strict(),
					})
					.strict(),
			})
			.strict(),
	})
	.strict();

const GH_PR_DETAILS_QUERY = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){headRefName reviewThreads(first:100){nodes{isResolved}} commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name conclusion} ... on StatusContext{context state}}}}}}}}}}`;

/** The failing check names of a status rollup, in rollup order. */
function failingCheckNames(contexts: readonly z.infer<typeof GhCheckContextSchema>[]): string[] {
	return contexts.flatMap((context) => {
		if (context.__typename === "CheckRun") {
			return context.conclusion !== null && FAILING_CONCLUSIONS[context.conclusion] ? [context.name] : [];
		}
		return FAILING_STATES[context.state] ? [context.context] : [];
	});
}

/** Parse the `gh api graphql` details reply; throws on anything off-schema. */
export function parseGhPrDetails(stdout: string): PrDetails {
	const pr = GhPrDetailsReplySchema.parse(JSON.parse(stdout)).data.repository.pullRequest;
	const contexts = pr.commits.nodes.flatMap((node) => node.commit.statusCheckRollup?.contexts.nodes ?? []);
	return {
		headBranch: pr.headRefName,
		failingChecks: failingCheckNames(contexts),
		unresolvedReviewThreads: pr.reviewThreads.nodes.filter((thread) => !thread.isResolved).length,
	};
}

/** The home folder PR's details: the stamps upstream's start-card rows need (head sha, newest review comment id). */
export interface FolderPrDetails {
	/** The last commit's oid, null when the PR has no commits. */
	headSha: string | null;
	failingChecks: string[];
	unresolvedReviewThreads: number;
	/** The largest review comment `databaseId`, 0 without comments. */
	newestReviewCommentId: number;
}

const GhFolderPrDetailsReplySchema = z
	.object({
		data: z
			.object({
				repository: z
					.object({
						pullRequest: z
							.object({
								reviewThreads: z
									.object({
										nodes: z.array(
											z
												.object({
													isResolved: z.boolean(),
													comments: z
														.object({
															nodes: z.array(
																z
																	.object({databaseId: z.number().int().nullable()})
																	.strict(),
															),
														})
														.strict(),
												})
												.strict(),
										),
									})
									.strict(),
								commits: z
									.object({
										nodes: z.array(
											z
												.object({
													commit: z
														.object({
															oid: z.string(),
															statusCheckRollup: z
																.object({
																	contexts: z
																		.object({nodes: z.array(GhCheckContextSchema)})
																		.strict(),
																})
																.strict()
																.nullable(),
														})
														.strict(),
												})
												.strict(),
										),
									})
									.strict(),
							})
							.strict(),
					})
					.strict(),
			})
			.strict(),
	})
	.strict();

const GH_FOLDER_PR_DETAILS_QUERY = `query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved comments(last:1){nodes{databaseId}}}} commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100){nodes{__typename ... on CheckRun{name conclusion} ... on StatusContext{context state}}}}}}}}}}`;

/** Parse the folder PR `gh api graphql` reply; throws on anything off-schema. */
export function parseGhFolderPrDetails(stdout: string): FolderPrDetails {
	const pr = GhFolderPrDetailsReplySchema.parse(JSON.parse(stdout)).data.repository.pullRequest;
	const commit = pr.commits.nodes.at(-1)?.commit;
	const commentIds = pr.reviewThreads.nodes.flatMap((thread) =>
		thread.comments.nodes.flatMap((comment) => (comment.databaseId === null ? [] : [comment.databaseId])),
	);
	return {
		headSha: commit?.oid ?? null,
		failingChecks: failingCheckNames(commit?.statusCheckRollup?.contexts.nodes ?? []),
		unresolvedReviewThreads: pr.reviewThreads.nodes.filter((thread) => !thread.isResolved).length,
		newestReviewCommentId: Math.max(0, ...commentIds),
	};
}

/** A github.com pull url's owner, repo and number, or null for any other url. */
export function githubPrUrlParts(url: string): {owner: string; repo: string; number: number} | null {
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
	if (match === null) return null;
	const [, owner = "", repo = "", number = ""] = match;
	return {owner, repo, number: Number(number)};
}

/** The `gh api graphql` argv fetching the folder PR's details (with stamps), or null for a non-GitHub url. */
export function ghFolderPrDetailsLookup(url: string): {key: string; args: string[]} | null {
	return ghPrDetailsLookup(url, GH_FOLDER_PR_DETAILS_QUERY);
}

/** The `gh api graphql` argv fetching a GitHub PR's review details, or null for a non-GitHub url. */
export function ghPrDetailsLookup(url: string, query = GH_PR_DETAILS_QUERY): {key: string; args: string[]} | null {
	const parts = githubPrUrlParts(url);
	if (parts === null) return null;
	const {owner, repo, number} = parts;
	return {
		key: `details:${url}`,
		args: [
			"api",
			"graphql",
			"-f",
			`owner=${owner}`,
			"-f",
			`repo=${repo}`,
			"-F",
			`number=${number}`,
			"-f",
			`query=${query}`,
		],
	};
}
