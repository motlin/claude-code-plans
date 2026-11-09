// @vitest-environment jsdom

import {cleanup, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {encodeFilePath} from "../src/lib/api/file";
import {PermissionFileChangePreview} from "../src/components/permission-file-change-body";

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

	it("shows upstream's skeleton while the file read is pending", () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => new Promise<Response>(() => {})),
		);
		const {container} = preview("Edit", {file_path: "/repo/a.ts", old_string: "a\nb", new_string: "a\nc\nd"});
		const skeleton = container.querySelector<HTMLElement>("[aria-hidden].rounded-lg.bg-alpha-1");
		expect({
			height: skeleton?.style.height,
			diff: container.querySelector("[data-cds=FileDiff]"),
		}).toStrictEqual({
			height: "calc(3 * var(--upstream-leading-code) + 2 * var(--cds-pad-md, 8px))",
			diff: null,
		});
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

	it("says a Write replaces the existing file", async () => {
		serveFile(200, "old\n");
		preview("Write", {file_path: "/repo/a.ts", content: "new\n"});
		expect((await screen.findByTestId("approval-detail-note")).textContent).toBe("Replaces the existing file.");
	});
});
