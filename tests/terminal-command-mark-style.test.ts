import {describe, expect, it} from "vite-plus/test";

import {commandMarkStyle} from "../src/lib/terminal-command-mark-style";

const colors =
{
	lineHeight: 17,
	foreground: "#e6e6e6",
	red: "#f14c4c",
};

const dot =
{
	pointerEvents: "none",
	boxSizing: "border-box",
	width: "5px",
	height: "5px",
	marginTop: "6px",
	marginLeft: "calc(var(--terminal-gutter, 0px) / -2 - 2.5px)",
	borderRadius: "50%",
};

const failedBar =
{
	pointerEvents: "none",
	boxSizing: "border-box",
	width: "3px",
	height: "17px",
	marginTop: "0px",
	marginLeft: "calc(var(--terminal-gutter, 0px) / -2 - 1.5px)",
	borderRadius: "1px",
	border: "",
	backgroundColor: "#f14c4c",
	opacity: "1",
};

describe("commandMarkStyle", () =>
{
	it("draws a running command as a hollow foreground ring", () =>
	{
		expect(
			commandMarkStyle(
				{
					...colors,
					finished: false,
					exitCode: undefined,
				},
			),
		).toStrictEqual(
			{
				...dot,
				border: "1px solid #e6e6e6",
				backgroundColor: "",
				opacity: "0.5",
			},
		);
	});

	it("fills the dot once the command finishes with exit 0 or no exit code", () =>
	{
		const filled =
		{
			...dot,
			border: "",
			backgroundColor: "#e6e6e6",
			opacity: "0.5",
		};
		expect([
			commandMarkStyle(
				{
					...colors,
					finished: true,
					exitCode: 0,
				},
			),
			commandMarkStyle(
				{
					...colors,
					finished: true,
					exitCode: undefined,
				},
			),
		]).toStrictEqual([filled, filled]);
	});

	it("turns a nonzero exit into a red bar the height of the row", () =>
	{
		expect([
			commandMarkStyle(
				{
					...colors,
					finished: true,
					exitCode: 1,
				},
			),
			commandMarkStyle(
				{
					...colors,
					finished: true,
					exitCode: -1,
				},
			),
		]).toStrictEqual([failedBar, failedBar]);
	});

	it("falls back to currentColor and a 5px line height", () =>
	{
		expect([
			commandMarkStyle(
				{
					lineHeight: 0,
					finished: true,
					exitCode: 0,
				},
			),
			commandMarkStyle(
				{
					lineHeight: 0,
					finished: true,
					exitCode: 2,
				},
			),
		]).toStrictEqual([
			{
				...dot,
				marginTop: "0px",
				border: "",
				backgroundColor: "currentColor",
				opacity: "0.5",
			},
			{
				...failedBar,
				height: "5px",
				backgroundColor: "currentColor",
			},
		]);
	});
});
