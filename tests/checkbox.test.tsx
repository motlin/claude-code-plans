// @vitest-environment jsdom

import {fireEvent, render} from "@testing-library/react";
import {describe, expect, it, vi} from "vite-plus/test";
import {CdsCheckbox} from "../src/components/ui/checkbox";

describe("CdsCheckbox", () =>
{
	it("copies upstream's cds Checkbox root, box and glyph classes", () =>
	{
		const {container} = render(
			<CdsCheckbox
				size="xs"
				checked={true}
				onCheckedChange={() =>
				{
				}}
				label="Auto"
				aria-describedby="hint"
			/>,
		);
		const root = container.querySelector('[data-cds="Checkbox"]');
		const box = root?.firstElementChild;
		const glyph = box?.firstElementChild;
		expect(
			{
				role: root?.getAttribute("role"),
				size: root?.getAttribute("data-size"),
				checked: root?.getAttribute("aria-checked"),
				describedBy: root?.getAttribute("aria-describedby"),
				root: root?.getAttribute("class"),
				box: box?.getAttribute("class"),
				glyph: glyph?.getAttribute("class"),
				icon: glyph?.querySelector("svg")?.getAttribute("style"),
				label: root?.lastElementChild?.outerHTML,
			},
		).toStrictEqual(
			{
				role: "checkbox",
				size: "xs",
				checked: "true",
				describedBy: "hint",
				root: "cds-reset group/cb border-0 outline-none focus-visible:outline-hidden data-[disabled]:opacity-disabled inline-flex gap-xs text-start font-sans text-body font-normal text-primary items-start",
				box: "flex shrink-0 size-[var(--cds-checkbox)] items-center justify-center rounded-[var(--cds-checkbox-radius)] border border-checkbox-edge bg-transparent group-data-[unchecked]/cb:group-hover/cb:border-checkbox-edge-hover group-data-[checked]/cb:bg-fill-accent group-data-[checked]/cb:border-transparent group-data-[checked]/cb:group-hover/cb:bg-fill-accent-hover group-data-[disabled]/cb:group-data-[unchecked]/cb:group-hover/cb:border-checkbox-edge group-focus-visible/cb:shadow-focus mt-[calc((1lh_-_var(--cds-checkbox,1rem))_/_2)]",
				glyph: "text-on-accent [clip-path:inset(0_100%_0_0)] group-data-[checked]/cb:[clip-path:inset(0)] group-data-[indeterminate]/cb:[clip-path:inset(0)]",
				icon: "flex-shrink: 0; font-size: var(--cds-checkbox-glyph);",
				label: "<span>Auto</span>",
			},
		);
	});

	it("reports the toggled state and leaves describedby off when not given", () =>
	{
		const onCheckedChange = vi.fn<(checked: boolean) => void>();
		const {container} = render(
			<CdsCheckbox size="xs" checked={false} onCheckedChange={onCheckedChange} label="Auto" />,
		);
		const root = container.querySelector('[data-cds="Checkbox"]')!;
		fireEvent.click(root);
		expect(
			{
				describedBy: root.getAttribute("aria-describedby"),
				calls: onCheckedChange.mock.calls.map(([checked]) => checked),
			},
		).toStrictEqual(
			{
				describedBy: null,
				calls: [true],
			},
		);
	});
});
