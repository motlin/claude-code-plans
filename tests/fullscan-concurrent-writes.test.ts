import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {readdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {fullScan, indexFile} from "../src/lib/db/indexer";
import {listSessionsForProjectFromDb} from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";

const testDir = join(tmpdir(), "claude-fullscan-concurrent-test-" + process.pid);
let db: AppDb;

function transcript(content: string): string {
	return JSON.stringify({type: "user", message: {role: "user", content}}) + "\n";
}

beforeEach(() => {
	mkdirSync(testDir, {recursive: true});
	db = openTestDb();
});

afterEach(() => {
	db.close();
	rmSync(testDir, {recursive: true, force: true});
});

/** A readdir that runs `afterList` once, right after the scan has listed `target`. */
function readDirectoryWithHook(target: string, afterList: () => Promise<void> | void) {
	let fired = false;
	return async (path: string): Promise<string[]> => {
		const entries = await readdir(path);
		if (!fired && path === target) {
			fired = true;
			await afterList();
		}
		return entries;
	};
}

describe("fullScan with transcripts written while it runs", () => {
	it("indexes and lists a transcript created after its project directory was listed", async () => {
		const project = "-Users-alice-projects-app";
		const projectDir = join(testDir, project);
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(join(projectDir, "sess-old.jsonl"), transcript("Old session"));

		await fullScan(
			db.index,
			db.summaries,
			testDir,
			undefined,
			undefined,
			readDirectoryWithHook(projectDir, () => {
				writeFileSync(join(projectDir, "sess-new.jsonl"), transcript("New session"));
			}),
		);

		const ids = listSessionsForProjectFromDb(db.index, project)
			.map((session) => session.id)
			.toSorted();
		expect(ids).toStrictEqual(["sess-new", "sess-old"]);
	});

	it("indexes a transcript in a project directory created after the projects root was listed", async () => {
		const project = "-Users-alice-projects-fresh";
		const projectDir = join(testDir, project);

		await fullScan(
			db.index,
			db.summaries,
			testDir,
			undefined,
			undefined,
			readDirectoryWithHook(testDir, () => {
				mkdirSync(projectDir, {recursive: true});
				writeFileSync(join(projectDir, "sess-fresh.jsonl"), transcript("Fresh session"));
			}),
		);

		const ids = listSessionsForProjectFromDb(db.index, project).map((session) => session.id);
		expect(ids).toStrictEqual(["sess-fresh"]);
	});

	it("keeps a transcript the session page indexed on demand mid-scan instead of pruning it", async () => {
		const project = "-Users-alice-projects-app";
		const projectDir = join(testDir, project);
		mkdirSync(projectDir, {recursive: true});
		writeFileSync(join(projectDir, "sess-old.jsonl"), transcript("Old session"));

		await fullScan(
			db.index,
			db.summaries,
			testDir,
			undefined,
			undefined,
			readDirectoryWithHook(projectDir, async () => {
				const newPath = join(projectDir, "sess-demand.jsonl");
				writeFileSync(newPath, transcript("Opened while indexing"));
				await indexFile(db.index, newPath, testDir);
				db.summaries
					.insert(schema.summaries)
					.values({sessionId: "sess-demand", lastMessageId: "m1", summary: "Kept", generatedAt: 1})
					.run();
			}),
		);

		expect(db.summaries.select().from(schema.summaries).all()).toStrictEqual([
			{sessionId: "sess-demand", lastMessageId: "m1", summary: "Kept", generatedAt: 1},
		]);
		const ids = listSessionsForProjectFromDb(db.index, project)
			.map((session) => session.id)
			.toSorted();
		expect(ids).toStrictEqual(["sess-demand", "sess-old"]);
	});
});
