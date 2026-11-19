// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, renderHook, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {useSlashCommands} from "../src/hooks/use-slash-commands";
import
{
	BUILTIN_SLASH_COMMANDS,
	filterSlashCommands,
	SESSION_SLASH_COMMANDS,
	type SlashCommand,
} from "../src/lib/slash-commands";

// The deferred chunks these tests render, loaded up front as the page warms them before first use.
beforeAll(async () =>
{
	await preloadComposerSurfaces();
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
	vi.unstubAllGlobals();
});

const HEADER = "Some commands didn’t load.\nType / again to retry.";
const LOADED: SlashCommand[] = [
	{
		name: "standup",
		description: "Write my standup",
		source: "personal-command",
	},
];

function Harness()
{
	const slash = useSlashCommands(undefined);
	return (
		<Composer
			compactSlashMenu={false}
			variant="session"
			draftKey="session-alice"
			onSend={() =>
			{
			}}
			{...slash}
		/>
	);
}

function menuState()
{
	const menu = screen.queryByRole(
		"menu",
		{
			name: "Slash commands",
		},
	);
	if (menu === null) return null;
	const first = menu.firstElementChild;
	return {
		header: first?.getAttribute("role") === null ? first.textContent : null,
		labels: [...menu.querySelectorAll('[role="menuitem"]')].map(
			(row) => row.querySelector("span.min-w-0.truncate")?.textContent,
		),
	};
}

describe("useSlashCommands", () =>
{
	it("shows upstream's error header over the built-ins when /api/commands fails, and refetches on the next /", async () =>
	{
		const responses = [
			new Response(
				"boom",
				{
					status: 500,
				},
			),
			new Response(
				"boom",
				{
					status: 500,
				},
			),
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
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);
		await waitFor(() =>
		{
			expect(fetchMock).toHaveBeenCalledTimes(1);
		});
		await waitFor(() =>
		{
			expect(queryClient.getQueryState(["slash-commands", null])?.status).toBe("error");
		});

		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "/",
				},
			},
		);
		await waitFor(() =>
		{
			expect(menuState()?.header).toBe(HEADER);
		});
		const failed =
		{
			fetches: fetchMock.mock.calls.length,
			menu: menuState(),
		};

		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "",
				},
			},
		);
		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "/",
				},
			},
		);
		await waitFor(() =>
		{
			expect(menuState()?.labels).toStrictEqual(["standup"]);
		});
		const retried =
		{
			fetches: fetchMock.mock.calls.length,
			menu: menuState(),
		};

		expect(
			{
				failed,
				retried,
			},
		).toStrictEqual(
			{
				failed:
				{
					fetches: 2,
					menu:
					{
						header: HEADER,
						labels: BUILTIN_SLASH_COMMANDS.map((command) => command.name),
					},
				},
				retried:
				{
					fetches: 3,
					menu:
					{
						header: null,
						labels: ["standup"],
					},
				},
			},
		);
	});

	it("replaces the list with upstream's single skeleton row while /api/commands is pending", async () =>
	{
		let resolve: (response: Response) => void = () =>
		{
		};
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(
				async () =>
					new Promise<Response>((r) =>
					{
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
		const textarea = screen.getByRole<HTMLTextAreaElement>(
			"textbox",
			{
				name: "Prompt",
			},
		);

		fireEvent.change(
			textarea,
			{
				target:
				{
					value: "/",
				},
			},
		);
		const menu = screen.getByRole(
			"menu",
			{
				name: "Slash commands",
			},
		);
		const loading =
		{
			children: [...menu.children].map((child) => child.outerHTML),
			menuitems: menu.querySelectorAll('[role="menuitem"]').length,
			status: within(menu).getByRole("status").textContent,
		};

		resolve(Response.json(LOADED));
		await waitFor(() =>
		{
			expect(menuState()?.labels).toStrictEqual(["standup"]);
		});

		expect(loading).toStrictEqual(
			{
				children: [
					'<div data-testid="slash-loading-row"><div data-skeleton-group="" data-motion="wave" data-hold="none" data-hold-reason="overlay" role="status"><span class="sr-only">Loading</span><div aria-hidden="true" class="contents"><div class="flex h-7 items-center gap-2 px-2.5"><div data-skeleton="" class="max-w-full rounded bg-[var(--skeleton-base)]" style="width: 120px; height: 16px;"></div></div></div></div></div>',
				],
				menuitems: 0,
				status: "Loading",
			},
		);
	});

	it("shows upstream's not-running header over the built-ins when the session directory is unknown", () =>
	{
		const fetchMock = vi.fn<typeof fetch>(async () => Promise.resolve(Response.json(LOADED)));
		vi.stubGlobal("fetch", fetchMock);
		function DisabledHarness()
		{
			const slash = useSlashCommands(undefined, false);
			return (
				<Composer
					compactSlashMenu={false}
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					{...slash}
				/>
			);
		}
		render(
			<QueryClientProvider client={new QueryClient()}>
				<DisabledHarness />
			</QueryClientProvider>,
		);

		fireEvent.change(
			screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			),
			{
				target:
				{
					value: "/",
				},
			},
		);

		expect(
			{
				fetches: fetchMock.mock.calls.length,
				menu: menuState(),
			},
		).toStrictEqual(
			{
				fetches: 0,
				menu:
				{
					header: "More commands available once the session is running",
					labels: BUILTIN_SLASH_COMMANDS.map((command) => command.name),
				},
			},
		);
	});

	it("passes the loaded list through without a header", async () =>
	{
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
		await waitFor(() =>
		{
			expect(queryClient.getQueryState(["slash-commands", null])?.status).toBe("success");
		});

		fireEvent.change(
			screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			),
			{
				target:
				{
					value: "/",
				},
			},
		);

		expect(menuState()).toStrictEqual(
			{
				header: null,
				labels: ["standup"],
			},
		);
	});

	it("adds the session-only built-ins (/rewind, /autocompact, /status) to a session's list but not the home composer's", async () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () => Promise.resolve(Response.json(LOADED))),
		);
		function SessionHarness({session}: {session: boolean})
		{
			const slash = useSlashCommands(undefined, true, session);
			return (
				<Composer
					compactSlashMenu={false}
					variant="session"
					draftKey="k"
					onSend={() =>
					{
					}}
					{...slash}
				/>
			);
		}
		const queryClient = new QueryClient();
		const view = render(
			<QueryClientProvider client={queryClient}>
				<SessionHarness session={false} />
			</QueryClientProvider>,
		);
		await waitFor(() =>
		{
			expect(queryClient.getQueryState(["slash-commands", null])?.status).toBe("success");
		});
		const textarea = () =>
			screen.getByRole<HTMLTextAreaElement>(
				"textbox",
				{
					name: "Prompt",
				},
			);
		fireEvent.change(
			textarea(),
			{
				target:
				{
					value: "/",
				},
			},
		);
		const home = menuState();
		view.rerender(
			<QueryClientProvider client={queryClient}>
				<SessionHarness session />
			</QueryClientProvider>,
		);
		fireEvent.change(
			textarea(),
			{
				target:
				{
					value: "",
				},
			},
		);
		fireEvent.change(
			textarea(),
			{
				target:
				{
					value: "/",
				},
			},
		);
		const session = menuState();
		fireEvent.change(
			textarea(),
			{
				target:
				{
					value: "/autoc",
				},
			},
		);
		const autoc = [...screen.getAllByRole("menuitem")].map((row) => row.textContent);

		expect(
			{
				home,
				session,
				autoc,
			},
		).toStrictEqual(
			{
				home:
				{
					header: null,
					labels: ["standup"],
				},
				session:
				{
					header: null,
					labels: [
						"rewind",
						"autocompact",
						"status",
						"advisor",
						"output-style",
						"memory",
						"standup",
						"autocompact",
						"rewind",
						"advisor",
						"status",
						"memory",
					],
				},
				autoc: ["autocompact", "autocompactCustom command"],
			},
		);
	});

	it("lists the session-only built-ins ahead of the built-ins, and the CLI's own twins after, when the session directory is unknown", () =>
	{
		const {result} = renderHook(
			() => useSlashCommands(undefined, false, true),
			{
				wrapper: ({children}) => (
					<QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
				),
			},
		);

		expect(result.current.slashCommands?.map((command) => command.name)).toStrictEqual([
			...[...SESSION_SLASH_COMMANDS, ...BUILTIN_SLASH_COMMANDS].map((command) => command.name),
			"autocompact",
			"effort",
			"fast",
			"permissions",
			"rewind",
			"workflows",
			"btw",
			"usage",
			"advisor",
			"status",
			"memory",
			"mcp",
		]);
	});

	it("inserts the CLI's own built-in twins before the plugin entries, gated on fast, and leaves the home list alone", async () =>
	{
		const personal: SlashCommand =
		{
			name: "standup",
			description: "Write my standup",
			source: "personal-skill",
		};
		const plugin: SlashCommand =
		{
			name: "tools:lint",
			description: "Lint",
			source: "plugin-skill",
			pluginName: "tools",
		};
		vi.stubGlobal(
			"fetch",
			vi.fn<typeof fetch>(async () =>
				Promise.resolve(Response.json([...BUILTIN_SLASH_COMMANDS, personal, plugin])),
			),
		);
		const queryClient = new QueryClient();
		const ctx =
		{
			effortLevels: ["low", "medium", "high", "xhigh", "max"],
			fastListed: true,
		};
		const {result, rerender} = renderHook(
			({fastListed, session}: {fastListed: boolean; session: boolean}) =>
				useSlashCommands(
					undefined,
					true,
					session,
					{
						...ctx,
						fastListed,
					},
				).slashCommands,
			{
				initialProps:
				{
					fastListed: true,
					session: true,
				},
				wrapper: ({children}) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
			},
		);
		await waitFor(() =>
		{
			expect(result.current).not.toBeUndefined();
		});
		const list = result.current ?? [];
		const label = (c: SlashCommand) => (c.shadowsHost === true ? `${c.name}:cli` : c.name);
		const listed = list.map(label);
		const fas = filterSlashCommands(list, "fas").map(label);
		const allowed = filterSlashCommands(list, "allowed").map(label);
		const effortTwin = list.find((c) => c.name === "effort" && c.shadowsHost === true);
		rerender(
			{
				fastListed: false,
				session: true,
			},
		);
		const noFast = (result.current ?? []).filter((c) => c.shadowsHost === true).map((c) => c.name);
		rerender(
			{
				fastListed: true,
				session: false,
			},
		);
		const home = (result.current ?? []).filter((c) => c.shadowsHost === true);

		expect(
			{
				listed,
				fas,
				allowed,
				effortTwin,
				noFast,
				home,
			},
		).toStrictEqual(
			{
				listed: [
					...[...SESSION_SLASH_COMMANDS, ...BUILTIN_SLASH_COMMANDS].map((c) => c.name),
					"standup",
					"autocompact:cli",
					"effort:cli",
					"fast:cli",
					"permissions:cli",
					"rewind:cli",
					"workflows:cli",
					"btw:cli",
					"usage:cli",
					"advisor:cli",
					"status:cli",
					"memory:cli",
					"mcp:cli",
					"tools:lint",
				],
				fas: ["fast", "fast:cli"],
				allowed: ["permissions"],
				effortTwin:
				{
					name: "effort",
					description: "Set effort level for model usage",
					source: "builtin",
					argumentHint: "[low|medium|high|xhigh|max|auto]",
					shadowsHost: true,
				},
				noFast: [
					"autocompact",
					"effort",
					"permissions",
					"rewind",
					"workflows",
					"btw",
					"usage",
					"advisor",
					"status",
					"memory",
					"mcp",
				],
				home: [],
			},
		);
	});
});
