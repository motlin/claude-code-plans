import {z} from "zod";
import {rejectCrossSite} from "./same-origin-guard";

const OpenInFinderRequestSchema = z.object({sessionId: z.string().min(1)}).strict();

export interface OpenInFinderDependencies {
	rejectRequest: (request: Request) => Response | null;
	/** The indexed session's own directory, or null for an unknown session. */
	resolveSessionCwd: (sessionId: string) => Promise<string | null>;
	isDirectory: (path: string) => Promise<boolean>;
	openPath: (path: string) => Promise<void>;
}

const defaultDependencies: OpenInFinderDependencies = {
	rejectRequest: rejectCrossSite,
	resolveSessionCwd: async (sessionId) => {
		const {getDb} = await import("./db");
		const {getSessionDirectory} = await import("./db/queries");
		return getSessionDirectory(getDb().index, sessionId);
	},
	isDirectory: async (path) => {
		const {stat} = await import("node:fs/promises");
		try {
			return (await stat(path)).isDirectory();
		} catch {
			return false;
		}
	},
	openPath: async (path) => {
		const {execFile} = await import("node:child_process");
		const {promisify} = await import("node:util");
		await promisify(execFile)("open", [path]);
	},
};

/**
 * Reveal a session's directory in Finder. The client names only the session;
 * the path always comes from the index, so no caller-chosen path is opened.
 */
export async function handleOpenInFinder(
	request: Request,
	dependencies: OpenInFinderDependencies = defaultDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	const parsed = OpenInFinderRequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({error: z.prettifyError(parsed.error)}, {status: 400});
	}

	const cwd = await dependencies.resolveSessionCwd(parsed.data.sessionId);
	if (cwd === null) return Response.json({error: "Unknown session"}, {status: 404});
	if (!(await dependencies.isDirectory(cwd))) {
		return Response.json({error: "Session directory not found"}, {status: 404});
	}

	await dependencies.openPath(cwd);
	return Response.json({ok: true});
}

const RevealInFinderRequestSchema = z.object({path: z.string().min(1)}).strict();

export interface RevealInFinderDependencies {
	rejectRequest: (request: Request) => Response | null;
	/** The roots the file viewer may read; nothing outside them is revealed. */
	resolveRoots: () => Promise<readonly string[]>;
	/** The app config, whose `file_roots` override `resolveRoots`; defaults to the real one. */
	configPath?: string;
	revealPath: (path: string) => Promise<void>;
}

const defaultRevealDependencies: RevealInFinderDependencies = {
	rejectRequest: rejectCrossSite,
	resolveRoots: async () => {
		const {resolveFileSearchRoots} = await import("./config");
		const {getDb} = await import("./db");
		return resolveFileSearchRoots(getDb().index);
	},
	revealPath: async (path) => {
		const {execFile} = await import("node:child_process");
		const {promisify} = await import("node:util");
		await promisify(execFile)("open", ["-R", path]);
	},
};

/**
 * Reveal one file or folder in Finder (`open -R`) for Show in Finder. The
 * path must resolve, symlinks included, to an existing entry under the same
 * roots the file viewer is allowed to read.
 */
export async function handleRevealInFinder(
	request: Request,
	dependencies: RevealInFinderDependencies = defaultRevealDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	const parsed = RevealInFinderRequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({error: z.prettifyError(parsed.error)}, {status: 400});
	}

	const {FileServingError, resolveAllowedEntry} = await import("./file-serving");
	let resolvedPath: string;
	try {
		const roots = await dependencies.resolveRoots();
		resolvedPath = await resolveAllowedEntry(parsed.data.path, dependencies.configPath, roots);
	} catch (error) {
		if (error instanceof FileServingError) {
			return Response.json({error: error.message}, {status: error.status});
		}
		throw error;
	}

	await dependencies.revealPath(resolvedPath);
	return Response.json({ok: true});
}

const OpenFileRequestSchema = z.object({path: z.string().min(1)}).strict();

export interface OpenFileDependencies {
	rejectRequest: (request: Request) => Response | null;
	/** The roots the file viewer may read; nothing outside them is opened. */
	resolveRoots: () => Promise<readonly string[]>;
	/** The app config, whose `file_roots` override `resolveRoots`; defaults to the real one. */
	configPath?: string;
	openPath: (path: string) => Promise<void>;
}

const defaultOpenFileDependencies: OpenFileDependencies = {
	rejectRequest: rejectCrossSite,
	resolveRoots: defaultRevealDependencies.resolveRoots,
	openPath: defaultDependencies.openPath,
};

/** Files macOS `open` would run rather than show: scripts, apps, installers, Automator and AppleScript. */
const EXECUTABLE_EXTENSION =
	/\.(app|command|tool|terminal|sh|bash|zsh|csh|ksh|fish|py|rb|pl|scpt|scptd|applescript|workflow|action|pkg|mpkg|dmg|jar|exe|bat|cmd|com|ps1|vbs|msi|bin|run|out|webloc|inetloc|fileloc|prefpane|kext|plugin|bundle|dylib|so)$/i;

/**
 * Open one file with its default app (`open <path>`) for Open in ▸ Default
 * app and ⌘-click. Like upstream's "Blocked: executable config", anything
 * that would run instead of open is refused: executable extensions and
 * files with an execute bit.
 */
export async function handleOpenFile(
	request: Request,
	dependencies: OpenFileDependencies = defaultOpenFileDependencies,
): Promise<Response> {
	const rejection = dependencies.rejectRequest(request);
	if (rejection) return rejection;

	const parsed = OpenFileRequestSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) {
		return Response.json({error: z.prettifyError(parsed.error)}, {status: 400});
	}

	const {FileServingError, statAllowedFile} = await import("./file-serving");
	let resolvedPath: string;
	try {
		const roots = await dependencies.resolveRoots();
		resolvedPath = (await statAllowedFile(parsed.data.path, dependencies.configPath, roots)).path;
	} catch (error) {
		if (error instanceof FileServingError) {
			return Response.json({error: error.message}, {status: error.status});
		}
		throw error;
	}

	const {stat} = await import("node:fs/promises");
	if (EXECUTABLE_EXTENSION.test(resolvedPath) || ((await stat(resolvedPath)).mode & 0o111) !== 0) {
		return Response.json({error: "Blocked: executable"}, {status: 403});
	}

	await dependencies.openPath(resolvedPath);
	return Response.json({ok: true});
}
