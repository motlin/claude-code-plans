import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vite-plus/test";
import {handleGetAutoArchive, handlePutAutoArchive, handlePutKeptSessions} from "../src/lib/auto-archive-handler";
import type {KeepReport} from "../src/lib/auto-archive";
import {readAutoArchiveInactiveDays} from "../src/lib/config";

function put(body: unknown, headers: Record<string, string> = {}): Request {
	return new Request("http://localhost/api/auto-archive", {
		method: "PUT",
		headers: {"Content-Type": "application/json", ...headers},
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

describe("/api/auto-archive", () => {
	let directory: string;
	let configPath: string;

	beforeEach(async () => {
		directory = await mkdtemp(join(tmpdir(), "auto-archive-handler-test-"));
		configPath = join(directory, "config.json");
	});

	afterEach(async () => {
		await rm(directory, {recursive: true, force: true});
	});

	it("serves Never by default", async () => {
		expect(await handleGetAutoArchive(configPath).json()).toStrictEqual({days: 0});
	});

	it("saves a day count, then asks for a sweep", async () => {
		const sweeps: string[] = [];
		const response = await handlePutAutoArchive(put({days: 3}), configPath, () => {
			sweeps.push("sweep");
		});

		expect({
			status: response.status,
			body: await response.json(),
			stored: readAutoArchiveInactiveDays(configPath),
			sweeps,
		}).toStrictEqual({status: 200, body: {days: 3}, stored: 3, sweeps: ["sweep"]});
	});

	it("rejects invalid bodies and cross-site writes without saving or sweeping", async () => {
		const sweeps: string[] = [];
		const onSaved = () => {
			sweeps.push("sweep");
		};
		const statuses = [
			(await handlePutAutoArchive(put({days: -1}), configPath, onSaved)).status,
			(await handlePutAutoArchive(put({days: 7, extra: true}), configPath, onSaved)).status,
			(await handlePutAutoArchive(put("not json"), configPath, onSaved)).status,
			(await handlePutAutoArchive(put({days: 7}, {"Sec-Fetch-Site": "cross-site"}), configPath, onSaved)).status,
		];

		expect({statuses, stored: readAutoArchiveInactiveDays(configPath), sweeps}).toStrictEqual({
			statuses: [400, 400, 400, 403],
			stored: 0,
			sweeps: [],
		});
	});
});

describe("/api/auto-archive/keep", () => {
	it("records a browser's pins and open sessions", async () => {
		const reports: KeepReport[] = [];
		const body = {browserId: "browser-a", tabId: "tab-1", pinnedIds: ["pin-a"], openIds: ["open-a"]};
		const response = await handlePutKeptSessions(put(body), (report) => {
			reports.push(report);
		});

		expect({status: response.status, reports}).toStrictEqual({status: 204, reports: [body]});
	});

	it("rejects malformed and cross-site reports", async () => {
		const reports: KeepReport[] = [];
		const record = (report: KeepReport) => {
			reports.push(report);
		};
		const statuses = [
			(await handlePutKeptSessions(put({browserId: "a", tabId: "1", pinnedIds: [1], openIds: []}), record))
				.status,
			(
				await handlePutKeptSessions(
					put({browserId: "a", tabId: "1", pinnedIds: [], openIds: []}, {Origin: "https://evil.example"}),
					record,
				)
			).status,
		];

		expect({statuses, reports}).toStrictEqual({statuses: [400, 403], reports: []});
	});
});
