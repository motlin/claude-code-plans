// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {cleanup, render} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {useScrollGutterVar} from "../src/hooks/use-scroll-gutter-var";
import {ruleDeclarations} from "./markdown-css";

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function Scroller() {
	const ref = useRef<HTMLDivElement>(null);
	useScrollGutterVar(ref);
	return <div ref={ref} data-testid="scroller" />;
}

describe("scroll gutter", () => {
	it("publishes each edge's scrollbar gutter as --scroll-gutter", () => {
		vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(752);
		vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(730);
		const {getByTestId} = render(<Scroller />);

		expect(getByTestId("scroller").style.getPropertyValue("--scroll-gutter")).toBe("11px");
	});

	it("sizes the dock column from the tile's full width, not the gutter-inset scrollport, as upstream's dock sits outside it", () => {
		// The formatter breaks the long max-width over lines.
		const css = readFileSync("src/styles/globals.css", "utf8")
			.replace(/\s+/g, " ")
			.replaceAll("( ", "(")
			.replaceAll(" )", ")");

		expect(ruleDeclarations(css, " .chat-dock-column")).toStrictEqual({
			"margin-inline": "auto",
			width: "100%",
			"max-width":
				"calc(var(--max-content-width, 768px) + var(--chat-column-extra, 64px) - 2 * var(--scroll-gutter, 0px))",
			"padding-inline-start": "calc(var(--chat-column-start, 16px) - var(--scroll-gutter, 0px))",
			"padding-inline-end": "calc(var(--chat-column-end, 16px) - var(--scroll-gutter, 0px))",
		});
	});
});
