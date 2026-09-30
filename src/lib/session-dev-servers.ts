import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {
	extractDevServerUrls,
	latestBashResultTexts,
	launchJsonDevServers,
	mergeDevServers,
	type DevServer,
} from "./dev-server-links";
import {probeDevServer} from "./dev-server-probe";

export interface ProbedDevServer extends DevServer {
	live: boolean;
}

async function readRecords(filePath: string): Promise<unknown[]> {
	let text: string;
	try {
		text = await readFile(filePath, "utf-8");
	} catch {
		return [];
	}
	return text.split("\n").flatMap((line) => {
		if (!line.includes('"tool_')) return [];
		try {
			return [JSON.parse(line) as unknown];
		} catch {
			return [];
		}
	});
}

async function readLaunchJson(cwd: string): Promise<DevServer[]> {
	try {
		const text = await readFile(join(cwd, ".claude", "launch.json"), "utf-8");
		return launchJsonDevServers(JSON.parse(text));
	} catch {
		return [];
	}
}

/**
 * The session's loopback dev servers: `.claude/launch.json` entries, then URLs
 * in its latest Bash results, each probed for liveness.
 */
export async function readSessionDevServers(
	transcriptPath: string | undefined,
	cwd: string | null,
	fetchImpl: typeof fetch = fetch,
): Promise<ProbedDevServer[]> {
	const [records, declared] = await Promise.all([
		transcriptPath === undefined ? [] : readRecords(transcriptPath),
		cwd === null ? [] : readLaunchJson(cwd),
	]);
	const servers = mergeDevServers(declared, extractDevServerUrls(latestBashResultTexts(records)));
	return Promise.all(
		servers.map(async (server) => ({
			...server,
			live: (await probeDevServer(server.url, fetchImpl)) === "live",
		})),
	);
}
