import {mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import
{
	clearFileRootsCache,
	FILE_ROOTS_CACHE_TTL_MILLISECONDS,
	resolveConfiguredFileRoots,
	resolveFileSearchRoots,
} from "../src/lib/config";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import * as schema from "../src/lib/db/schema";

let fixtureDirectory: string;
let repositoryRoot: string;
let configPath: string;
let db: AppDb;

beforeEach(() =>
{
	clearFileRootsCache();
	fixtureDirectory = realpathSync(mkdtempSync(join(tmpdir(), "file-roots-cache-")));
	repositoryRoot = join(fixtureDirectory, "repository");
	mkdirSync(
		join(repositoryRoot, ".git"),
		{
			recursive: true,
		},
	);
	configPath = join(fixtureDirectory, "config.json");
	writeFileSync(configPath, JSON.stringify({}));
	db = openTestDb();
	db.index
		.insert(schema.projects)
		.values(
			{
				id: "repository",
				name: "Repository",
				projectPath: repositoryRoot,
				updatedAt: 1,
			},
		)
		.run();
});

afterEach(() =>
{
	vi.useRealTimers();
	db.close();
	rmSync(
		fixtureDirectory,
		{
			recursive: true,
			force: true,
		},
	);
});

describe("file root resolution cache", () =>
{
	it("reuses a recent resolution instead of re-reading the filesystem, and re-resolves once it expires", async () =>
	{
		vi.useFakeTimers(
			{
				toFake: ["Date"],
			},
		);
		const otherRoot = join(fixtureDirectory, "other");
		mkdirSync(
			join(otherRoot, ".git"),
			{
				recursive: true,
			},
		);
		const linkedProject = join(fixtureDirectory, "linked");
		symlinkSync(repositoryRoot, linkedProject);
		db.index
			.insert(schema.projects)
			.values(
				{
					id: "linked",
					name: "Linked",
					projectPath: linkedProject,
					updatedAt: 2,
				},
			)
			.run();
		const first = await resolveFileSearchRoots(db.index, configPath);
		const firstConfigured = await resolveConfiguredFileRoots(configPath, first);

		// Same inputs, different realpath: a cached result keeps the old target, a fresh one follows the link.
		unlinkSync(linkedProject);
		symlinkSync(otherRoot, linkedProject);
		const cached = await resolveFileSearchRoots(db.index, configPath);
		const cachedConfigured = await resolveConfiguredFileRoots(configPath, cached);

		vi.setSystemTime(Date.now() + FILE_ROOTS_CACHE_TTL_MILLISECONDS + 1);
		const expired = await resolveFileSearchRoots(db.index, configPath);

		expect(
			{
				first,
				firstConfigured,
				cached,
				cachedConfigured,
				expired,
			},
		).toStrictEqual(
			{
				first: [repositoryRoot],
				firstConfigured: [repositoryRoot],
				cached: [repositoryRoot],
				cachedConfigured: [repositoryRoot],
				expired: [otherRoot, repositoryRoot],
			},
		);
	});

	it("re-resolves immediately when the indexed projects change", async () =>
	{
		const otherRoot = join(fixtureDirectory, "other");
		mkdirSync(
			join(otherRoot, ".git"),
			{
				recursive: true,
			},
		);
		const before = await resolveFileSearchRoots(db.index, configPath);
		db.index
			.insert(schema.projects)
			.values(
				{
					id: "other",
					name: "Other",
					projectPath: otherRoot,
					updatedAt: 2,
				},
			)
			.run();
		const after = await resolveFileSearchRoots(db.index, configPath);

		expect(
			{
				before,
				after,
			},
		).toStrictEqual(
			{
				before: [repositoryRoot],
				after: [otherRoot, repositoryRoot],
			},
		);
	});
});
