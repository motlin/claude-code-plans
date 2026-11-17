// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {useFocusedSectionRowKey} from "../src/components/sidebar/use-focused-row-key";

const SECTIONS =
{
	a: new Set(["a1", "a2"]),
	b: new Set(["b1"]),
};

const seen: Record<string, string | null> = {};

function Section({name}: {name: keyof typeof SECTIONS})
{
	seen[name] = useFocusedSectionRowKey(SECTIONS[name]);
	return (
		<div>
			{[...SECTIONS[name]].map((key) => (
				<div key={key} data-row-key={key}>
					<button type="button">{key}</button>
				</div>
			))}
		</div>
	);
}

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
});

describe("useFocusedSectionRowKey (upstream AJ)", () =>
{
	it("reports the focused row only to its own section, and drops the shared listeners with the last section", () =>
	{
		const remove = vi.spyOn(document, "removeEventListener");
		const {getByText, unmount} = render(
			<>
				<Section name="a" />
				<Section name="b" />
			</>,
		);
		const initial =
		{
			...seen,
		};
		act(() =>
		{
			getByText("a2").focus();
		});
		const focused =
		{
			...seen,
		};
		act(() =>
		{
			getByText("a2").blur();
		});
		const blurred =
		{
			...seen,
		};
		unmount();
		expect(
			{
				initial,
				focused,
				blurred,
				removed: remove.mock.calls
					.filter(([type]) => type === "focusin" || type === "focusout")
					.map(([type, , capture]) => [type, capture]),
			},
		).toStrictEqual(
			{
				initial:
				{
					a: null,
					b: null,
				},
				focused:
				{
					a: "a2",
					b: null,
				},
				blurred:
				{
					a: null,
					b: null,
				},
				removed: [
					["focusin", true],
					["focusout", true],
				],
			},
		);
	});
});
