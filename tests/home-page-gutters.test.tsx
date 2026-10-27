// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {HomePage} from "../src/components/home/home-page";

afterEach(cleanup);

describe("HomePage gutters", () => {
	it("makes the tile a tile-slot container and narrows the column to upstream's 16px/24px gutters when that tile is ≤560px", () => {
		const {container} = render(
			<QueryClientProvider client={new QueryClient()}>
				<HomePage dock={<div data-test-dock />}>
					<div data-test-body />
				</HomePage>
			</QueryClientProvider>,
		);
		const gutters = (element: Element | null | undefined) =>
			(element?.className.split(" ") ?? []).filter((name) => /^(\[@container[^\]]*\]:)?p[lr]-/.test(name));
		const tile = [
			"pr-10",
			"pl-8",
			"[@container_tile-slot_(max-width:560px)]:pr-6",
			"[@container_tile-slot_(max-width:560px)]:pl-4",
		];
		expect({
			container: container.firstElementChild?.className.split(" ").includes("@container/tile-slot"),
			body: gutters(container.querySelector("[data-home-body]")?.parentElement),
			dock: gutters(container.querySelector("[data-test-dock]")?.parentElement),
		}).toStrictEqual({container: true, body: tile, dock: tile});
	});
});
