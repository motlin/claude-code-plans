// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ConnectorLetterTile} from "../src/components/connector-letter-tile";
import {longhandStyle} from "./helpers/longhand-style";

afterEach(cleanup);

function tile(name: string)
{
	const {container} = render(<ConnectorLetterTile name={name} />);
	const outer = container.firstElementChild;
	const inner = outer?.firstElementChild;
	const letter = inner?.firstElementChild;
	return {
		outer:
		{
			tag: outer?.tagName,
			className: outer?.className,
			style: longhandStyle(outer),
		},
		inner:
		{
			tag: inner?.tagName,
			className: inner?.className,
			style: longhandStyle(inner),
		},
		letter:
		{
			tag: letter?.tagName,
			dir: letter?.getAttribute("dir"),
			className: letter?.className,
			text: letter?.textContent,
		},
	};
}

describe("ConnectorLetterTile", () =>
{
	it("draws upstream's favicon fallback: a transparent 16px tile around the 16px letter tile", () =>
	{
		expect(tile("plugin:context7:context7")).toStrictEqual(
			{
				outer:
				{
					tag: "DIV",
					className: "shrink-0 flex items-center justify-center bg-transparent",
					style: "width: 16px; height: 16px; border-top-left-radius: 4.32px; border-top-right-radius: 4.32px; border-bottom-right-radius: 4.32px; border-bottom-left-radius: 4.32px;",
				},
				inner:
				{
					tag: "DIV",
					className:
						"shrink-0 flex items-center justify-center overflow-clip bg-surface-3 text-secondary font-medium border border-border shadow-[0_0.8px_1.6px_0_color-mix(in_srgb,black_5%,transparent)]",
					style: "width: 16px; height: 16px; font-size: 10.4px; border-top-left-radius: 4.8px; border-top-right-radius: 4.8px; border-bottom-right-radius: 4.8px; border-bottom-left-radius: 4.8px;",
				},
				letter:
				{
					tag: "P",
					dir: "auto",
					className: "font-sans shrink-0 leading-tight",
					text: "C",
				},
			},
		);
	});

	it("takes the first character of the name, uppercased, and ? for an empty name", () =>
	{
		expect(["1password", "sentry", "claude.ai Gmail", ""].map((name) => tile(name).letter.text)).toStrictEqual([
			"1",
			"S",
			"C",
			"?",
		]);
	});
});
