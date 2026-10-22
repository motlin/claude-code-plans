// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {HOME_RECENT_LIMIT, HomeLaunchFolderProvider, useHomeLaunchFolder} from "../src/components/home/launch-folder";
import {projectsQueryOptions} from "../src/lib/api/projects";
import {recentSessionsQueryOptions} from "../src/lib/api/sessions";

function withQueries(children: ReactNode) {
	const client = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: Infinity}}});
	client.setQueryData(projectsQueryOptions().queryKey, []);
	client.setQueryData(recentSessionsQueryOptions(HOME_RECENT_LIMIT).queryKey, {sessions: [], nextCursor: null});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type ConsumerName = "composer" | "card";

let setters: Partial<Record<ConsumerName, (launching: boolean) => void>> = {};

/** Stands in for the composer (sets launching) and the start card (reads it). */
function Consumer({name}: Readonly<{name: ConsumerName}>) {
	const {launching, setLaunching} = useHomeLaunchFolder();
	setters[name] = setLaunching;
	return <output aria-label={name}>{String(launching)}</output>;
}

function launchingOf(name: ConsumerName) {
	return screen.getByRole("status", {name}).textContent;
}

afterEach(() => {
	cleanup();
	setters = {};
});

describe("useHomeLaunchFolder launching", () => {
	it("shares the composer's launching flag with every consumer under the provider", () => {
		render(
			withQueries(
				<HomeLaunchFolderProvider>
					<Consumer name="composer" />
					<Consumer name="card" />
				</HomeLaunchFolderProvider>,
			),
		);
		expect([launchingOf("composer"), launchingOf("card")]).toStrictEqual(["false", "false"]);

		act(() => setters.composer?.(true));
		expect([launchingOf("composer"), launchingOf("card")]).toStrictEqual(["true", "true"]);

		act(() => setters.composer?.(false));
		expect([launchingOf("composer"), launchingOf("card")]).toStrictEqual(["false", "false"]);
	});

	it("keeps launching local to each consumer outside a provider", () => {
		render(
			withQueries(
				<>
					<Consumer name="composer" />
					<Consumer name="card" />
				</>,
			),
		);

		act(() => setters.composer?.(true));
		expect([launchingOf("composer"), launchingOf("card")]).toStrictEqual(["true", "false"]);
	});
});
