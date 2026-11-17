// @vitest-environment jsdom

import {readFileSync} from "node:fs";
import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ComposerChinFrame} from "../src/components/composer-chin-frame";
import {parseCssRules} from "./helpers/css-rules";

afterEach(cleanup);

const chinRules = parseCssRules(readFileSync("src/styles/globals.css", "utf8")).filter((rule) =>
	rule.selector.includes("[data-touch-size]"),
);

describe("chin touch-size rows", () =>
{
	it("ports upstream's unlayered touch block: the row's 4px grow at the comfortable 32px control, and the controls' negative margin and 8px radius", () =>
	{
		expect(chinRules).toStrictEqual([
			{
				selector: '[data-cds="ChatComposerChin"] [data-touch-size]',
				atRules: ["@media (pointer: coarse), (hover: none)"],
				declarations:
				{
					"--cmp-chin-end": "12px",
					"--cmp-chin-touch-grow": "calc((2rem - var(--cmp-chin-row-h, 2rem)) / 2)",
					"min-height": "var(--cmp-chin-row-h, 2rem)",
				},
			},
			{
				selector:
					'[data-cds="ChatComposerChin"] [data-touch-size] :is([data-cds="ButtonGroup"], [data-cds="SplitDropdownButton"]):not([data-size]), [data-cds="ChatComposerChin"] [data-touch-size] :is([data-cds="Button"], [data-cds="ModelSelector"], [data-cds="ModelSelectorEffort"]):not([data-size]):not(:is([data-cds="ButtonGroup"], [data-cds="SplitDropdownButton"]) *)',
				atRules: ["@media (pointer: coarse), (hover: none)"],
				declarations:
				{
					"margin-block": "calc(var(--cmp-chin-touch-grow, 0px) * -1)",
					"border-radius": "8px",
				},
			},
		]);
	});

	it("reaches the chin's Button and ModelSelector controls but skips a sized control and a grouped button", () =>
	{
		render(
			<ComposerChinFrame
				trailing={
					<>
						<button type="button" data-cds="ModelSelector">
							Model
						</button>
						<button type="button" data-cds="Button">
							Mode
						</button>
						<button type="button" data-cds="Button" data-size="xs">
							Sized
						</button>
						<span data-cds="ButtonGroup">
							<button type="button" data-cds="Button">
								Grouped
							</button>
						</span>
					</>
				}
			/>,
		);
		const controls = chinRules[1]!.selector;

		expect(
			Array.from(document.querySelectorAll<HTMLElement>("[data-touch-size] [data-cds]"), (element) => [
				element.textContent,
				element.matches(controls),
			]),
		).toStrictEqual([
			["Model", true],
			["Mode", true],
			["Sized", false],
			["Grouped", true],
			["Grouped", false],
		]);
	});
});
