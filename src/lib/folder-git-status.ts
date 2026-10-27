import {stat} from "node:fs/promises";
import {isAbsolute, normalize} from "node:path";
import {type FolderGitStatus, FolderGitStatusSchema} from "./api/home-folder-status";
import {trackedExecFile} from "./perf/tracked-process";

export type FolderGitExec = typeof trackedExecFile;

const NO_STORE = {"Cache-Control": "private, max-age=0, must-revalidate"};
const GIT_TIMEOUT_MS = 5000;

/**
 * Settings that stop git from running repo-configured programs (fsmonitor hooks) in the folder, which the client
 * chooses. `GIT_OPTIONAL_LOCKS=0` keeps `git status` from rewriting the index, so every command is read-only.
 */
const SAFE_GIT_CONFIG = ["-c", "core.fsmonitor=false"];

/** Raw stdouts of the three git commands; null when that command failed. */
export interface FolderGitOutputs {
	head: string | null;
	originHead: string | null;
	porcelain: string | null;
}

export function parseFolderGitStatus({head, originHead, porcelain}: FolderGitOutputs): FolderGitStatus {
	if (head === null) return {isGitRepo: false, headBranch: null, defaultBranch: null, uncommittedFiles: 0};
	const branch = head.trim();
	const defaultBranch = originHead?.trim().replace(/^origin\//, "") ?? "";
	return {
		isGitRepo: true,
		headBranch: branch === "HEAD" || branch === "" ? null : branch,
		defaultBranch: defaultBranch === "" ? null : defaultBranch,
		uncommittedFiles: (porcelain ?? "").split("\n").filter((line) => line.trim() !== "").length,
	};
}

/** Runs git (async, never blocking the server) in `folder`, which must already be a validated directory. */
export async function readFolderGitStatus(
	folder: string,
	exec: FolderGitExec = trackedExecFile,
): Promise<FolderGitStatus> {
	const options = {cwd: folder, timeout: GIT_TIMEOUT_MS, env: {...process.env, GIT_OPTIONAL_LOCKS: "0"}};
	const run = async (args: string[]): Promise<string | null> =>
		exec("git", [...SAFE_GIT_CONFIG, ...args], options).catch(() => null);
	const head = await run(["rev-parse", "--abbrev-ref", "HEAD"]);
	if (head === null) return parseFolderGitStatus({head, originHead: null, porcelain: null});
	const [originHead, porcelain] = await Promise.all([
		run(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]),
		run(["status", "--porcelain=v1", "--untracked-files=normal"]),
	]);
	return parseFolderGitStatus({head, originHead, porcelain});
}

/** An absolute, normalized path to an existing directory; anything else (a file, `..`, a relative path) is refused. */
export async function validFolder(path: string | null): Promise<string | null> {
	if (path === null || path.includes("\0") || !isAbsolute(path) || normalize(path) !== path) return null;
	const stats = await stat(path).catch(() => null);
	return stats?.isDirectory() === true ? path : null;
}

/**
 * `GET /api/home/folder-status?path=<abs>`. Only the derived status (branch names and a file count) leaves the
 * server, never file contents, and only for an existing directory.
 */
export async function folderStatusResponse(request: Request, exec: FolderGitExec = trackedExecFile): Promise<Response> {
	const folder = await validFolder(new URL(request.url).searchParams.get("path"));
	if (folder === null) {
		return Response.json({error: "Expected ?path=<absolute directory>"}, {status: 400, headers: NO_STORE});
	}
	return Response.json(FolderGitStatusSchema.parse(await readFolderGitStatus(folder, exec)), {headers: NO_STORE});
}
