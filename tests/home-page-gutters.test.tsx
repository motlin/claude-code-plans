// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {HomePage} from "../src/components/home/home-page";

afterEach(cleanup);

describe("HomePage gutters", () => {
	it("narrows the column to upstream's 25px phone gutter so the composer box is 336 wide at 386px", () => {
		const {container} = render(
			<QueryClientProvider client={new QueryClient()}>
				<HomePage dock={<div data-test-dock />}>
					<div data-test-body />
				</HomePage>
			</QueryClientProvider>,
		);
		const gutters = (element: Element | null | undefined) =>
			(element?.className.split(" ") ?? []).filter((name) => /^(max-sm:)?p[lr]-/.test(name));
		const phone = ["pr-10", "pl-8", "max-sm:pr-[25px]", "max-sm:pl-[25px]"];
		expect({
			header: gutters(container.querySelector("header")),
			body: gutters(container.querySelector("[data-home-body]")?.parentElement),
			dock: gutters(container.querySelector("[data-test-dock]")?.parentElement),
		}).toStrictEqual({header: phone, body: phone, dock: phone});
	});
});
