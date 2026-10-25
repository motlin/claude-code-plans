import {describe, expect, it} from "vite-plus/test";
import {
	LEAD_WINDOW_MS,
	PALETTE_MARK_LABELS,
	PALETTE_MARK_RANK,
	paletteMark,
	sortLeads,
	type PaletteMarkInput,
} from "../src/lib/palette-marks";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const DAY = 86_400_000;

function input(overrides: Partial<PaletteMarkInput>): PaletteMarkInput {
	return {bucket: "done", unseen: false, archived: false, mtime: new Date(NOW - DAY).toISOString(), ...overrides};
}

describe("paletteMark", () => {
	it("maps local buckets onto upstream's gf/mf marks and the 7-day lead window", () => {
		const old = new Date(NOW - 30 * DAY).toISOString();
		const eightDays = new Date(NOW - 8 * DAY).toISOString();
		const cases: [string, PaletteMarkInput][] = [
			["blocked, 30 days old", input({bucket: "blocked", mtime: old})],
			["blocked on an unseen error", input({bucket: "blocked", unseenError: true})],
			["working, recent", input({bucket: "working"})],
			["working, 8 days old", input({bucket: "working", mtime: eightDays})],
			["review + unseen", input({bucket: "review", unseen: true})],
			["done + unseen", input({bucket: "done", unseen: true})],
			["done + unseen, 8 days old", input({bucket: "done", unseen: true, mtime: eightDays})],
			["review without unseen (open PR)", input({bucket: "review"})],
			["done", input({bucket: "done"})],
			["archived blocked", input({bucket: "blocked", archived: true})],
			["archived unseen", input({bucket: "done", unseen: true, archived: true})],
		];

		expect(cases.map(([name, session]) => [name, paletteMark(session, NOW)])).toStrictEqual([
			["blocked, 30 days old", {mark: "awaiting", leads: true}],
			["blocked on an unseen error", {mark: "error", leads: true}],
			["working, recent", {mark: "running", leads: true}],
			["working, 8 days old", {mark: "running", leads: false}],
			["review + unseen", {mark: "unread", leads: true}],
			["done + unseen", {mark: "unread", leads: true}],
			["done + unseen, 8 days old", {mark: "unread", leads: false}],
			["review without unseen (open PR)", undefined],
			["done", undefined],
			["archived blocked", undefined],
			["archived unseen", undefined],
		]);
	});

	it("leads exactly at the 7-day boundary", () => {
		expect(
			paletteMark(input({bucket: "working", mtime: new Date(NOW - LEAD_WINDOW_MS).toISOString()}), NOW),
		).toStrictEqual({mark: "running", leads: true});
	});
});

describe("sortLeads", () => {
	it("orders by upstream's uf rank and keeps input order within a rank", () => {
		const leads = [
			{id: "r1", mark: "running"},
			{id: "u1", mark: "unread"},
			{id: "a1", mark: "awaiting"},
			{id: "e1", mark: "error"},
			{id: "a2", mark: "awaiting"},
			{id: "r2", mark: "running"},
		] as const;

		expect(sortLeads(leads).map((lead) => lead.id)).toStrictEqual(["a1", "a2", "e1", "u1", "r1", "r2"]);
	});
});

describe("mark constants", () => {
	it("copies upstream's ranks, sr-only labels and 7-day window", () => {
		expect({PALETTE_MARK_RANK, PALETTE_MARK_LABELS, LEAD_WINDOW_MS}).toStrictEqual({
			PALETTE_MARK_RANK: {awaiting: 0, error: 1, unread: 2, running: 3},
			PALETTE_MARK_LABELS: {awaiting: "Awaiting input", error: "Error", unread: "Unread", running: "Running"},
			LEAD_WINDOW_MS: 604_800_000,
		});
	});
});
