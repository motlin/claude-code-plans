// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SESSION_STICKY_HEADER_CLASS} from "../src/components/titlebar-classes";
import {BashRenderer} from "../src/components/tool-renderers/bash-renderer";
import {UsagePaceBand} from "../src/components/usage-pace-banner";

vi.mock("../src/hooks/use-shiki", () => ({useHighlightedLines: () => null}));

afterEach(cleanup);

const source = (path: string) => readFileSync(path, "utf8");

describe("upstream's measured dark surfaces and inks (wave 90)", () => {
	it("paints the titlebar, dock and history fade in one surface for both themes, with no dark-only surface-2 override", () => {
		expect({
			titlebar: SESSION_STICKY_HEADER_CLASS.includes("dark:"),
			frame: source("src/components/app-frame.tsx").includes("dark:bg-surface-2"),
			dock: source("src/components/session-page.tsx").includes("dark:before:to-surface-2"),
			fade: source("src/components/transcript-history-loader.tsx").includes("dark:from-surface-2"),
		}).toStrictEqual({titlebar: false, frame: false, dock: false, fade: false});
	});

	it("rings the Bash command card on surface-2 in dark", () => {
		const {container} = render(
			<BashRenderer
				toolCall={{
					id: "t",
					name: "Bash",
					input: {command: "ls"},
					param: "ls",
					result: "$ ls\na",
					sourceUuid: "u",
				}}
			/>,
		);

		expect(
			container
				.querySelector("[data-bash-code-card]")
				?.className.split(" ")
				.filter((name) => name.startsWith("dark:")),
		).toStrictEqual(["dark:bg-surface-2", "dark:ring-1", "dark:ring-white/10"]);
	});

	it("draws the pace band's used and reset detail in muted ink in dark", () => {
		render(<UsagePaceBand usedPct={59} resetText="Resets Fri" onDismiss={() => {}} />);

		expect(screen.getByText(/59% used/).className).toBe("min-w-0 text-ink-muted");
	});

	it("draws unselected Customize tabs in muted ink and ordered-list markers in secondary ink in dark", () => {
		expect({
			tabs: source("src/components/customize/customize-header.tsx").includes("text-t6 dark:text-ink-muted"),
			marker: /:global\(\.dark\) \.markdown ol > li::marker \{\s*color: var\(--color-secondary\);/.test(
				source("src/components/markdown-article.module.css"),
			),
		}).toStrictEqual({tabs: true, marker: true});
	});
});
