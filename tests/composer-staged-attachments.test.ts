// @vitest-environment jsdom

import {afterEach, describe, expect, it, vi} from "vite-plus/test";

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
	vi.unstubAllGlobals();
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

	describe("restored images whose saved file is gone", () => {
		const GONE = "/api/image?path=%2Fcache%2Fgone.png";

		function saveImages(): void {
			localStorage.setItem(
				KEY,
				JSON.stringify([
					{kind: "image", path: "/cache/gone.png", name: "gone.png"},
					{kind: "image", path: "/cache/bob.png", name: "bob.png"},
				]),
			);
		}

		function stubHeads(respond: (url: string) => Promise<Response>) {
			const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
				respond(url),
			);
			vi.stubGlobal("fetch", fetchMock);
			return fetchMock;
		}

		async function settle(): Promise<void> {
			await new Promise((resolve) => {
				setTimeout(resolve, 0);
			});
		}

		it("drops a restored image whose file 404s, rewriting the saved copy, after a HEAD per image", async () => {
			const fetchMock = stubHeads(async (url) =>
				Promise.resolve(new Response(null, {status: url === GONE ? 404 : 200})),
			);
			saveImages();

			hydrateStagedChips(SESSION);
			await settle();

			expect({
				heads: fetchMock.mock.calls,
				chips: getContextChips(SESSION).map((chip) => chip.name),
				stored: stored(),
			}).toStrictEqual({
				heads: [
					[GONE, {method: "HEAD"}],
					["/api/image?path=%2Fcache%2Fbob.png", {method: "HEAD"}],
				],
				chips: ["bob.png"],
				stored: [{kind: "image", path: "/cache/bob.png", name: "bob.png"}],
			});
		});

		it("drops a 403 too, and keeps the tile when the check itself fails", async () => {
			stubHeads(async (url) =>
				url === GONE
					? Promise.resolve(new Response(null, {status: 403}))
					: Promise.reject(new TypeError("offline")),
			);
			saveImages();

			hydrateStagedChips(SESSION);
			await settle();

			expect(getContextChips(SESSION).map((chip) => chip.name)).toStrictEqual(["bob.png"]);
		});

		it("doesn't bring back a tile removed or sent before its check resolves", async () => {
			const answers: ((response: Response) => void)[] = [];
			stubHeads(
				async () =>
					new Promise<Response>((resolve) => {
						answers.push(resolve);
					}),
			);
			saveImages();
			hydrateStagedChips(SESSION);
			const [gone, bob] = getContextChips(SESSION);
			removeContextChip(SESSION, bob!.id);

			answers[0]!(new Response(null, {status: 404}));
			answers[1]!(new Response(null, {status: 404}));
			await settle();

			expect({gone: gone!.name, chips: getContextChips(SESSION), stored: stored()}).toStrictEqual({
				gone: "gone.png",
				chips: [],
				stored: null,
			});
		});
	});
});
