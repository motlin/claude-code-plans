// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {TextPreviewDialog} from "../src/components/text-preview-dialog";
import {TEXT_PREVIEW_LIMIT, textPreviewStats} from "../src/lib/text-preview";

function classes(element: Element | null): string[] {
	return (element?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).toSorted();
}

function noop(): void {
	// The dialog stays open in these renders.
}

afterEach(cleanup);

describe("TextPreviewDialog", () => {
	it("renders an excerpt as upstream's FilePreviewModal snippet: a 520px card titled Excerpt over a blockquote", async () => {
		render(<TextPreviewDialog open title="Excerpt" text={"a\nb"} variant="excerpt" onClose={noop} />);
		const dialog = await screen.findByRole("dialog");
		const scroll = dialog.firstElementChild;
		const header = scroll?.firstElementChild ?? null;
		const heading = header?.querySelector("h2") ?? null;
		const close = screen.getByRole("button", {name: "Close"});
		const body = scroll?.children[1] ?? null;
		const quote = body?.querySelector("blockquote") ?? null;
		expect({
			popup: classes(dialog).filter((name) =>
				["max-w-[520px]", "rounded-card", "bg-surface-3", "shadow-panel-lg"].includes(name),
			),
			scroll: classes(scroll ?? null),
			header: classes(header),
			heading: {text: heading?.textContent, classes: classes(heading)},
			closeFocused: document.activeElement === close,
			body: classes(body),
			quote: {classes: classes(quote), text: quote?.textContent},
			description: dialog.querySelector("p"),
		}).toStrictEqual({
			popup: ["bg-surface-3", "max-w-[520px]", "rounded-card", "shadow-panel-lg"],
			scroll: [
				"break-words",
				"flex",
				"flex-1",
				"flex-col",
				"isolate",
				"min-h-0",
				"overflow-y-auto",
				"p-6",
				"rounded-[inherit]",
			],
			header: ["flex", "gap-2", "items-start", "mb-3"],
			heading: {text: "Excerpt", classes: ["break-words", "font-[580]", "text-[22px]/[28px]", "text-primary"]},
			closeFocused: true,
			body: ["mt-3"],
			quote: {
				classes: ["border-border", "border-s-4", "ms-0", "ps-[14px]", "text-secondary", "whitespace-pre-wrap"],
				text: "a\nb",
			},
			description: null,
		});
	});

	it("renders a file as a code box under a size line", async () => {
		render(<TextPreviewDialog open title="a.ts:1-3" text={"one\ntwo\nthree"} variant="file" onClose={noop} />);
		const dialog = await screen.findByRole("dialog");
		const heading = dialog.querySelector("h2");
		const description = dialog.querySelector("p");
		const body = dialog.querySelector("div[dir=auto]");
		expect({
			heading: heading?.textContent,
			describedBy: dialog.getAttribute("aria-describedby") === description?.id,
			description: {classes: classes(description), text: description?.textContent},
			line: classes(description?.firstElementChild ?? null),
			body: {classes: classes(body), text: body?.textContent},
		}).toStrictEqual({
			heading: "a.ts:1-3",
			describedBy: true,
			description: {
				classes: ["break-words", "font-normal", "text-body", "text-secondary"],
				text: "0.01 KB •3 lines•Formatting may be inconsistent from source",
			},
			line: ["flex", "flex-wrap", "gap-x-1.5", "gap-y-2", "items-center", "mb-3", "mt-0.5", "text-xs"],
			body: {
				classes: [
					"bg-surface-1",
					"break-all",
					"max-h-[70vh]",
					"overflow-auto",
					"p-3",
					"rounded-card",
					"shadow-card-ring",
					"text-code",
					"text-primary",
					"whitespace-pre-wrap",
				],
				text: "one\ntwo\nthree",
			},
		});
	});

	it("shows only the first 102400 characters", async () => {
		const text = "x".repeat(TEXT_PREVIEW_LIMIT + 5);
		render(<TextPreviewDialog open title="big.log" text={text} variant="file" onClose={noop} />);
		const dialog = await screen.findByRole("dialog");
		expect(dialog.querySelector("div[dir=auto]")?.textContent.length).toBe(102400);
	});

	it("measures size in UTF-8 KB to two places and counts lines", () => {
		expect([textPreviewStats("é\n"), textPreviewStats("a".repeat(4000) + "\n")]).toStrictEqual([
			{kb: "0.00", lines: 2},
			{kb: "3.91", lines: 2},
		]);
	});
});
