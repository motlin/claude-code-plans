// @vitest-environment jsdom

import {cleanup, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {ShimmerText} from "../src/components/shimmer-text";
import {SHIMMER_PERIOD_MS} from "../src/lib/shimmer";

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

	it("stays mounted but drops the clone and its positioning when inactive, as upstream's active:false", () => {
		const {container} = render(
			<ShimmerText active={false} className="shrink-0 text-secondary">
				Starting workflow
			</ShimmerText>,
		);
		expect(container.innerHTML).toBe(
			'<span data-cds="ShimmerText" data-shimmering="false" dir="auto" class="shrink-0 text-secondary">Starting workflow</span>',
		);
	});

	it("marks the muted variant, which inherits its ink, and phase-locks the band with a negative delay", () => {
		const {container} = render(
			<ShimmerText variant="muted" delay={-1250}>
				Waiting for the terminal to reconnect…
			</ShimmerText>,
		);
		expect(container.innerHTML).toBe(
			'<span data-cds="ShimmerText" data-shimmering="true" dir="auto" data-variant="muted" class="relative" style="--shimmer-delay: -1250ms;">' +
				"Waiting for the terminal to reconnect…" +
				'<span data-cds-shimmer-clone="" aria-hidden="true" inert="">Waiting for the terminal to reconnect…</span>' +
				"</span>",
		);
	});

	it("sweeps on upstream's 3s period", () => {
		expect(SHIMMER_PERIOD_MS).toBe(3000);
	});
});
