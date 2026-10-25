import {describe, expect, it} from "vite-plus/test";
import {
	fitPaletteEmptyView,
	LEAD_WINDOW_MS,
	PALETTE_FIT_METRICS,
	paletteViewHeight,
	PALETTE_MARK_LABELS,
	PALETTE_MARK_RANK,
	paletteMark,
	paletteSecondary,
	sortLeads,
	type PaletteFitItem,
	type PaletteGroup,
	type PaletteMark,
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

function rows(prefix: string, count: number, mark?: PaletteMark): PaletteFitItem[] {
	return Array.from({length: count}, (_, index) =>
		mark === undefined ? {id: `${prefix}${index}`} : {id: `${prefix}${index}`, mark},
	);
}

function shape(groups: readonly PaletteGroup<PaletteFitItem>[]): [string, number][] {
	return groups.map((group) => [group.title, group.items.length]);
}

const NEW_SESSION: PaletteFitItem[] = [{id: "action:new_session"}];

describe("fitPaletteEmptyView", () => {
	it("keeps 5 leads and trims Recents to 2 to fit 440px, as upstream's 5 + 2", () => {
		const awaiting = rows("a", 9, "awaiting");
		const plain = rows("p", 5);
		// The organic recents pool is the 7 newest rows, which here are all leads.
		const groups = fitPaletteEmptyView({
			leads: awaiting,
			recents: [...awaiting, ...plain].slice(0, 7),
			actions: NEW_SESSION,
		});

		expect({
			shape: shape(groups),
			ids: groups.map((group) => group.items.map((item) => item.id)),
			recentMarks: groups[1]?.items.map((item) => item.mark),
			height: paletteViewHeight(groups),
		}).toStrictEqual({
			shape: [
				["Needs attention", 5],
				["Recents", 2],
				["Actions", 1],
			],
			// A sliced lead never repeats in Recents; leads past the 5th stay there with their mark.
			ids: [["a0", "a1", "a2", "a3", "a4"], ["a5", "a6"], ["action:new_session"]],
			recentMarks: ["awaiting", "awaiting"],
			height: 427,
		});
	});

	it("moves running leads into an Active group after Needs attention", () => {
		const leads = [...rows("a", 3, "awaiting"), ...rows("r", 2, "running")];

		expect(shape(fitPaletteEmptyView({leads, recents: rows("p", 5), actions: NEW_SESSION}))).toStrictEqual([
			["Needs attention", 3],
			["Active", 2],
			["Recents", 1],
			["Actions", 1],
		]);
	});

	it("lists 7 Recents when nothing leads", () => {
		expect(shape(fitPaletteEmptyView({leads: [], recents: rows("p", 7), actions: NEW_SESSION}))).toStrictEqual([
			["Recents", 7],
			["Actions", 1],
		]);
	});

	it("fits 2 leads beside 5 Recents", () => {
		expect(
			shape(fitPaletteEmptyView({leads: rows("a", 2, "awaiting"), recents: rows("p", 5), actions: NEW_SESSION})),
		).toStrictEqual([
			["Needs attention", 2],
			["Recents", 5],
			["Actions", 1],
		]);
	});

	it("gives an all-running view only an Active group, within 440px", () => {
		const running = rows("r", 6, "running");
		const groups = fitPaletteEmptyView({leads: running, recents: running, actions: NEW_SESSION});

		expect({
			shape: shape(groups),
			recents: groups[1]?.items.map((item) => item.id),
			height: paletteViewHeight(groups),
		}).toStrictEqual({
			shape: [
				["Active", 5],
				["Recents", 1],
				["Actions", 1],
			],
			recents: ["r5"],
			height: 391,
		});
	});

	it("drops an emptied Recents group and the actions group when there are no actions", () => {
		const awaiting = rows("a", 2, "awaiting");

		expect(shape(fitPaletteEmptyView({leads: awaiting, recents: awaiting, actions: []}))).toStrictEqual([
			["Needs attention", 2],
		]);
	});

	it("trims Actions to 1 before trimming Recents", () => {
		const groups = fitPaletteEmptyView({
			leads: rows("a", 5, "awaiting"),
			recents: rows("p", 7),
			actions: rows("x", 9),
		});
		expect(shape(groups)).toStrictEqual([
			["Needs attention", 5],
			["Recents", 2],
			["Actions", 1],
		]);
	});
});

describe("fitPaletteEmptyView with the pinned jump row", () => {
	const JUMP: PaletteFitItem = {id: "action:jump_to_question"};

	function fitWithJump(leads: PaletteFitItem[], plain: PaletteFitItem[]): PaletteGroup<PaletteFitItem>[] {
		return fitPaletteEmptyView({
			leads,
			recents: [...leads, ...plain].slice(0, 7),
			actions: NEW_SESSION,
			jump: JUMP,
		});
	}

	it("counts the untitled jump group toward 440px, giving up one Recents row beside 5 leads", () => {
		const groups = fitWithJump(rows("a", 9, "awaiting"), rows("p", 5));

		expect({
			shape: shape(groups),
			jump: groups[0],
			height: paletteViewHeight(groups),
		}).toStrictEqual({
			shape: [
				["", 1],
				["Needs attention", 5],
				["Recents", 1],
				["Actions", 1],
			],
			jump: {id: "jump", title: "", items: [JUMP]},
			height: 431,
		});
	});

	it("still fits 7 Recents with no leads", () => {
		const groups = fitWithJump([], rows("p", 9));

		expect({shape: shape(groups), height: paletteViewHeight(groups)}).toStrictEqual({
			shape: [
				["", 1],
				["Recents", 7],
				["Actions", 1],
			],
			height: 426,
		});
	});

	it("fits 4 leads beside 2 Recents", () => {
		const groups = fitWithJump(rows("a", 4, "awaiting"), rows("p", 5));

		expect({shape: shape(groups), height: paletteViewHeight(groups)}).toStrictEqual({
			shape: [
				["", 1],
				["Needs attention", 4],
				["Recents", 2],
				["Actions", 1],
			],
			height: 431,
		});
	});
});

describe("paletteViewHeight", () => {
	it("sums upstream's fm metrics: 20 padding, 37 per titled group, 36 per row, 4 between groups", () => {
		expect({
			PALETTE_FIT_METRICS,
			empty: paletteViewHeight([]),
			untitled: paletteViewHeight([{id: "recents", title: "", items: rows("j", 1)}]),
			two: paletteViewHeight([
				{id: "recents", title: "Recents", items: rows("p", 2)},
				{id: "actions", title: "Actions", items: NEW_SESSION},
			]),
		}).toStrictEqual({
			PALETTE_FIT_METRICS: {paddingY: 20, groupTitle: 37, row: 36, groupGap: 4},
			empty: 20,
			untitled: 56,
			two: 20 + 37 + 72 + 4 + 37 + 36,
		});
	});
});

describe("paletteSecondary", () => {
	it("joins upstream's PR #N and time parts with a middle dot, dropping missing parts", () => {
		expect([
			paletteSecondary({prNumber: 863, time: "Past hour"}),
			paletteSecondary({prNumber: 863, time: undefined}),
			paletteSecondary({prNumber: undefined, time: "Past hour"}),
			paletteSecondary({prNumber: undefined, time: undefined}),
		]).toStrictEqual(["PR #863 · Past hour", "PR #863", "Past hour", undefined]);
	});
});
