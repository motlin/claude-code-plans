// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {useSlashCommands} from "../src/hooks/use-slash-commands";
import {BUILTIN_SLASH_COMMANDS, type SlashCommand} from "../src/lib/slash-commands";

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
});

const HEADER = "Some commands didn’t load. Type / again to retry.";
const LOADED: SlashCommand[] = [{name: "standup", description: "Write my standup", source: "personal-command"}];

function Harness() {
	const slash = useSlashCommands(undefined);
	return <Composer variant="session" draftKey="session-alice" onSend={() => {}} {...slash} />;
}

function menuState() {
	const menu = screen.queryByRole("menu", {name: "Slash commands"});
	if (menu === null) return null;
	const first = menu.firstElementChild;
	return {
		header: first?.getAttribute("role") === null ? first.textContent : null,
		labels: [...menu.querySelectorAll('[role="menuitem"]')].map(
			(row) => row.querySelector("span.min-w-0.truncate")?.textContent,
		),
	};
}

describe("useSlashCommands", () => {
	it("shows upstream's error header over the built-ins when /api/commands fails, and refetches on the next /", async () => {
		const responses = [
			new Response("boom", {status: 500}),
			new Response("boom", {status: 500}),
			Response.json(LOADED),
		];
		const fetchMock = vi.fn<typeof fetch>(async () => Promise.resolve(responses.shift() ?? Response.json(LOADED)));
		vi.stubGlobal("fetch", fetchMock);
		const queryClient = new QueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<Harness />
			</QueryClientProvider>,
		);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});
		await waitFor(() => {
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			expect(queryClient.getQueryState(["slash-commands", null])?.status).toBe("error");
		});

		fireEvent.change(textarea, {target: {value: "/"}});
		await waitFor(() => {
			expect(menuState()?.header).toBe(HEADER);
		});
		const failed = {fetches: fetchMock.mock.calls.length, menu: menuState()};

		fireEvent.change(textarea, {target: {value: ""}});
		fireEvent.change(textarea, {target: {value: "/"}});
		await waitFor(() => {
			expect(menuState()?.labels).toStrictEqual(["standup"]);
		});
		const retried = {fetches: fetchMock.mock.calls.length, menu: menuState()};

		expect({failed, retried}).toStrictEqual({
			failed: {
				fetches: 2,
				menu: {header: HEADER, labels: BUILTIN_SLASH_COMMANDS.map((command) => command.name)},
			},
			retried: {fetches: 3, menu: {header: null, labels: ["standup"]}},
		});
	});

	it("replaces the list with upstream's single skeleton row while /api/commands is pending", async () => {
		let resolve: (response: Response) => void = () => {};
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(
				async () =>
					new Promise<Response>((r) => {
						resolve = r;
					}),
			),
		);
		const queryClient = new QueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<Harness />
			</QueryClientProvider>,
		);
		const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"});

		fireEvent.change(textarea, {target: {value: "/"}});
		const menu = screen.getByRole("menu", {name: "Slash commands"});
		const loading = {
			children: [...menu.children].map((child) => child.outerHTML),
			menuitems: menu.querySelectorAll('[role="menuitem"]').length,
		};

		resolve(Response.json(LOADED));
		await waitFor(() => {
			expect(menuState()?.labels).toStrictEqual(["standup"]);
		});

		expect(loading).toStrictEqual({
			children: [
				'<div data-testid="slash-loading-row" class="flex h-6 items-center gap-1.5 px-2"><div class="h-4 w-32 rounded bg-fill-ghost-hover animate-pulse motion-reduce:animate-none"></div></div>',
			],
			menuitems: 0,
		});
	});

	it("passes the loaded list through without a header", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => Promise.resolve(Response.json(LOADED))),
		);
		const queryClient = new QueryClient();
		render(
			<QueryClientProvider client={queryClient}>
				<Harness />
			</QueryClientProvider>,
		);
		await waitFor(() => {
			expect(queryClient.getQueryState(["slash-commands", null])?.status).toBe("success");
		});

		fireEvent.change(screen.getByRole<HTMLTextAreaElement>("textbox", {name: "Prompt"}), {
			target: {value: "/"},
		});

		expect(menuState()).toStrictEqual({header: null, labels: ["standup"]});
	});
});
