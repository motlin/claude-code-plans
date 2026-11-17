// @vitest-environment jsdom

import {createMemoryHistory, createRootRoute, createRouter, RouterProvider} from "@tanstack/react-router";
import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {useOpenCustomize} from "../src/components/customize/open-customize";

afterEach(() =>
{
	cleanup();
});

function OpenSkills()
{
	const openCustomize = useOpenCustomize();
	return (
		<button
			type="button"
			onClick={() =>
			{
				openCustomize("skills");
			}}
		>
			Open
		</button>
	);
}

describe("useOpenCustomize", () =>
{
	it("opens a Customize section's Yours list over the current page", async () =>
	{
		const router = createRouter(
			{
				routeTree: createRootRoute(
					{
						component: OpenSkills,
					},
				),
				history: createMemoryHistory(
					{
						initialEntries: ["/?q=1"],
					},
				),
			},
		);
		await router.load();
		render(<RouterProvider router={router} />);

		await act(async () =>
		{
			fireEvent.click(
				await screen.findByRole(
					"button",
					{
						name: "Open",
					},
				),
			);
		});

		expect(
			{
				pathname: router.state.location.pathname,
				search: router.state.location.searchStr,
				hash: router.state.location.hash,
			},
		).toStrictEqual(
			{
				pathname: "/",
				search: "?q=1",
				hash: "customize/skills/yours",
			},
		);
	});
});
