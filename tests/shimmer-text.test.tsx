// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ShimmerText} from "../src/components/shimmer-text";

afterEach(cleanup);

describe("ShimmerText", () => {
	it("renders upstream's shimmering span with an aria-hidden, inert clone carrying the band", () => {
		const {container} = render(<ShimmerText className="truncate min-w-0 text-body">Fetching docs</ShimmerText>);
		expect(container.innerHTML).toBe(
			'<span data-cds="ShimmerText" data-shimmering="true" dir="auto" class="relative truncate min-w-0 text-body">' +
				"Fetching docs" +
				'<span data-cds-shimmer-clone="" aria-hidden="true" inert="">Fetching docs</span>' +
				"</span>",
		);
	});

	it("exposes the text once to assistive technology", () => {
		render(<ShimmerText>Stopping</ShimmerText>);
		const visible = screen.getAllByText("Stopping").filter((node) => node.closest("[inert]") === null);
		expect(visible.map((node) => node.getAttribute("data-cds"))).toStrictEqual(["ShimmerText"]);
	});

	it("renders bare relative positioning when no className is given", () => {
		const {container} = render(<ShimmerText>Stopping</ShimmerText>);
		expect(container.firstElementChild?.getAttribute("class")).toBe("relative");
	});
});
