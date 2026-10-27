import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {
	createAutoArchiveRunner,
	createKeepRegistry,
	DAY_MS,
	sweepInactiveSessions,
	type AutoArchiveRunnerDeps,
} from "../src/lib/auto-archive";
import {AutoArchiveDaysSchema, autoArchiveDayOptions} from "../src/lib/auto-archive-options";
import {
	readApplicationSettings,
	readAutoArchiveInactiveDays,
	updateApplicationSettings,
	updateAutoArchiveInactiveDays,
} from "../src/lib/config";
import {openTestDb, type AppDb} from "../src/lib/db/connection";
import {getArchivedSessionIds, setSessionArchived} from "../src/lib/db/queries";
import * as schema from "../src/lib/db/schema";

const NOW = 1_800_000_000_000;
const PROJECT_ID = "project-auto-archive-100";

let db: AppDb;

/** Seed one session per entry, its JSONL last written `ageDays` days before NOW. */
function seed(entries: Record<string, number>, extra: {sidechain?: string[]} = {}): void {
	db.index.insert(schema.projects).values({id: PROJECT_ID, name: "Project", updatedAt: 1_000}).run();
	db.index
		.insert(schema.sessions)
		.values(
			Object.entries(entries).map(([id, ageDays]) => ({
				id,
				projectId: PROJECT_ID,
				title: `Title ${id}`,
				createdAt: 1_000,
				mtimeMs: NOW - ageDays * DAY_MS,
				filePath: `/fixtures/${id}.jsonl`,
				isSidechain: extra.sidechain?.includes(id) === true ? 1 : 0,
			})),
		)
		.run();
}

/** Archives straight into the test DB, recording the order. */
function archiver() {
	const archived: string[] = [];
	return {
		archived,
		archive: (sessionId: string) => {
			archived.push(sessionId);
			setSessionArchived(db.index, sessionId, true, NOW);
		},
	};
}

beforeEach(() => {
	db = openTestDb();
});

afterEach(() => {
	db.close();
});

describe("autoArchiveInactiveDays setting", () => {
	let directory: string;
	let configPath: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "auto-archive-config-test-"));
		configPath = join(directory, "config.json");
	});

	afterEach(async () => {
		await rm(directory, {recursive: true, force: true});
	});

	it("accepts the listed day counts and other whole non-negative days, nothing else", () => {
		expect(
			[0, 1, 2, 7, 14, 30, 3, -1, 1.5, "7", 3651].map((value) => AutoArchiveDaysSchema.safeParse(value).success),
		).toStrictEqual([true, true, true, true, true, true, true, false, false, false, false]);
	});

	it("defaults to 0 (Never) when the config is missing", () => {
		expect(readAutoArchiveInactiveDays(configPath)).toBe(0);
	});

	it("persists the day count and keeps it across a whole application settings save", async () => {
		await updateAutoArchiveInactiveDays(7, configPath);
		await updateApplicationSettings(readApplicationSettings(configPath), configPath);

		expect({
			days: readAutoArchiveInactiveDays(configPath),
			file: JSON.parse(await readFile(configPath, "utf8")) as unknown,
		}).toStrictEqual({
			days: 7,
			file: {
				auto_archive_inactive_days: 7,
				terminal_writes_enabled: false,
				terminal_host: "auto",
				shell_pane_enabled: true,
				visible_nav_sections: ["projects", "artifacts", "plans", "memories", "customize"],
				ignored_dirs: readApplicationSettings(configPath).ignoredDirs,
			},
		});
	});

	it("treats an invalid stored value as the whole config being invalid, so it reads Never", async () => {
		await writeFile(configPath, JSON.stringify({auto_archive_inactive_days: -3}));

		expect(readAutoArchiveInactiveDays(configPath)).toBe(0);
	});
});

describe("autoArchiveDayOptions", () => {
	it("offers Never, 1 day, 2 days, 7 days, 14 days and 30 days", () => {
		expect(autoArchiveDayOptions(0)).toStrictEqual([
			{value: "0", label: "Never"},
			{value: "1", label: "1 day"},
			{value: "2", label: "2 days"},
			{value: "7", label: "7 days"},
			{value: "14", label: "14 days"},
			{value: "30", label: "30 days"},
		]);
	});

	it("inserts a stored non-listed value in sorted order", () => {
		expect(autoArchiveDayOptions(3).map((option) => option.label)).toStrictEqual([
			"Never",
			"1 day",
			"2 days",
			"3 days",
			"7 days",
			"14 days",
			"30 days",
		]);
	});
});

describe("sweepInactiveSessions", () => {
	const noFileChange = () => null;

	it("archives sessions whose newest JSONL write is older than the window", () => {
		seed({old: 8, edge: 7, fresh: 6.9});
		const {archived, archive} = archiver();

		const result = sweepInactiveSessions(db.index, {
			now: NOW,
			days: 7,
			keepIds: new Set(),
			fileMtimeMs: noFileChange,
			archive,
		});

		expect({result, archived, stored: getArchivedSessionIds(db.index)}).toStrictEqual({
			result: ["old"],
			archived: ["old"],
			stored: new Set(["old"]),
		});
	});

	it("does nothing when days is 0", () => {
		seed({ancient: 400});
		const {archived, archive} = archiver();

		expect({
			result: sweepInactiveSessions(db.index, {
				now: NOW,
				days: 0,
				keepIds: new Set(),
				fileMtimeMs: noFileChange,
				archive,
			}),
			archived,
		}).toStrictEqual({result: [], archived: []});
	});

	it("never archives kept (running, waiting, pinned, open or live-pane) sessions or already archived ones", () => {
		seed({kept: 30, archivedAlready: 30, sidechain: 30, idle: 30}, {sidechain: ["sidechain"]});
		setSessionArchived(db.index, "archivedAlready", true, 5);
		const {archived, archive} = archiver();

		const result = sweepInactiveSessions(db.index, {
			now: NOW,
			days: 1,
			keepIds: new Set(["kept"]),
			fileMtimeMs: noFileChange,
			archive,
		});

		expect({result, archived}).toStrictEqual({result: ["idle"], archived: ["idle"]});
	});

	it("skips a session whose JSONL on disk is newer than the indexed mtime says", () => {
		seed({stale: 30, gone: 30});
		const {archived, archive} = archiver();

		sweepInactiveSessions(db.index, {
			now: NOW,
			days: 7,
			keepIds: new Set(),
			fileMtimeMs: (path) => (path === "/fixtures/stale.jsonl" ? NOW - DAY_MS : null),
			archive,
		});

		expect(archived).toStrictEqual(["gone"]);
	});
});

describe("createAutoArchiveRunner", () => {
	function deps(overrides: Partial<AutoArchiveRunnerDeps>): AutoArchiveRunnerDeps & {calls: string[]} {
		const calls: string[] = [];
		const {archive} = archiver();
		return {
			calls,
			db: db.index,
			now: () => NOW,
			readDays: () => 7,
			collectKeepIds: async () => {
				calls.push("collect");
				return Promise.resolve(new Set<string>());
			},
			fileMtimeMs: () => null,
			archive: (sessionId) => {
				calls.push(`archive ${sessionId}`);
				archive(sessionId);
			},
			...overrides,
		};
	}

	it("does no work at all while the setting is Never", async () => {
		seed({old: 30});
		const runnerDeps = deps({readDays: () => 0});

		expect({archived: await createAutoArchiveRunner(runnerDeps).run(), calls: runnerDeps.calls}).toStrictEqual({
			archived: [],
			calls: [],
		});
	});

	it("archives with the kept ids it collected", async () => {
		seed({old: 30, pinned: 30});
		const runnerDeps = deps({
			collectKeepIds: async () => Promise.resolve(new Set(["pinned"])),
		});

		expect(await createAutoArchiveRunner(runnerDeps).run()).toStrictEqual(["old"]);
	});

	it("aborts when the setting is turned off while the kept ids are being collected", async () => {
		seed({old: 30});
		let days = 7;
		const runnerDeps = deps({
			readDays: () => days,
			collectKeepIds: async () => {
				days = 0;
				return Promise.resolve(new Set<string>());
			},
		});

		expect({archived: await createAutoArchiveRunner(runnerDeps).run(), calls: runnerDeps.calls}).toStrictEqual({
			archived: [],
			calls: [],
		});
	});

	it("uses the newest window when the setting changes mid-run", async () => {
		seed({month: 31, week: 8});
		let days = 7;
		const runnerDeps = deps({
			readDays: () => days,
			collectKeepIds: async () => {
				days = 30;
				return Promise.resolve(new Set<string>());
			},
		});

		expect(await createAutoArchiveRunner(runnerDeps).run()).toStrictEqual(["month"]);
	});

	it("does not archive anything when collecting the kept ids fails", async () => {
		seed({old: 30});
		const runnerDeps = deps({
			collectKeepIds: async () => Promise.reject(new Error("registry unavailable")),
		});

		await expect(createAutoArchiveRunner(runnerDeps).run()).rejects.toThrow("registry unavailable");
		expect(getArchivedSessionIds(db.index)).toStrictEqual(new Set());
	});

	it("runs one sweep at a time", async () => {
		seed({old: 30});
		let release = () => {};
		const runnerDeps = deps({
			collectKeepIds: async () =>
				new Promise<ReadonlySet<string>>((resolve) => {
					release = () => {
						resolve(new Set());
					};
				}),
		});
		const runner = createAutoArchiveRunner(runnerDeps);

		const first = runner.run();
		const second = await runner.run();
		release();

		expect({first: await first, second}).toStrictEqual({first: ["old"], second: []});
	});
});

describe("createKeepRegistry", () => {
	function report(browserId: string, tabId: string, pinnedIds: string[], openIds: string[]) {
		return {browserId, tabId, pinnedIds, openIds};
	}

	it("keeps every browser's pins and each tab's open sessions until the open lease runs out", () => {
		let now = NOW;
		const registry = createKeepRegistry({now: () => now, openLeaseMs: 1_000});
		registry.report(report("browser-a", "tab-1", ["pin-a"], ["open-1"]));
		registry.report(report("browser-a", "tab-2", ["pin-a"], ["open-2"]));
		registry.report(report("browser-b", "tab-1", ["pin-b"], []));
		const fresh = registry.keptIds();
		now += 1_001;

		expect({fresh, later: registry.keptIds()}).toStrictEqual({
			fresh: new Set(["pin-a", "open-1", "open-2", "pin-b"]),
			later: new Set(["pin-a", "pin-b"]),
		});
	});

	it("replaces a browser's pins and a tab's open sessions with its newest report, so an unpin releases the session", () => {
		const registry = createKeepRegistry({now: () => NOW, openLeaseMs: 1_000});
		registry.report(report("browser-a", "tab-1", ["pin-a", "pin-b"], ["open-a"]));
		registry.report(report("browser-a", "tab-1", ["pin-b"], []));

		expect(registry.keptIds()).toStrictEqual(new Set(["pin-b"]));
	});

	it("persists the reports, so pins and still-leased open sessions survive a restart", () => {
		let saved: unknown = null;
		let now = NOW;
		const first = createKeepRegistry({
			now: () => now,
			openLeaseMs: 1_000,
			save: (data) => {
				saved = data;
			},
		});
		first.report(report("browser-a", "tab-old", [], ["gone"]));
		now = NOW + 2_000;
		first.report(report("browser-a", "tab-1", ["pin-a"], ["open-a"]));
		now = NOW + 2_500;
		const reloaded = createKeepRegistry({now: () => now, openLeaseMs: 1_000, load: () => saved});
		const withinLease = reloaded.keptIds();
		now = NOW + 3_001;

		expect({saved, withinLease, afterLease: reloaded.keptIds()}).toStrictEqual({
			saved: {
				pins: {"browser-a": ["pin-a"]},
				open: {'["browser-a","tab-1"]': {openIds: ["open-a"], reportedAt: NOW + 2_000}},
			},
			withinLease: new Set(["pin-a", "open-a"]),
			afterLease: new Set(["pin-a"]),
		});
	});

	it("starts empty from a malformed persisted file", () => {
		const registry = createKeepRegistry({now: () => NOW, openLeaseMs: 1_000, load: () => ({pins: 3, open: {}})});

		expect(registry.keptIds()).toStrictEqual(new Set());
	});
});
