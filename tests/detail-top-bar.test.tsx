// @vitest-environment jsdom

import {render, screen} from "@testing-library/react";
import {DetailTopBar} from "../src/components/detail-top-bar";

describe("DetailTopBar", () => {
	/**
	 * On phones the fixed 32x32 Show-sidebar trigger sits at 8,8 over the bar's row, so the
	 * bar reserves the trigger's column (content starts at 48px, like upstream's `ps-[48px]`
	 * crumb bar) and its back link's arrow is never covered.
	 */
	it("reserves the phone sidebar trigger's column", () => {
		render(
			<DetailTopBar>
				<a href="/projects">All Projects</a>
			</DetailTopBar>,
		);

		const bar = screen.getByRole("link", {name: "All Projects"}).parentElement;
		expect(bar?.className).toBe("-mt-9 mb-4 flex min-h-9 items-center gap-2 max-sm:ps-8");
	});
});
