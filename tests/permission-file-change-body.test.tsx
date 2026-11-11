// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {encodeFilePath} from "../src/lib/api/file";
import {PermissionFileChangePreview} from "../src/components/permission-file-change-body";
import {plainFileChangeParts} from "../src/lib/permission-file-change";

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

/** Answers the file API: a status with the file's text for 200, an error body otherwise. */
function serveFile(status: number, content = ""): ReturnType<typeof vi.fn<typeof fetch>> {
	const fetchMock = vi.fn<typeof fetch>(async (input) => {
		const url = String(input);
		if (!url.startsWith("/api/file/")) throw new Error(`unexpected fetch ${url}`);
		return Promise.resolve(
			status === 200 ? Response.json({content, path: "/repo/a.ts"}) : Response.json({error: "nope"}, {status}),
		);
	});
	vi.stubGlobal("fetch", fetchMock);
	return fetchMock;
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

/** Draws the path, and the note when there is one, as the card's `drawDetail` does. */
function drawDetail(note: string | null) {
	return (
		<div data-testid="detail">
			/repo/a.ts{note === null ? null : <p data-testid="approval-detail-note">{note}</p>}
		</div>
	);
}

function preview(toolName: string, toolInput: Record<string, unknown>, copyNote: string | null = null) {
	return render(
		<PermissionFileChangePreview
			toolName={toolName}
			toolInput={toolInput}
			copyNote={copyNote}
			drawDetail={drawDetail}
		/>,
	);
}

interface DiffMarkup {
	rows: string[];
	numbers: string[];
	pre: {diff: boolean; file: boolean; disableLineNumbers: boolean};
}

async function diffMarkup(container: HTMLElement): Promise<DiffMarkup> {
	let markup: DiffMarkup | null = null;
	await waitFor(() => {
		const root = container.querySelector("diffs-container")?.shadowRoot;
		const pre = root?.querySelector("pre");
		if (!root || !pre?.querySelector("[data-content] > [data-line-type]")) throw new Error("no rendered rows yet");
		markup = {
			rows: [...root.querySelectorAll("[data-content] > [data-line-type]")].map(
				(row) => `${row.getAttribute("data-line-type")}:${row.textContent}`,
			),
			numbers: [...root.querySelectorAll("[data-gutter] [data-line-number-content]")].map(
				(cell) => cell.textContent,
			),
			pre: {
				diff: pre.hasAttribute("data-diff"),
				file: pre.hasAttribute("data-file"),
				disableLineNumbers: pre.hasAttribute("data-disable-line-numbers"),
			},
		};
	});
	return markup!;
}

/** Upstream's `Yx` in a card: the group/body column and its Code scroller. */
function scroller(outer: HTMLElement) {
	const node = outer.querySelector<HTMLElement>(":scope > div");
	return {
		outerClass: outer.className,
		className: node?.className,
		role: node?.getAttribute("role"),
		label: node?.getAttribute("aria-label"),
		tabIndex: node?.getAttribute("tabindex"),
		minHeight: node?.style.minHeight,
		host: node?.querySelector(":scope > [data-cds=FileDiff]")?.getAttribute("dir"),
	};
}

const SCROLLER = {
	outerClass: "group/body flex w-full flex-col",
	className: "max-h-[400px] overflow-y-auto epitaxy-diff card-ring rounded-lg overflow-clip",
	role: "group",
	label: "Code",
	tabIndex: "0",
	host: "ltr",
};

describe("PermissionFileChangePreview, input only", () => {
	it("draws an Edit's old → new diff without line numbers in upstream's 400px Code scroller", async () => {
		serveFile(404);
		const {container} = preview("Edit", {file_path: "/repo/a.ts", old_string: "a\nb", new_string: "a\nc"});
		expect(await diffMarkup(container)).toStrictEqual({
			rows: ["context:a", "change-deletion:b", "change-addition:c"],
			numbers: ["1", "2", "2"],
			pre: {diff: true, file: false, disableLineNumbers: true},
		});
		expect({
			scroller: scroller(container.querySelector("[data-file-change-body]")!),
			note: screen.queryByTestId("approval-detail-note"),
		}).toStrictEqual({scroller: {...SCROLLER, minHeight: "48px"}, note: null});
	});

	it("draws a MultiEdit as one diff with an ellipsis row between edits, and reads no file", async () => {
		const fetchMock = serveFile(404);
		const {container} = preview("MultiEdit", {
			file_path: "/repo/a.ts",
			edits: [
				{old_string: "a", new_string: "b"},
				{old_string: "c", new_string: "d"},
			],
		});
		expect(await diffMarkup(container)).toStrictEqual({
			rows: ["change-deletion:a", "change-addition:b", "context:…", "change-deletion:c", "change-addition:d"],
			numbers: ["1", "1", "2", "3", "3"],
			pre: {diff: true, file: false, disableLineNumbers: true},
		});
		expect({
			minHeight: scroller(container.querySelector("[data-file-change-body]")!).minHeight,
			fetches: fetchMock.mock.calls.length,
		}).toStrictEqual({minHeight: "80px", fetches: 0});
	});

	it("draws a Write to a new file as upstream's pure-additions file: numbered lines behind a `+ ` sign", async () => {
		serveFile(404);
		const {container} = preview("Write", {file_path: "/repo/a.ts", content: "one\ntwo\nthree\nfour"});
		const markup = await diffMarkup(container);
		const root = container.querySelector("diffs-container")!.shadowRoot!;
		const css = [...root.querySelectorAll("style")].map((style) => style.textContent).join("");
		expect({
			markup,
			addTint: css.includes("[data-line]{background:var(--diffs-bg-addition);}"),
			sign: css.includes('[data-line-number-content]::before{content:"+ ";'),
			minHeight: scroller(container.querySelector("[data-file-change-body]")!).minHeight,
		}).toStrictEqual({
			markup: {
				rows: ["context:one", "context:two", "context:three", "context:four"],
				numbers: ["1", "2", "3", "4"],
				pre: {diff: false, file: true, disableLineNumbers: false},
			},
			addTint: true,
			sign: true,
			minHeight: "64px",
		});
	});
});

/** A file API that never answers, so the read stays pending. */
function neverServe() {
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(async () => new Promise<Response>(() => {})),
	);
}

/** A file API whose single answer the test releases. */
function serveLater(): (status: number, content?: string) => Promise<void> {
	let release: (response: Response) => void = () => {};
	vi.stubGlobal(
		"fetch",
		vi.fn<typeof fetch>(
			async () =>
				new Promise<Response>((resolve) => {
					release = resolve;
				}),
		),
	);
	return async (status, content = "") => {
		await act(async () => {
			release(
				status === 200
					? Response.json({content, path: "/repo/a.ts"})
					: Response.json({error: "nope"}, {status}),
			);
			await Promise.resolve();
		});
	};
}

const PLAIN_CLASS =
	"epitaxy-scroll-clamp scroll-fade-y focus-visible:outline-hidden focus-visible:shadow-focus flex max-h-[400px] flex-col gap-sm overflow-y-auto";
const PART_CLASS = "flex shrink-0 flex-col gap-1";
const LABEL_CLASS = "text-footnote text-muted-as-secondary select-text break-words [unicode-bidi:plaintext]";
const TEXT_CLASS =
	"bg-alpha-1 rounded-lg py-md px-lg text-code text-secondary whitespace-pre-wrap break-words select-text [unicode-bidi:plaintext]";

/** Upstream's plain body (`fw`): each part's label and text, with the classes they carry. */
function plainBody(container: HTMLElement) {
	const plain = container.querySelector<HTMLElement>("[data-testid=approval-file-change-plain]");
	if (plain === null) return null;
	return {
		className: plain.className,
		fixed: plain.getAttribute("data-fixed-code-size"),
		text: plain.textContent,
		parts: [...plain.children].map((part) => ({
			className: part.className,
			children: [...part.children].map((child) => [child.tagName, child.className, child.textContent]),
		})),
	};
}

describe("PermissionFileChangePreview, upstream's plain body (uw/fw/dw)", () => {
	it("draws an Edit as Removed text then Added text while the file read is pending, with no skeleton or diff", () => {
		neverServe();
		const {container} = preview("Edit", {file_path: "/repo/a.ts", old_string: "a\nb", new_string: "a\nc\nd"});
		expect({
			plain: plainBody(container),
			grid: container.querySelector("[data-testid=approval-file-change-plain]")?.parentElement?.className,
			skeleton: container.querySelector("[aria-hidden].rounded-lg.bg-alpha-1"),
			diff: container.querySelector("[data-cds=FileDiff]"),
		}).toStrictEqual({
			plain: {
				className: PLAIN_CLASS,
				fixed: "",
				text: "Removed texta\nbAdded texta\nc\nd",
				parts: [
					{
						className: PART_CLASS,
						children: [
							["P", LABEL_CLASS, "Removed text"],
							["DIV", TEXT_CLASS, "a\nb"],
						],
					},
					{
						className: PART_CLASS,
						children: [
							["P", LABEL_CLASS, "Added text"],
							["DIV", TEXT_CLASS, "a\nc\nd"],
						],
					},
				],
			},
			grid: "grid [&>*]:[grid-area:1/1] [&>*]:min-w-0",
			skeleton: null,
			diff: null,
		});
	});

	it("draws a Write as one unlabelled part, and drops an Edit's empty side", () => {
		neverServe();
		const write = preview("Write", {file_path: "/repo/a.ts", content: "x"});
		const writeParts = plainBody(write.container)?.parts;
		cleanup();
		const edit = preview("Edit", {file_path: "/repo/b.ts", old_string: "", new_string: "y"});
		expect({write: writeParts, edit: plainBody(edit.container)?.parts}).toStrictEqual({
			write: [{className: PART_CLASS, children: [["DIV", TEXT_CLASS, "x"]]}],
			edit: [
				{
					className: PART_CLASS,
					children: [
						["P", LABEL_CLASS, "Added text"],
						["DIV", TEXT_CLASS, "y"],
					],
				},
			],
		});
	});

	it("lists a MultiEdit's edits as Removed/Added pairs (upstream's dw)", () => {
		expect(
			plainFileChangeParts("MultiEdit", {
				file_path: "/repo/a.ts",
				edits: [{old_string: "a", new_string: "b"}, {old_string: "c", new_string: "d"}, "not an edit"],
			}),
		).toStrictEqual([
			{label: "Removed text", text: "a"},
			{label: "Added text", text: "b"},
			{label: "Removed text", text: "c"},
			{label: "Added text", text: "d"},
		]);
	});

	it("shows hidden characters in the plain text", () => {
		neverServe();
		const {container} = preview("Write", {file_path: "/repo/a.ts", content: "a\u0007b\n"});
		expect(plainBody(container)?.text).toBe("a[U+0007]b\n");
	});

	it("keeps the plain body after the user scrolled it when the read gives no disk diff", async () => {
		const answer = serveLater();
		const {container} = preview("Edit", {file_path: "/repo/a.ts", old_string: "a", new_string: "b"});
		fireEvent.scroll(container.querySelector("[data-testid=approval-file-change-plain]")!);
		await answer(404);
		await waitFor(() => {
			expect(vi.mocked(fetch).mock.calls.length).toBe(1);
		});
		expect({
			plain: plainBody(container)?.text,
			diff: container.querySelector("[data-cds=FileDiff]"),
		}).toStrictEqual({plain: "Removed textaAdded textb", diff: null});
	});

	it("swaps the diff in for the plain body when the read settles untouched", async () => {
		const answer = serveLater();
		const {container} = preview("Edit", {file_path: "/repo/a.ts", old_string: "a", new_string: "b"});
		await answer(404);
		await waitFor(() => {
			expect(container.querySelector("[data-cds=FileDiff]")).not.toBeNull();
		});
		expect(plainBody(container)).toBeNull();
	});

	it("draws the disk diff even after a scroll once the read finds the file", async () => {
		const answer = serveLater();
		const {container} = preview("Edit", {file_path: "/repo/a.ts", old_string: "a", new_string: "b"});
		fireEvent.pointerDown(container.querySelector("[data-testid=approval-file-change-plain]")!);
		await answer(200, "a\n");
		await waitFor(() => {
			expect(container.querySelector("[data-cds=FileDiff]")).not.toBeNull();
		});
		expect(plainBody(container)).toBeNull();
	});
});

describe("PermissionFileChangePreview, read from disk", () => {
	it("draws an Edit at the file's real line numbers with one line of context", async () => {
		const fetchMock = serveFile(200, "one\ntwo\nthree\nfour\nfive\n");
		const {container} = preview("Edit", {file_path: "/repo/a.ts", old_string: "four", new_string: "FOUR"});
		expect(await diffMarkup(container)).toStrictEqual({
			rows: ["context:three", "change-deletion:four", "change-addition:FOUR", "context:five"],
			numbers: ["3", "4", "4", "5"],
			pre: {diff: true, file: false, disableLineNumbers: false},
		});
		expect(fetchMock.mock.calls.map(([url]) => url)).toStrictEqual([`/api/file/${encodeFilePath("/repo/a.ts")}`]);
	});

	it("says a file outside the allowed roots couldn't be checked", async () => {
		serveFile(403);
		preview("Edit", {file_path: "/repo/a.ts", old_string: "a", new_string: "b"});
		expect((await screen.findByTestId("approval-detail-note")).textContent).toBe(
			"Couldn’t check this file, so this shows only what Claude sent.",
		);
	});

	it("puts the disk's match count in place of the copy's replace-every note", async () => {
		serveFile(200, "x x x\n");
		preview(
			"Edit",
			{file_path: "/repo/a.ts", old_string: "x", new_string: "y", replace_all: true},
			"Replaces every match in the file.",
		);
		expect((await screen.findByTestId("approval-detail-note")).textContent).toBe(
			"Replaces all 3 matches in the file.",
		);
	});

	it("says a Write replaces the existing file only until its disk diff is drawn", async () => {
		const answer = serveLater();
		const {container} = preview("Write", {file_path: "/repo/a.ts", content: "new\n"});
		await answer(200, "old\n");
		await waitFor(() => {
			expect(container.querySelector("[data-cds=FileDiff]")).not.toBeNull();
		});
		expect(screen.queryByTestId("approval-detail-note")).toBeNull();
	});

	it("keeps the replace note beside a secret file's diff, which is drawn from the input alone", async () => {
		serveFile(200, "A=1\n");
		const {container} = preview("Write", {file_path: "/repo/.env", content: "B=2\n"});
		await waitFor(() => {
			expect(container.querySelector("[data-cds=FileDiff]")).not.toBeNull();
		});
		expect(screen.getByTestId("approval-detail-note").textContent).toBe("Replaces the existing file.");
	});
});
