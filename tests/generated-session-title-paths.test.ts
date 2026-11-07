import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";
import {indexJsonlFile, indexSessionsIndex} from "../src/lib/db/indexer";

/**
 * A Remote Control bridged session named only by its pane name shows the title generated from its conversation on
 * every path that names it (sidebar list, pins lookup, palette titles, project page, session header), not only the
 * session list payload. A session that is not bridged keeps its indexed title even with a stored generated title.
 */

type ApiHandler = (context: {params: {id: string}; request: Request}) => Response | Promise<Response>;

const homeRoot = join(tmpdir(), `claude-generated-title-paths-${process.pid}`);
const projectsDir = join(homeRoot, ".claude", "projects");
const projectId = "-Users-alice-projects-workflowy";
const projectPath = "/Users/alice/projects/workflowy";
const projectDir = join(projectsDir, projectId);
const BRIDGED = "492eb514-e303-4281-a46b-f175ef23acec";
const LOCAL = "5c7d9e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";
const GENERATED = "Site migration and sign-in reminder";

let db: AppDb;

function transcript(sessionId: string, bridged: boolean): string {
	const timestamp = "2026-11-03T13:50:38.512Z";
	const record = (fields: Record<string, unknown>) => JSON.stringify({sessionId, timestamp, ...fields});
	return [
		record({type: "custom-title", customTitle: "do-all"}),
		record({type: "agent-name", agentName: "do-all"}),
		...(bridged
			? [
					record({
						type: "bridge-session",
						bridgeSessionId: "session_01RWFcDCz693nTmzqDYFYS1A",
						lastSequenceNum: 0,
					}),
				]
			: []),
		record({
			type: "user",
			uuid: `${sessionId}-u1`,
			cwd: projectPath,
			message: {role: "user", content: "Migrate the site"},
		}),
	]
		.map((line) => `${line}\n`)
		.join("");
}

beforeEach(async () => {
	db = openTestDb();
	mkdirSync(projectDir, {recursive: true});
	const entries = [BRIDGED, LOCAL].map((sessionId) => {
		const fullPath = join(projectDir, `${sessionId}.jsonl`);
		writeFileSync(fullPath, transcript(sessionId, sessionId === BRIDGED));
		return {sessionId, fullPath, fileMtime: 946_598_400_000, messageCount: 1, projectPath};
	});
	writeFileSync(join(projectDir, "sessions-index.json"), JSON.stringify({version: 1, entries}));
	await indexSessionsIndex(db.index, projectDir, projectId);
	for (const entry of entries) await indexJsonlFile(db.index, entry.fullPath, projectId);
	for (const sessionId of [BRIDGED, LOCAL]) {
		db.summaries
			.insert(schema.generatedTitles)
			.values({
				sessionId,
				customTitle: "do-all",
				paneNamed: 1,
				agentName: "do-all",
				cwdBasename: "workflowy",
				title: GENERATED,
				messageCount: 1,
				generatedAt: 1_794_081_940_637,
			})
			.run();
	}
});

afterEach(() => {
	db.close();
	rmSync(homeRoot, {recursive: true, force: true});
	vi.doUnmock("../src/lib/db");
	vi.doUnmock("node:os");
	vi.resetModules();
});

/** Load the stored titles the way the server does, in the module registry the routes import from. */
async function startTitles(): Promise<() => void> {
	vi.doMock("../src/lib/db", () => ({getDb: () => db}));
	const os = await vi.importActual<typeof import("node:os")>("node:os");
	vi.doMock("node:os", () => ({...os, homedir: () => homeRoot, default: {...os, homedir: () => homeRoot}}));
	const {startSessionTitleWorker} = await import("../src/lib/session-title-generator");
	return startSessionTitleWorker({
		summariesDb: db.summaries,
		projectsDir,
		runModel: async () => Promise.reject(new Error("The stored titles are current")),
		onTitle: () => {},
	});
}

async function getJson(route: string, url: string, params: {id: string} = {id: ""}): Promise<unknown> {
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- route modules only export their Route
	const {Route} = (await import(`../src/routes/api/${route}.ts`)) as {Route: unknown};
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TanStack keeps the handlers on options.server
	const handlers = (Route as {options: {server: {handlers: Record<string, ApiHandler>}}}).options.server.handlers;
	const response = await handlers["GET"]!({params, request: new Request(`http://localhost${url}`)});
	return response.json();
}

function titlesById(sessions: Array<{id: string; title: string}>): Record<string, string> {
	return Object.fromEntries(sessions.map((session) => [session.id, session.title]));
}

describe("a pane-named bridged session's generated title", () => {
	it("names the session on every list, lookup and title path, and leaves a local session alone", async () => {
		const stop = await startTitles();
		try {
			const ids = `${BRIDGED},${LOCAL}`;
			const lookup = (await getJson("sessions.lookup", `/api/sessions/lookup?ids=${ids}`)) as Array<{
				id: string;
				title: string;
			}>;
			const titles = (await getJson("sessions.titles", `/api/sessions/titles?ids=${ids}`)) as {
				titles: Record<string, string>;
			};
			const project = (await getJson("projects.$id.sessions", `/api/projects/${projectId}/sessions`, {
				id: projectId,
			})) as Array<{id: string; title: string}>;
			const bridgedDetail = (await getJson("sessions.$id", `/api/sessions/${BRIDGED}`, {id: BRIDGED})) as {
				title: string;
			};
			const localDetail = (await getJson("sessions.$id", `/api/sessions/${LOCAL}`, {id: LOCAL})) as {
				title: string;
			};

			expect({
				lookup: titlesById(lookup),
				titles: titles.titles,
				project: titlesById(project),
				detail: {[BRIDGED]: bridgedDetail.title, [LOCAL]: localDetail.title},
			}).toStrictEqual({
				lookup: {[BRIDGED]: GENERATED, [LOCAL]: "do-all"},
				titles: {[BRIDGED]: GENERATED, [LOCAL]: "do-all"},
				project: {[BRIDGED]: GENERATED, [LOCAL]: "do-all"},
				detail: {[BRIDGED]: GENERATED, [LOCAL]: "do-all"},
			});
		} finally {
			stop();
		}
	});
});
