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
import {coalescePerKey, forEachTranscriptLine} from "./transcript-stream";

export interface ProbedDevServer extends DevServer {
	live: boolean;
}

/** The transcript's tool records, streamed so a long transcript is never held as one string; one read per file at a time. */
const readRecords = coalescePerKey(async (filePath): Promise<unknown[]> => {
	const records: unknown[] = [];
	try {
		await forEachTranscriptLine(filePath, (line) => {
			if (!line.includes('"tool_')) return;
			try {
				records.push(JSON.parse(line) as unknown);
			} catch {
				// a malformed line holds no dev server
			}
		});
	} catch {
		return [];
	}
	return records;
});

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
