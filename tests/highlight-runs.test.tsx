// @vitest-environment jsdom

import {render} from "@testing-library/react";
import {describe, expect, it} from "vite-plus/test";
import {HighlightRuns} from "../src/components/highlight-runs";

function html(text: string, matches: {start: number; end: number}[]) {
	return render(<HighlightRuns text={text} matches={matches} />).container.innerHTML;
}

describe("HighlightRuns", () => {
	it("wraps matched runs in semibold primary spans", () => {
		expect(html("use tailscale now", [{start: 4, end: 13}])).toBe(
			'<span>use </span><span class="font-semibold text-primary">tailscale</span><span> now</span>',
		);
	});

	it("sorts, merges and clips overlapping matches", () => {
		expect(
			html("abcdefgh", [
				{start: 6, end: 20},
				{start: 3, end: 5},
				{start: 0, end: 2},
				{start: 1, end: 3},
			]),
		).toBe(
			'<span class="font-semibold text-primary">abcde</span><span>f</span><span class="font-semibold text-primary">gh</span>',
		);
	});

	it("renders plain text with no matches and escapes markup", () => {
		expect(html("<b>x</b>", [])).toBe("<span>&lt;b&gt;x&lt;/b&gt;</span>");
	});
});
