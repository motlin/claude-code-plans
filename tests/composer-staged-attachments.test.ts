// @vitest-environment jsdom

import {afterEach, describe, expect, it} from "vite-plus/test";

import {
	attachContext,
	attachPendingUpload,
	getContextChips,
	hydrateStagedChips,
	registerComposer,
	removeContextChip,
	takeContextChips,
} from "../src/lib/context-attach";

const SESSION = "dave-session";
const KEY = `ccp-composer-attachments:${SESSION}`;

afterEach(() => {
	for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
	localStorage.clear();
});

function stored(): unknown {
	const raw = localStorage.getItem(KEY);
	return raw === null ? null : JSON.parse(raw);
}

describe("staged attachments saved with the draft", () => {
	it("saves settled tiles without their in-memory bytes, and leaves pending uploads out", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		attachContext(SESSION, {kind: "file", path: "alice.ts", range: {start: 2, end: 4}, text: "x", language: "ts"});
		attachContext(SESSION, {
			kind: "image",
			path: "/cache/bob.png",
			name: "bob.png",
			previewUrl: "blob:bob",
		});
		attachContext(SESSION, {
			kind: "file",
			path: "/cache/notes.md",
			name: "notes.md",
			file: new File(["notes"], "notes.md"),
		});
		attachPendingUpload(SESSION, {kind: "image", name: "carol.png"});
		stop();

		expect(stored()).toStrictEqual([
			{kind: "file", path: "alice.ts", range: {start: 2, end: 4}, text: "x", language: "ts"},
			{kind: "image", path: "/cache/bob.png", name: "bob.png"},
			{kind: "file", path: "/cache/notes.md", name: "notes.md"},
		]);
	});

	it("drops the saved tiles once the strip empties on send", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		attachContext(SESSION, {kind: "terminal", text: "out"});
		takeContextChips(SESSION);
		stop();

		expect(stored()).toBeNull();
	});

	it("restores saved tiles after a reload, with a served preview for images", () => {
		localStorage.setItem(
			KEY,
			JSON.stringify([
				{kind: "excerpt", text: "quoted"},
				{kind: "image", path: "/cache/bob.png", name: "bob.png"},
			]),
		);

		const hydrated = hydrateStagedChips(SESSION);

		expect({
			hydrated,
			chips: getContextChips(SESSION).map(({id: _id, ...rest}) => rest),
		}).toStrictEqual({
			hydrated: true,
			chips: [
				{kind: "excerpt", text: "quoted"},
				{
					kind: "image",
					path: "/cache/bob.png",
					name: "bob.png",
					previewUrl: "/api/image?path=%2Fcache%2Fbob.png",
				},
			],
		});
	});

	it("keeps the in-memory strip over the saved copy, and ignores corrupt storage", () => {
		const stop = registerComposer(SESSION, {insertText: () => {}, focus: () => {}});
		attachContext(SESSION, {kind: "terminal", text: "live"});
		stop();
		localStorage.setItem(KEY, JSON.stringify([{kind: "terminal", text: "stale"}]));
		const kept = hydrateStagedChips(SESSION);
		const keptChips = getContextChips(SESSION).map(({id: _id, ...rest}) => rest);
		for (const chip of getContextChips(SESSION)) removeContextChip(SESSION, chip.id);
		localStorage.setItem(KEY, "{not json");
		const corrupt = hydrateStagedChips(SESSION);

		expect({kept, keptChips, corrupt, chips: getContextChips(SESSION)}).toStrictEqual({
			kept: false,
			keptChips: [{kind: "terminal", text: "live"}],
			corrupt: false,
			chips: [],
		});
	});
});
