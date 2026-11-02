import {mkdirSync, realpathSync, rmSync, writeFileSync} from "node:fs";
import {readdir} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {fullScan, getIndexingStatus} from "../src/lib/db/indexer";

const testDir = join(realpathSync(tmpdir()), "claude-indexing-initial-build-test-" + process.pid);
const project = "-Users-alice-projects-app";
let db: AppDb;

function transcript(content: string): string
{
	return (
		JSON.stringify(
			{
				type: "user",
				message:
				{
					role: "user",
					content,
				},
			},
		) + "\n"
	);
}

/** Runs fullScan and records getIndexingStatus() while the scan lists the projects root. */
async function statusDuringScan(): Promise<ReturnType<typeof getIndexingStatus>>
{
	let observed: ReturnType<typeof getIndexingStatus> | undefined;
	await fullScan(db.index, db.summaries, testDir, undefined, undefined, async (path) =>
	{
		if (path === testDir) observed = getIndexingStatus();
		return readdir(path);
	});
	if (observed === undefined) throw new Error("scan never listed the projects root");
	return observed;
}

beforeEach(() =>
{
	mkdirSync(
		join(testDir, project),
		{
			recursive: true,
		},
	);
	writeFileSync(join(testDir, project, "sess-1.jsonl"), transcript("Hello"));
	db = openTestDb();
});

afterEach(() =>
{
	db.close();
	rmSync(
		testDir,
		{
			recursive: true,
			force: true,
		},
	);
});

describe("getIndexingStatus", () =>
{
	it("reports idle outside a scan", () =>
	{
		expect(getIndexingStatus()).toStrictEqual(
			{
				isIndexing: false,
				isInitialBuild: false,
			},
		);
	});

	it("reports an initial build while scanning into an empty index", async () =>
	{
		expect(await statusDuringScan()).toStrictEqual(
			{
				isIndexing: true,
				isInitialBuild: true,
			},
		);
		expect(getIndexingStatus()).toStrictEqual(
			{
				isIndexing: false,
				isInitialBuild: false,
			},
		);
	});

	it("reports a routine scan, not an initial build, when the index already has files", async () =>
	{
		await fullScan(db.index, db.summaries, testDir);
		expect(await statusDuringScan()).toStrictEqual(
			{
				isIndexing: true,
				isInitialBuild: false,
			},
		);
	});
});
