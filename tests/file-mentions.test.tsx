// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import type {SessionFilesResponse} from "../src/lib/api/session-files";
import {FILE_MENTION_DEBOUNCE_MS, fileMentionTrigger, insertFileMention} from "../src/lib/file-mentions";

describe("fileMentionTrigger", () => {
	it("triggers on @ at the start of the text or after whitespace", () => {
		expect([
			fileMentionTrigger("@", 1),
			fileMentionTrigger("look at @src/li", 15),
			fileMentionTrigger("line one\n@read", 14),
		]).toStrictEqual([
			{start: 0, query: ""},
			{start: 8, query: "src/li"},
			{start: 9, query: "read"},
		]);
	});

	it("ignores @ inside a word, such as an email address", () => {
		expect([fileMentionTrigger("mail alice@example.com", 22), fileMentionTrigger("a@", 2)]).toStrictEqual([
			null,
			null,
		]);
	});

	it("closes once the token is followed by whitespace before the caret", () => {
		expect([
			fileMentionTrigger("@src/index.ts ", 14),
			fileMentionTrigger("@src more", 9),
			fileMentionTrigger("no mention here", 15),
		]).toStrictEqual([null, null, null]);
	});

	it("reads only the token up to the caret", () => {
		expect(fileMentionTrigger("see @src/index.ts now", 8)).toStrictEqual({
			start: 4,
			query: "src",
		});
	});
});

describe("insertFileMention", () => {
	it("replaces the token with @<relative path> and a trailing space", () => {
		expect(insertFileMention("see @sr", {start: 4, query: "sr"}, 7, "src/index.ts")).toStrictEqual({
			text: "see @src/index.ts ",
			caret: 18,
		});
	});

	it("keeps the text after the caret", () => {
		expect(insertFileMention("see @sr and more", {start: 4, query: "sr"}, 7, "src/index.ts")).toStrictEqual({
			text: "see @src/index.ts  and more",
			caret: 18,
		});
	});

	it("quotes paths that contain whitespace", () => {
		expect(insertFileMention("@my", {start: 0, query: "my"}, 3, "docs/my notes.md")).toStrictEqual({
			text: '@"docs/my notes.md" ',
			caret: 20,
		});
	});
});

function listing(entries: {relPath: string; isDirectory: boolean; ignored?: boolean}[]) {
	return {
		kind: "listing",
		dir: "",
		entries: entries.map(({relPath, isDirectory, ignored}) => ({
			name: relPath.slice(relPath.lastIndexOf("/") + 1),
			relPath,
			isDirectory,
			...(ignored === true ? {ignored} : {}),
		})),
		partial: false,
	} satisfies SessionFilesResponse;
}

function search(query: string, relPaths: string[]) {
	return {
		kind: "search",
		dir: "",
		query,
		results: relPaths.map((relPath) => ({
			name: relPath.slice(relPath.lastIndexOf("/") + 1),
			relPath,
			isDirectory: false,
		})),
		partial: false,
		capped: false,
	} satisfies SessionFilesResponse;
}

let responses: Map<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;

beforeEach(() => {
	vi.useFakeTimers();
	responses = new Map();
	fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
		const body = responses.get(url);
		return body === undefined ? Response.json({error: "unexpected"}, {status: 500}) : Response.json(body);
	});
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const TOP_URL = "/api/sessions/session-alice/files?markIgnored=1";
const searchUrl = (query: string) => `/api/sessions/session-alice/files?q=${encodeURIComponent(query)}&markIgnored=1`;

function setup({mentionSessionId}: {mentionSessionId?: string} = {mentionSessionId: "session-alice"}) {
	const onSend = vi.fn<(prompt: string) => void>();
	render(<Composer variant="session" draftKey="session-alice" onSend={onSend} mentionSessionId={mentionSessionId} />);
	const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
	return {textarea, onSend};
}

async function type(textarea: HTMLTextAreaElement, value: string) {
	fireEvent.change(textarea, {target: {value}});
	await act(async () => {
		await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS);
	});
}

function rows() {
	return screen.getAllByRole("option").map((row) => ({
		text: row.textContent,
		selected: row.getAttribute("aria-selected") === "true",
		muted: row.hasAttribute("data-muted"),
	}));
}

describe("Composer @ file mentions", () => {
	it("lists top-level entries for a bare @, muting gitignored and dot entries", async () => {
		responses.set(
			TOP_URL,
			listing([
				{relPath: ".git", isDirectory: true},
				{relPath: "node_modules", isDirectory: true, ignored: true},
				{relPath: "src", isDirectory: true},
				{relPath: "README.md", isDirectory: false},
			]),
		);
		const {textarea} = setup();

		await type(textarea, "@");

		expect({
			listbox: screen.getByRole("listbox", {name: "Mention suggestions"}).className,
			rows: rows(),
		}).toStrictEqual({
			listbox: expect.stringContaining("w-[560px]"),
			rows: [
				{text: ".git", selected: true, muted: true},
				{text: "node_modules", selected: false, muted: true},
				{text: "src", selected: false, muted: false},
				{text: "README.md", selected: false, muted: false},
			],
		});
	});

	it("shows the basename with the muted dirname and caps the list at 15", async () => {
		const paths = Array.from({length: 20}, (_, i) => `src/lib/file-${i}.ts`);
		responses.set(searchUrl("file"), search("file", paths));
		const {textarea} = setup();

		await type(textarea, "see @file");

		const options = screen.getAllByRole("option");
		expect({
			count: options.length,
			first: [...(options[0]?.querySelectorAll("span") ?? [])].map((span) => span.textContent),
		}).toStrictEqual({count: 15, first: ["file-0.ts", "src/lib"]});
	});

	it("accepts the highlighted row with Enter, inserting @<path> without sending", async () => {
		responses.set(searchUrl("ind"), search("ind", ["src/index.ts", "src/lib/index.ts"]));
		const {textarea, onSend} = setup();

		await type(textarea, "open @ind");
		fireEvent.keyDown(textarea, {key: "ArrowDown"});
		fireEvent.keyDown(textarea, {key: "Enter"});

		expect({
			value: textarea.value,
			caret: textarea.selectionStart,
			sent: onSend.mock.calls,
			open: screen.queryByRole("listbox"),
		}).toStrictEqual({
			value: "open @src/lib/index.ts ",
			caret: 23,
			sent: [],
			open: null,
		});
	});

	it("closes on Escape until the token changes", async () => {
		responses.set(searchUrl("ind"), search("ind", ["src/index.ts"]));
		const {textarea} = setup();

		await type(textarea, "@ind");
		fireEvent.keyDown(textarea, {key: "Escape"});

		expect(screen.queryByRole("listbox")).toBeNull();
	});

	it("does not open for an @ inside an email address", async () => {
		const {textarea} = setup();

		await type(textarea, "mail alice@example");

		expect({open: screen.queryByRole("listbox"), fetches: fetchMock.mock.calls}).toStrictEqual({
			open: null,
			fetches: [],
		});
	});

	it("debounces queries so only the settled token is fetched", async () => {
		responses.set(searchUrl("src"), search("src", ["src/index.ts"]));
		const {textarea} = setup();

		fireEvent.change(textarea, {target: {value: "@s"}});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS - 50);
		});
		fireEvent.change(textarea, {target: {value: "@sr"}});
		await act(async () => {
			await vi.advanceTimersByTimeAsync(FILE_MENTION_DEBOUNCE_MS - 50);
		});
		await type(textarea, "@src");

		expect({
			fetched: fetchMock.mock.calls.map(([url]) => url),
			rows: rows().map((row) => row.text),
		}).toStrictEqual({fetched: [searchUrl("src")], rows: ["index.tssrc"]});
	});

	it("stays off without a session to search", async () => {
		const {textarea} = setup({});

		await type(textarea, "@");

		expect({open: screen.queryByRole("listbox"), fetches: fetchMock.mock.calls}).toStrictEqual({
			open: null,
			fetches: [],
		});
	});
});
