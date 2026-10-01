// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {ArchivedBadge} from "../src/components/archived-badge";

afterEach(cleanup);

function classesOf(element: HTMLElement): string[] {
	return element.className.split(/\s+/).filter((name) => name !== "");
}

describe("ArchivedBadge", () => {
	it("keeps the bordered pill by default", () => {
		render(<ArchivedBadge />);

		expect(classesOf(screen.getByText("Archived")).includes("border")).toBe(true);
	});

	it("drops the border in the palette variant and uses upstream's 10px/500 4px chip", () => {
		render(<ArchivedBadge variant="palette" />);

		const classes = classesOf(screen.getByText("Archived"));
		expect({
			border: classes.some((name) => name === "border" || name.startsWith("border-")),
			chip: ["text-[10px]", "font-medium", "rounded-r3", "px-1"].map((name) => classes.includes(name)),
		}).toStrictEqual({border: false, chip: [true, true, true, true]});
	});
});
