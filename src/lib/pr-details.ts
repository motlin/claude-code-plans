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

/** Parse the `gh api graphql` details reply; throws on anything off-schema. */
export function parseGhPrDetails(stdout: string): PrDetails {
	const pr = GhPrDetailsReplySchema.parse(JSON.parse(stdout)).data.repository.pullRequest;
	const contexts = pr.commits.nodes.flatMap((node) => node.commit.statusCheckRollup?.contexts.nodes ?? []);
	return {
		headBranch: pr.headRefName,
		failingChecks: contexts.flatMap((context) => {
			if (context.__typename === "CheckRun") {
				return context.conclusion !== null && FAILING_CONCLUSIONS[context.conclusion] ? [context.name] : [];
			}
			return FAILING_STATES[context.state] ? [context.context] : [];
		}),
		unresolvedReviewThreads: pr.reviewThreads.nodes.filter((thread) => !thread.isResolved).length,
	};
}

/** The `gh api graphql` argv fetching a GitHub PR's review details, or null for a non-GitHub url. */
export function ghPrDetailsLookup(url: string): {key: string; args: string[]} | null {
	const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/.exec(url);
	if (match === null) return null;
	const [, owner, repo, number] = match;
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
			`query=${GH_PR_DETAILS_QUERY}`,
		],
	};
}
