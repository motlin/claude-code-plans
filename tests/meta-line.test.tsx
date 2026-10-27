// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {MetaLine} from "../src/components/sidebar/meta-line";

afterEach(cleanup);

function lineParts(container: HTMLElement) {
	const line = container.querySelector(".df-meta-line");
	if (line === null) throw new Error("no .df-meta-line");
	return {
		title: line.getAttribute("title"),
		children: [...line.children].map((child) => ({
			tag: child.tagName.toLowerCase(),
			ariaHidden: child.getAttribute("aria-hidden"),
			text: child.textContent,
		})),
		branchGlyphs: line.querySelectorAll("svg[data-branch-glyph]").length,
		prGlyphs: [...line.querySelectorAll("[data-pr-glyph]")].map((glyph) => ({
			state: glyph.getAttribute("data-pr-glyph"),
			ariaHidden: glyph.getAttribute("aria-hidden"),
			className: glyph.getAttribute("class"),
			icons: glyph.querySelectorAll("svg").length,
		})),
	};
}

describe("MetaLine", () => {
	it("renders the warning Blocked word, then the reason in a bdi", () => {
		const {container} = render(<MetaLine line={{kind: "blocked", word: true, reason: "Asked a question"}} />);
		expect(lineParts(container)).toEqual({
			title: "Blocked, Asked a question",
			children: [
				{tag: "span", ariaHidden: "true", text: "Blocked"},
				{tag: "bdi", ariaHidden: null, text: "Asked a question"},
			],
			branchGlyphs: 0,
			prGlyphs: [],
		});
	});

	it("leads a branch with the GitBranch glyph", () => {
		const {container} = render(<MetaLine line={{kind: "place", branch: "main", folder: "claude-code-plans"}} />);
		expect(lineParts(container)).toEqual({
			title: "main, claude-code-plans",
			children: [
				{tag: "span", ariaHidden: null, text: "main"},
				{tag: "bdi", ariaHidden: null, text: "claude-code-plans"},
			],
			branchGlyphs: 1,
			prGlyphs: [],
		});
	});

	it("leads with the PR glyph instead of the branch glyph when the row has a PR", () => {
		const {container} = render(
			<MetaLine line={{kind: "place", pr: "opened", branch: "feature", folder: "claude-code-plans"}} />,
		);
		expect(lineParts(container)).toEqual({
			title: "feature, claude-code-plans",
			children: [
				{tag: "span", ariaHidden: null, text: "feature"},
				{tag: "bdi", ariaHidden: null, text: "claude-code-plans"},
			],
			branchGlyphs: 0,
			prGlyphs: [
				{
					state: "opened",
					ariaHidden: "true",
					className: "flex h-4 shrink-0 items-center gap-0.5",
					icons: 1,
				},
			],
		});
	});

	it("draws no glyph for a folder-only line", () => {
		const {container} = render(<MetaLine line={{kind: "place", folder: "claude-code-plans"}} />);
		expect(lineParts(container)).toEqual({
			title: "claude-code-plans",
			children: [{tag: "span", ariaHidden: null, text: "claude-code-plans"}],
			branchGlyphs: 0,
			prGlyphs: [],
		});
	});
});
