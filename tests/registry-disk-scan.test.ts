import {SessionRegistryFileSchema} from "../src/lib/schemas";
import {scanRegistryDir, type RegistryScanIo} from "./registry-disk-scan";

const valid = JSON.stringify({
	pid: 1,
	sessionId: "s1",
	cwd: "/tmp/project",
	startedAt: 1790602944268,
	procStart: "Sat Oct 17 12:00:00 2026",
	version: "2.1.300",
	kind: "interactive",
	entrypoint: "cli",
	status: "idle",
	updatedAt: 1790602944268,
	statusUpdatedAt: 1790602944268,
});

function enoent(): Error {
	return Object.assign(new Error("ENOENT: no such file or directory"), {code: "ENOENT"});
}

/** Each file maps to the successive reads it returns; an Error entry is thrown. */
function fakeIo(files: Record<string, (string | Error)[]>): RegistryScanIo & {reads: string[]; sleeps: number} {
	const reads: string[] = [];
	const io = {
		reads,
		sleeps: 0,
		readdir: () => Object.keys(files),
		readFile: (name: string) => {
			reads.push(name);
			const queue = files[name];
			const next = queue?.length === 1 ? queue[0] : queue?.shift();
			if (next === undefined) {
				throw enoent();
			}
			if (next instanceof Error) {
				throw next;
			}
			return next;
		},
		sleep: async () => {
			io.sleeps += 1;
			await Promise.resolve();
		},
	};
	return io;
}

describe("scanRegistryDir", () => {
	it("sanity: the fixture is a valid registry file", () => {
		expect(SessionRegistryFileSchema.safeParse(JSON.parse(valid)).success).toBe(true);
	});

	it("skips a file that vanishes between readdir and read", async () => {
		const io = fakeIo({"1.json": [enoent()], "2.json": [valid]});
		expect(await scanRegistryDir(io, SessionRegistryFileSchema)).toStrictEqual([]);
		expect({reads: io.reads, sleeps: io.sleeps}).toStrictEqual({reads: ["1.json", "2.json"], sleeps: 0});
	});

	it("retries once after a torn read and passes when the rewrite is complete", async () => {
		const io = fakeIo({"1.json": ['{"pid": 1, "sess', valid]});
		expect(await scanRegistryDir(io, SessionRegistryFileSchema)).toStrictEqual([]);
		expect({reads: io.reads, sleeps: io.sleeps}).toStrictEqual({reads: ["1.json", "1.json"], sleeps: 1});
	});

	it("skips a torn file that is deleted before the retry", async () => {
		const io = fakeIo({"1.json": ['{"pid"', enoent()]});
		expect(await scanRegistryDir(io, SessionRegistryFileSchema)).toStrictEqual([]);
	});

	it("retries once when a mid-write file parses but fails the schema", async () => {
		const io = fakeIo({"1.json": ["{}", valid]});
		expect(await scanRegistryDir(io, SessionRegistryFileSchema)).toStrictEqual([]);
		expect(io.sleeps).toBe(1);
	});

	it("reports JSON that stays unparseable after the retry", async () => {
		const io = fakeIo({"1.json": ["{not json"]});
		const failures = await scanRegistryDir(io, SessionRegistryFileSchema);
		expect(failures.map((failure) => failure.split(":")[0])).toStrictEqual(["1.json"]);
		expect(io.sleeps).toBe(1);
	});

	it("reports real schema drift that persists after the retry", async () => {
		const drift = JSON.stringify({...JSON.parse(valid), pid: "not-a-number"});
		const io = fakeIo({"1.json": [drift]});
		expect(await scanRegistryDir(io, SessionRegistryFileSchema)).toStrictEqual([
			"1.json: pid Invalid input: expected number, received string",
		]);
	});

	it("validates the leading object of a file overwritten in place without truncation", async () => {
		const io = fakeIo({"1.json": [`${valid}}`]});
		expect(await scanRegistryDir(io, SessionRegistryFileSchema)).toStrictEqual([]);
	});

	it("still reports drift in the leading object of a file with a stale tail", async () => {
		const drift = JSON.stringify({...JSON.parse(valid), pid: "not-a-number"});
		const io = fakeIo({"1.json": [`${drift}"}`]});
		expect(await scanRegistryDir(io, SessionRegistryFileSchema)).toStrictEqual([
			"1.json: pid Invalid input: expected number, received string",
		]);
	});

	it("only reads <pid>.json files, never the .key secrets", async () => {
		const io = fakeIo({"1.json": [valid], "1.abc.key": ["secret"], "notes.json": ["{}"]});
		expect(await scanRegistryDir(io, SessionRegistryFileSchema)).toStrictEqual([]);
		expect(io.reads).toStrictEqual(["1.json"]);
	});

	it("rethrows read errors other than ENOENT", async () => {
		const io = fakeIo({"1.json": [Object.assign(new Error("EACCES"), {code: "EACCES"})]});
		await expect(scanRegistryDir(io, SessionRegistryFileSchema)).rejects.toThrow("EACCES");
	});
});
