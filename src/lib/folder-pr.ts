import {z} from "zod";

import {type FolderPr, FolderPrSchema} from "./api/home-folder-pr";
import {validFolder} from "./folder-git-status";
import {errnoCode} from "./narrow";
import {ghFolderPrDetailsLookup, githubPrUrlParts, parseGhFolderPrDetails} from "./pr-details";
import {type GhRunner, runGhCommand} from "./pr-status-service";

const NO_STORE = {"Cache-Control": "private, max-age=0, must-revalidate"};
const MINUTE = 60 * 1000;
const MAX_BACKOFF_MS = 60 * MINUTE;

const GhFolderPrRowSchema = z.strictObject({
	number: z.number().int().positive(),
	title: z.string(),
	url: z.string(),
	isDraft: z.boolean(),
	headRefOid: z.string(),
});

/** The chosen PR of a `gh pr list` reply. */
export interface FolderPrPick {
	repo: string;
	number: number;
	title: string;
	url: string;
	headRefOid: string;
}

/**
 * Upstream `bce`: among the branch's open PRs (drafts count) with a GitHub pull url, the highest-numbered one. Throws
 * on anything off-schema.
 */
export function pickFolderPr(stdout: string): FolderPrPick | null {
	let best: FolderPrPick | null = null;
	for (const row of z.array(GhFolderPrRowSchema).parse(JSON.parse(stdout))) {
		const parts = githubPrUrlParts(row.url);
		if (parts === null || (best !== null && best.number >= row.number)) continue;
		best = {
			repo: `${parts.owner}/${parts.repo}`,
			number: row.number,
			title: row.title,
			url: row.url,
			headRefOid: row.headRefOid,
		};
	}
	return best;
}

export interface FolderPrLookup {
	lookup(folder: string, branch: string): Promise<FolderPr>;
}

/**
 * Looks up a folder branch's open PR with `gh`, one command at a time (like `pr-status-service`), backing off
 * exponentially per folder after a failure and giving up for good when `gh` is not installed.
 */
export function createFolderPrLookup({runGh, now = Date.now}: {runGh: GhRunner; now?: () => number}): FolderPrLookup {
	let queue: Promise<unknown> = Promise.resolve();
	let ghMissing = false;
	const backoff = new Map<string, {failures: number; retryAt: number}>();

	async function fetchPr(folder: string, branch: string): Promise<FolderPr> {
		const listed = await runGh(
			[
				"pr",
				"list",
				"--head",
				branch,
				"--state",
				"open",
				"--json",
				"number,title,url,isDraft,headRefOid",
				"--limit",
				"20",
			],
			folder,
		);
		const pick = pickFolderPr(listed);
		if (pick === null) return {status: "none"};
		const request = ghFolderPrDetailsLookup(pick.url);
		if (request === null) return {status: "off"};
		const details = parseGhFolderPrDetails(await runGh(request.args, undefined));
		const [failingCheckName] = details.failingChecks;
		return {
			status: "found",
			pr: {
				repo: pick.repo,
				number: pick.number,
				title: pick.title,
				branch,
				failing: failingCheckName !== undefined,
				...(failingCheckName === undefined ? {} : {failingCheckName}),
				failureStamp: [details.headSha ?? pick.headRefOid, ...details.failingChecks.toSorted()].join("\n"),
				unansweredReviewComments: details.unresolvedReviewThreads,
				newestReviewCommentId: details.newestReviewCommentId,
			},
		};
	}

	async function lookup(folder: string, branch: string): Promise<FolderPr> {
		const gate = backoff.get(folder);
		if (ghMissing || (gate !== undefined && now() < gate.retryAt)) return {status: "off"};
		const result = queue.then(async (): Promise<FolderPr> => {
			try {
				const pr = await fetchPr(folder, branch);
				backoff.delete(folder);
				return pr;
			} catch (error) {
				if (errnoCode(error) === "ENOENT") ghMissing = true;
				const failures = (backoff.get(folder)?.failures ?? 0) + 1;
				backoff.set(folder, {
					failures,
					retryAt: now() + Math.min(MINUTE * 2 ** (failures - 1), MAX_BACKOFF_MS),
				});
				return {status: "off"};
			}
		});
		queue = result;
		return result;
	}

	return {lookup};
}

/** A branch name safe to pass as `--head`: no option-like leading dash, whitespace or control characters. */
function validBranch(branch: string | null): string | null {
	if (branch === null || branch === "" || branch.length > 255 || branch.startsWith("-")) return null;
	// eslint-disable-next-line no-control-regex -- refusing control characters is the point
	return /[\s\u0000-\u001f\u007f]/.test(branch) ? null : branch;
}

let defaultLookup: FolderPrLookup | null = null;

/**
 * `GET /api/home/folder-pr?path=<abs>&branch=<name>`. Read-only `gh pr list` + `gh api graphql` for an existing
 * directory only; every gh failure answers `{status:"off"}`.
 */
export async function folderPrResponse(request: Request, lookup?: FolderPrLookup): Promise<Response> {
	const params = new URL(request.url).searchParams;
	const branch = validBranch(params.get("branch"));
	const folder = branch === null ? null : await validFolder(params.get("path"));
	if (folder === null || branch === null) {
		return Response.json(
			{error: "Expected ?path=<absolute directory>&branch=<name>"},
			{status: 400, headers: NO_STORE},
		);
	}
	defaultLookup ??= createFolderPrLookup({runGh: runGhCommand});
	const pr = await (lookup ?? defaultLookup).lookup(folder, branch);
	return Response.json(FolderPrSchema.parse(pr), {headers: NO_STORE});
}
