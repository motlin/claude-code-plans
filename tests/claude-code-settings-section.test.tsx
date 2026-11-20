// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {SettingsProvider} from "../src/components/settings-provider";
import {ClaudeCodeSettings} from "../src/components/settings/settings-sections";
import {ThemeProvider} from "../src/components/theme-provider";
import type {ClaudeCodeSettingsState} from "../src/lib/claude-code-settings-schema";
import type {OutputStyles} from "../src/lib/output-style-options";
import {installLocalStorage} from "./fake-storage";

interface Posted
{
	key: string;
	value?: unknown;
	expectedMtimeMs: number | null;
}

/** A fake /api/claude-code-settings: GET serves `state`; each POST waits for a test-controlled reply. */
function fakeEndpoint(
	initial: ClaudeCodeSettingsState,
	styles: OutputStyles =
	{
		builtIns: ["Explanatory", "Learning"],
		customs: [],
	},
	autoArchiveDays = 0,
)
{
	let state = initial;
	const posts: Posted[] = [];
	const archivePuts: unknown[] = [];
	const pending: Array<(reply: "ok" | "conflict" | "fail") => void> = [];
	const json = (body: unknown, status = 200) =>
		new Response(
			JSON.stringify(body),
			{
				status,
				headers:
				{
					"Content-Type": "application/json",
				},
			},
		);

	const fetchMock = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async (input, init) =>
	{
		if (input.endsWith("/api/output-styles")) return json(styles);
		if (input.endsWith("/api/auto-archive"))
		{
			if (init?.method === "PUT")
			{
				const body = JSON.parse(String(init.body)) as
				{
					days: number;
				};
				archivePuts.push(body);
				autoArchiveDays = body.days;
			}
			return json(
				{
					days: autoArchiveDays,
				},
			);
		}
		if (!input.endsWith("/api/claude-code-settings")) return new Promise<Response>(() => {});
		if (init?.method !== "POST") return json(state);
		const body = JSON.parse(String(init.body)) as Posted;
		posts.push(body);
		return new Promise<Response>((resolve) =>
		{
			pending.push((reply) =>
			{
				if (reply === "conflict")
				{
					resolve(json(state, 409));
					return;
				}
				if (reply === "fail")
				{
					resolve(
						json(
							{
								error: "boom",
							},
							422,
						),
					);
					return;
				}
				const others = Object.entries(state.values).filter(([key]) => key !== body.key);
				const values = Object.fromEntries(
					body.value === undefined ? others : [...others, [body.key, body.value]],
				) as ClaudeCodeSettingsState["values"];
				state =
				{
					...state,
					mtimeMs: (state.mtimeMs ?? 0) + 1,
					values,
				};
				resolve(json(state));
			});
		});
	});

	return {
		fetchMock,
		posts,
		archivePuts,
		/** Answer the index-th POST once it has been sent (writes go out on a microtask). */
		async reply(index: number, reply: "ok" | "conflict" | "fail")
		{
			await waitFor(() =>
			{
				expect(pending.length).toBeGreaterThan(index);
			});
			await act(async () =>
			{
				pending[index]?.(reply);
				await Promise.resolve();
			});
		},
	};
}

let queryClient: QueryClient;

/** Wait until the GET has answered and the rows no longer read Loading…. */
async function settled()
{
	await waitFor(() =>
	{
		expect(switchIn("local-sandbox").disabled).toBeNull();
	});
}

async function renderTab()
{
	queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	render(
		<QueryClientProvider client={queryClient}>
			<ThemeProvider>
				<SettingsProvider>
					<ClaudeCodeSettings />
				</SettingsProvider>
			</ThemeProvider>
		</QueryClientProvider>,
	);
	await act(async () => {});
}

function row(slug: string): HTMLElement
{
	const element = document.querySelector<HTMLElement>(`[data-settings-row="${slug}"]`);
	if (element === null) throw new Error(`no row ${slug}`);
	return element;
}

function switchIn(slug: string)
{
	const element = within(row(slug)).getByRole("switch");
	return {
		element,
		checked: element.getAttribute("aria-checked"),
		disabled: element.getAttribute("aria-disabled"),
	};
}

beforeEach(() =>
{
	installLocalStorage();
	vi.stubGlobal(
		"matchMedia",
		vi.fn(() => (
		{
			matches: false,
			addEventListener: () =>
			{
			},
			removeEventListener: () =>
			{
			},
		})),
	);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

describe("Claude Code settings ▸ Sessions", () =>
{
	it("renders upstream's merged groups: Appearance + Sessions behavior, then Local development, then Remote Control last", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values: {},
				},
			).fetchMock,
		);
		await renderTab();
		await settled();

		const rowsOf = (section: Element | null) =>
			[...(section?.querySelectorAll<HTMLElement>("[data-settings-row]") ?? [])].map((r) => (
			{
				slug: r.dataset["settingsRow"],
				title: r.querySelector(".settings-row-title")?.textContent,
				description: r.querySelector("[data-settings-desc]")?.textContent,
			}));
		const shape = (element: Element): unknown =>
			element.tagName === "SECTION"
				?
					{
						section: element.id,
						heading: element.querySelector("h3")?.textContent,
						rows: rowsOf(element).map((r) => r.slug),
					}
				:
					{
						testId: element.getAttribute("data-testid"),
						className: element.className,
						children: [...element.children].map(shape),
					};
		const mergeGroup =
			"mb-10 empty:hidden [&>section+section>[data-settings-group-header]]:hidden [&>section+section]:-mt-10 [&>section+section]:border-t [&>section+section[data-settings-section-titled]]:border-alpha-1";
		const panel = document.querySelector("[data-testid=settle-code-sections]")?.parentElement;

		expect(
			{
				layout: [...(panel?.children ?? [])].map(shape),
				legacySection: document.querySelector("section#local-sessions"),
				behavior: rowsOf(document.querySelector("section#local-sessions-behavior")),
				local: rowsOf(document.querySelector("section#local-sessions-local")),
			},
		).toStrictEqual(
			{
				layout: [
					{
						testId: "settle-code-sections",
						className: "flow-root",
						children: [
							{
								testId: null,
								className: mergeGroup,
								children: [
									{
										section: "appearance",
										heading: "Appearance",
										rows: ["default-transcript-view"],
									},
									{
										section: "local-sessions-behavior",
										heading: "Sessions",
										rows: ["dynamic-workflows", "switch-models-local", "output-style"],
									},
								],
							},
						],
					},
					{
						testId: "settle-code-sections-rest",
						className: "flow-root mt-10 empty:hidden",
						children: [
							{
								testId: null,
								className: mergeGroup,
								children: [
									{
										section: "local-sessions-local",
										heading: "Local development",
										rows: [
											"allow-bypass-permissions-mode",
											"archive-inactive-sessions",
											"local-sandbox",
											"strict-sandbox-mode",
										],
									},
								],
							},
							{
								section: "remote-control",
								heading: "Remote Control",
								rows: ["connect-new-sessions-to-remote-control"],
							},
						],
					},
				],
				legacySection: null,
				behavior: [
					{
						slug: "dynamic-workflows",
						title: "Dynamic workflows",
						description: "Let Claude run several agents at once on complex tasks. Uses your limit faster.",
					},
					{
						slug: "switch-models-local",
						title: "Switch models in Claude Code on this computer",
						description:
							"When a message is flagged, switch without asking. When off, Claude asks first, or stops if it can’t ask.",
					},
					{
						slug: "output-style",
						title: "Output style",
						description: "How Claude structures its responses in new Code sessions.",
					},
				],
				local: [
					{
						slug: "allow-bypass-permissions-mode",
						title: "Allow bypass permissions mode",
						description:
							"Bypass all permission checks and let Claude work uninterrupted. This works well for workflows like fixing lint errors or generating boilerplate code. Letting Claude run arbitrary commands is risky and can result in data loss, system corruption, or data exfiltration (e.g., via prompt injection attacks). See best practices for safe usage(opens in new tab)",
					},
					{
						slug: "archive-inactive-sessions",
						title: "Archive inactive sessions",
						description:
							"Archive sessions after a stretch with no activity. Running sessions and uncommitted changes are kept.",
					},
					{
						slug: "local-sandbox",
						title: "Local sandbox",
						description: "Runs commands from Claude Code in an isolated sandbox. Applies to new sessions.",
					},
					{
						slug: "strict-sandbox-mode",
						title: "Strict sandbox mode",
						description:
							"Blocks commands that can’t run inside the sandbox (ssh, for example) instead of running them outside it or asking you. Applies to every Claude Code session on this computer, including the terminal, unless a project’s own settings override it.",
					},
				],
			},
		);
	});

	it("links the bypass description to the security best practices in a new tab", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values: {},
				},
			).fetchMock,
		);
		await renderTab();
		await settled();

		const link = within(row("allow-bypass-permissions-mode")).getByRole(
			"link",
			{
				name: "See best practices for safe usage",
				description: "(opens in new tab)",
			},
		);
		const span = link.querySelector(".sr-only[hidden]");
		expect(
			{
				text: link.textContent,
				href: link.getAttribute("href"),
				target: link.getAttribute("target"),
				rel: link.getAttribute("rel"),
				srOnly: span?.textContent,
				describedBy: span !== null && link.getAttribute("aria-describedby") === span.id,
			},
		).toStrictEqual(
			{
				text: "See best practices for safe usage(opens in new tab)",
				href: "https://code.claude.com/docs/en/security",
				target: "_blank",
				rel: "noopener",
				srOnly: "(opens in new tab)",
				describedBy: true,
			},
		);
	});

	it("disables the controls and reads Loading… while settings load", async () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);
		await renderTab();

		expect(
			["allow-bypass-permissions-mode", "dynamic-workflows", "switch-models-local", "local-sandbox"].map(
				(slug) => (
				{
					disabled: switchIn(slug).disabled,
					description: row(slug).querySelector("[data-settings-desc]")?.textContent,
				}),
			),
		).toStrictEqual([
			{
				disabled: "true",
				description: "Loading…",
			},
			{
				disabled: "true",
				description: "Loading…",
			},
			{
				disabled: "true",
				description: "Loading…",
			},
			{
				disabled: "true",
				description: "Loading…",
			},
		]);
	});

	it("reflects the file: bypass and sandbox on only when true, workflows and switch models on unless false", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values:
					{
						skipDangerousModePermissionPrompt: true,
						enableWorkflows: false,
						switchModelsOnFlag: false,
						"sandbox.enabled": true,
					},
				},
			).fetchMock,
		);
		await renderTab();

		await waitFor(() =>
		{
			expect(
				["allow-bypass-permissions-mode", "dynamic-workflows", "switch-models-local", "local-sandbox"].map(
					(slug) => switchIn(slug).checked,
				),
			).toStrictEqual(["true", "false", "false", "true"]);
		});
	});

	it("shows switch models on when settings.json has switchModelsOnFlag true", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values:
					{
						switchModelsOnFlag: true,
					},
				},
			).fetchMock,
		);
		await renderTab();
		await settled();

		expect(switchIn("switch-models-local").checked).toBe("true");
	});

	it("defaults to bypass off, workflows on, switch models on and sandbox off", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: null,
					values: {},
				},
			).fetchMock,
		);
		await renderTab();

		await waitFor(() =>
		{
			expect(
				["allow-bypass-permissions-mode", "dynamic-workflows", "switch-models-local", "local-sandbox"].map(
					(slug) => (
					{
						checked: switchIn(slug).checked,
						disabled: switchIn(slug).disabled,
					}),
				),
			).toStrictEqual([
				{
					checked: "false",
					disabled: null,
				},
				{
					checked: "true",
					disabled: null,
				},
				{
					checked: "true",
					disabled: null,
				},
				{
					checked: "false",
					disabled: null,
				},
			]);
		});
	});

	it("writes skipDangerousModePermissionPrompt: true on, delete off, and refreshes the composer defaults", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 5,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("allow-bypass-permissions-mode").disabled).toBeNull();
		});
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");

		fireEvent.click(switchIn("allow-bypass-permissions-mode").element);
		expect(switchIn("allow-bypass-permissions-mode").checked).toBe("true");
		await endpoint.reply(0, "ok");
		await waitFor(() =>
		{
			expect(switchIn("allow-bypass-permissions-mode").checked).toBe("true");
		});

		fireEvent.click(switchIn("allow-bypass-permissions-mode").element);
		await waitFor(() =>
		{
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");
		await waitFor(() =>
		{
			expect(switchIn("allow-bypass-permissions-mode").checked).toBe("false");
		});

		expect(
			{
				posts: endpoint.posts,
				composerInvalidated: invalidate.mock.calls.some(
					([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(["composer-defaults"]),
				),
			},
		).toStrictEqual(
			{
				posts: [
					{
						key: "skipDangerousModePermissionPrompt",
						value: true,
						expectedMtimeMs: 5,
					},
					{
						key: "skipDangerousModePermissionPrompt",
						expectedMtimeMs: 6,
					},
				],
				composerInvalidated: true,
			},
		);
	});

	it("locks the bypass switch with Managed by your organization when the mode is disabled", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values: {},
					bypassPermissionsModeDisabled: true,
				},
			).fetchMock,
		);
		await renderTab();

		await waitFor(() =>
		{
			expect(switchIn("allow-bypass-permissions-mode").disabled).toBe("true");
		});
		expect(within(row("allow-bypass-permissions-mode")).getByText("Managed by your organization")).toBeTruthy();
	});

	it("writes enableWorkflows false when turned off and deletes it when turned back on", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("dynamic-workflows").disabled).toBeNull();
		});

		fireEvent.click(switchIn("dynamic-workflows").element);
		await endpoint.reply(0, "ok");
		await waitFor(() =>
		{
			expect(switchIn("dynamic-workflows").checked).toBe("false");
		});
		fireEvent.click(switchIn("dynamic-workflows").element);
		await waitFor(() =>
		{
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");

		expect(endpoint.posts).toStrictEqual([
			{
				key: "enableWorkflows",
				value: false,
				expectedMtimeMs: 1,
			},
			{
				key: "enableWorkflows",
				expectedMtimeMs: 2,
			},
		]);
	});

	it("writes switchModelsOnFlag false when turned off and deletes it when turned back on", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("switch-models-local").disabled).toBeNull();
		});

		fireEvent.click(switchIn("switch-models-local").element);
		expect(switchIn("switch-models-local").checked).toBe("false");
		await endpoint.reply(0, "ok");
		await waitFor(() =>
		{
			expect(switchIn("switch-models-local").checked).toBe("false");
		});
		fireEvent.click(switchIn("switch-models-local").element);
		await waitFor(() =>
		{
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");
		await waitFor(() =>
		{
			expect(switchIn("switch-models-local").checked).toBe("true");
		});

		expect(endpoint.posts).toStrictEqual([
			{
				key: "switchModelsOnFlag",
				value: false,
				expectedMtimeMs: 1,
			},
			{
				key: "switchModelsOnFlag",
				expectedMtimeMs: 2,
			},
		]);
	});

	it("reverts a refused switch models write and shows Couldn’t save this setting. under its row", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("switch-models-local").disabled).toBeNull();
		});

		fireEvent.click(switchIn("switch-models-local").element);
		await endpoint.reply(0, "conflict");

		await waitFor(() =>
		{
			expect(screen.getByRole("alert").textContent).toBe("Couldn’t save this setting.");
		});
		expect(
			{
				checked: switchIn("switch-models-local").checked,
				inRow: row("switch-models-local").contains(screen.getByRole("alert")),
			},
		).toStrictEqual(
			{
				checked: "true",
				inRow: true,
			},
		);
	});

	it("writes sandbox.enabled true and false", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("local-sandbox").disabled).toBeNull();
		});

		fireEvent.click(switchIn("local-sandbox").element);
		await endpoint.reply(0, "ok");
		await waitFor(() =>
		{
			expect(switchIn("local-sandbox").checked).toBe("true");
		});
		fireEvent.click(switchIn("local-sandbox").element);
		await waitFor(() =>
		{
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");

		expect(endpoint.posts).toStrictEqual([
			{
				key: "sandbox.enabled",
				value: true,
				expectedMtimeMs: 1,
			},
			{
				key: "sandbox.enabled",
				value: false,
				expectedMtimeMs: 2,
			},
		]);
	});

	it("reverts a refused write and shows Couldn’t save this setting. under the row", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("local-sandbox").disabled).toBeNull();
		});

		fireEvent.click(switchIn("local-sandbox").element);
		expect(switchIn("local-sandbox").checked).toBe("true");
		await endpoint.reply(0, "conflict");

		await waitFor(() =>
		{
			expect(screen.getByRole("alert").textContent).toBe("Couldn’t save this setting.");
		});
		const alert = screen.getByRole("alert");
		expect(
			{
				checked: switchIn("local-sandbox").checked,
				alertParent: alert.parentElement?.className,
				rowClass: row("local-sandbox").className.includes("flex-col"),
				inRow: row("local-sandbox").contains(alert),
			},
		).toStrictEqual(
			{
				checked: "false",
				alertParent: "text-footnote text-danger",
				rowClass: true,
				inRow: true,
			},
		);
	});

	it("ignores an older write's response once a newer write supersedes it", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("dynamic-workflows").disabled).toBeNull();
		});

		// Off, then back on before the first write answers: the first one fails, but the
		// newer write is the one the row shows, so no alert appears and the switch stays on.
		fireEvent.click(switchIn("dynamic-workflows").element);
		fireEvent.click(switchIn("dynamic-workflows").element);
		expect(switchIn("dynamic-workflows").checked).toBe("true");
		await endpoint.reply(0, "fail");
		await waitFor(() =>
		{
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");

		await waitFor(() =>
		{
			expect(
				{
					checked: switchIn("dynamic-workflows").checked,
					alerts: screen.queryAllByRole("alert").length,
				},
			).toStrictEqual(
				{
					checked: "true",
					alerts: 0,
				},
			);
		});
	});

	it("indents Strict sandbox mode and keeps it off and disabled until Local sandbox is on", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values: {},
				},
			).fetchMock,
		);
		await renderTab();
		await settled();

		expect(
			{
				checked: switchIn("strict-sandbox-mode").checked,
				disabled: switchIn("strict-sandbox-mode").disabled,
				reason: row("strict-sandbox-mode").querySelector("[data-cds-disabled-reason]")?.textContent,
				indented: row("strict-sandbox-mode").classList.contains("ps-lg"),
				parentIndented: row("local-sandbox").classList.contains("ps-lg"),
			},
		).toStrictEqual(
			{
				checked: "false",
				disabled: "true",
				reason: "Available when Local sandbox is on",
				indented: true,
				parentIndented: false,
			},
		);
	});

	it.each<[boolean | undefined, string]>([
		[undefined, "false"],
		[true, "false"],
		[false, "true"],
	])("shows Strict sandbox mode for allowUnsandboxedCommands %s as checked %s", async (allow, checked) =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values:
					{
						"sandbox.enabled": true,
						...(allow === undefined
							? {}
							:
								{
									"sandbox.allowUnsandboxedCommands": allow,
								}),
					},
				},
			).fetchMock,
		);
		await renderTab();
		await settled();

		await waitFor(() =>
		{
			expect(
				{
					checked: switchIn("strict-sandbox-mode").checked,
					disabled: switchIn("strict-sandbox-mode").disabled,
					reason: row("strict-sandbox-mode").querySelector("[data-cds-disabled-reason]"),
				},
			).toStrictEqual(
				{
					checked,
					disabled: null,
					reason: null,
				},
			);
		});
	});

	it("writes sandbox.allowUnsandboxedCommands false when strict turns on and true when it turns off", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values:
				{
					"sandbox.enabled": true,
				},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("strict-sandbox-mode").disabled).toBeNull();
		});

		fireEvent.click(switchIn("strict-sandbox-mode").element);
		await endpoint.reply(0, "ok");
		await waitFor(() =>
		{
			expect(switchIn("strict-sandbox-mode").checked).toBe("true");
		});
		fireEvent.click(switchIn("strict-sandbox-mode").element);
		await waitFor(() =>
		{
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");

		expect(endpoint.posts).toStrictEqual([
			{
				key: "sandbox.allowUnsandboxedCommands",
				value: false,
				expectedMtimeMs: 1,
			},
			{
				key: "sandbox.allowUnsandboxedCommands",
				value: true,
				expectedMtimeMs: 2,
			},
		]);
	});

	it("reverts a failed Strict sandbox mode write and shows the alert inside the indented row", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values:
				{
					"sandbox.enabled": true,
				},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("strict-sandbox-mode").disabled).toBeNull();
		});

		fireEvent.click(switchIn("strict-sandbox-mode").element);
		await endpoint.reply(0, "fail");

		await waitFor(() =>
		{
			expect(screen.getByRole("alert").textContent).toBe("Couldn’t save this setting.");
		});
		const strict = row("strict-sandbox-mode");
		expect(
			{
				checked: switchIn("strict-sandbox-mode").checked,
				inRow: strict.contains(screen.getByRole("alert")),
				column: strict.classList.contains("flex-col"),
				indented: strict.classList.contains("ps-lg"),
			},
		).toStrictEqual(
			{
				checked: "false",
				inRow: true,
				column: true,
				indented: true,
			},
		);
	});
});

describe("Claude Code settings ▸ row chrome", () =>
{
	function chrome(slug: string)
	{
		const element = row(slug);
		return {
			dot: element.querySelector("[data-testid=setting-modified-dot]")?.getAttribute("aria-label") ?? null,
			badge:
				element.querySelector("span.inline-flex.h-5.items-center.gap-1\\.5 [data-cds=Badge]")?.textContent ??
				null,
			reset: element.querySelector("button[data-cds=Button]")?.getAttribute("aria-label") ?? null,
		};
	}

	it("dots each settings.json row changed from the CLI default, and Reset deletes the key", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values:
				{
					skipDangerousModePermissionPrompt: true,
					enableWorkflows: false,
					outputStyle: "Explanatory",
					remoteControlAtStartup: false,
				},
			},
			undefined,
			7,
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await settled();
		await waitFor(() =>
		{
			expect(chrome("archive-inactive-sessions").dot).not.toBeNull();
		});
		const slugs = [
			"allow-bypass-permissions-mode",
			"dynamic-workflows",
			"switch-models-local",
			"local-sandbox",
			"output-style",
			"archive-inactive-sessions",
			"connect-new-sessions-to-remote-control",
		];
		const before = Object.fromEntries(slugs.map((slug) => [slug, chrome(slug)]));

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Reset Allow bypass permissions mode to default",
				},
			),
		);
		await endpoint.reply(0, "ok");

		expect(
			{
				before,
				posted: endpoint.posts[0],
				after: chrome("allow-bypass-permissions-mode"),
			},
		).toStrictEqual(
			{
				before:
				{
					"allow-bypass-permissions-mode":
					{
						dot: "Changed from the default (Off)",
						badge: null,
						reset: "Reset Allow bypass permissions mode to default",
					},
					"dynamic-workflows":
					{
						dot: "Changed from the default (On)",
						badge: null,
						reset: "Reset Dynamic workflows to default",
					},
					"switch-models-local":
					{
						dot: null,
						badge: null,
						reset: null,
					},
					"local-sandbox":
					{
						dot: null,
						badge: null,
						reset: null,
					},
					"output-style":
					{
						dot: "Changed from the default (Default)",
						badge: null,
						reset: "Reset Output style to default",
					},
					"archive-inactive-sessions":
					{
						dot: "Changed from the default (Never)",
						badge: null,
						reset: "Reset Archive inactive sessions to default",
					},
					// A written false equals the CLI default (off), so the row is not modified.
					"connect-new-sessions-to-remote-control":
					{
						dot: null,
						badge: null,
						reset: null,
					},
				},
				posted:
				{
					key: "skipDangerousModePermissionPrompt",
					expectedMtimeMs: 1,
				},
				after:
				{
					dot: null,
					badge: null,
					reset: null,
				},
			},
		);
	});

	it("resets Remote Control by deleting remoteControlAtStartup and Archive inactive sessions to Never", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values:
				{
					remoteControlAtStartup: true,
				},
			},
			undefined,
			7,
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await settled();
		await waitFor(() =>
		{
			expect(chrome("archive-inactive-sessions").dot).not.toBeNull();
		});

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Reset Connect new sessions to Remote Control to default",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Reset Archive inactive sessions to default",
				},
			),
		);
		await endpoint.reply(0, "ok");
		await waitFor(() =>
		{
			expect(chrome("archive-inactive-sessions").dot).toBeNull();
		});

		expect(
			{
				posts: endpoint.posts,
				archivePuts: endpoint.archivePuts,
				remote: chrome("connect-new-sessions-to-remote-control"),
			},
		).toStrictEqual(
			{
				posts: [
					{
						key: "remoteControlAtStartup",
						expectedMtimeMs: 1,
					},
				],
				archivePuts: [
					{
						days: 0,
					},
				],
				remote:
				{
					dot: null,
					badge: null,
					reset: null,
				},
			},
		);
	});

	it("keeps the dot when a Reset write is refused, with the write-failure alert under the row", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values:
				{
					"sandbox.enabled": true,
				},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await settled();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Reset Local sandbox to default",
				},
			),
		);
		await endpoint.reply(0, "fail");
		await waitFor(() =>
		{
			expect(screen.getByRole("alert").textContent).toBe("Couldn’t save this setting.");
		});

		expect(
			{
				chrome: chrome("local-sandbox"),
				alertInRow: row("local-sandbox").contains(screen.getByRole("alert")),
			},
		).toStrictEqual(
			{
				chrome:
				{
					dot: "Changed from the default (Off)",
					badge: null,
					reset: "Reset Local sandbox to default",
				},
				alertInRow: true,
			},
		);
	});

	it("shows Managed instead of the dot and Reset when bypass is disabled by policy", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values:
					{
						skipDangerousModePermissionPrompt: true,
					},
					bypassPermissionsModeDisabled: true,
				},
			).fetchMock,
		);
		await renderTab();
		await settled();

		expect(chrome("allow-bypass-permissions-mode")).toStrictEqual(
			{
				dot: null,
				badge: "Managed",
				reset: null,
			},
		);
	});
});

describe("Claude Code settings ▸ Remote Control", () =>
{
	it("renders section#remote-control last with one Connect new sessions switch row", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values: {},
				},
			).fetchMock,
		);
		await renderTab();
		await settled();

		const section = document.querySelector<HTMLElement>("section#remote-control");
		expect(
			{
				heading: section?.querySelector("h3")?.textContent,
				nextSection: section?.nextElementSibling ?? null,
				rows: [...(section?.querySelectorAll<HTMLElement>("[data-settings-row]") ?? [])].map((r) => (
				{
					slug: r.dataset["settingsRow"],
					title: r.querySelector(".settings-row-title")?.textContent,
					description: r.querySelector("[data-settings-desc]")?.textContent,
					switches: within(r).getAllByRole("switch").length,
				})),
			},
		).toStrictEqual(
			{
				heading: "Remote Control",
				nextSection: null,
				rows: [
					{
						slug: "connect-new-sessions-to-remote-control",
						title: "Connect new sessions to Remote Control",
						description: "Pick up new sessions from other devices.",
						switches: 1,
					},
				],
			},
		);
	});

	it("is on only when remoteControlAtStartup is true", async () =>
	{
		for (const [values, expected] of [
			[
				{
					remoteControlAtStartup: true,
				},
				"true",
			],
			[
				{
					remoteControlAtStartup: false,
				},
				"false",
			],
			[{}, "false"],
		] as const)
		{
			vi.stubGlobal(
				"fetch",
				fakeEndpoint(
					{
						mtimeMs: 1,
						values,
					},
				).fetchMock,
			);
			await renderTab();
			await waitFor(() =>
			{
				expect(
					{
						checked: switchIn("connect-new-sessions-to-remote-control").checked,
						disabled: switchIn("connect-new-sessions-to-remote-control").disabled,
					},
				).toStrictEqual(
					{
						checked: expected,
						disabled: null,
					},
				);
			});
			cleanup();
		}
	});

	it("disables the switch and reads Loading… while settings load", async () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);
		await renderTab();

		expect(
			{
				disabled: switchIn("connect-new-sessions-to-remote-control").disabled,
				description: row("connect-new-sessions-to-remote-control").querySelector("[data-settings-desc]")
					?.textContent,
			},
		).toStrictEqual(
			{
				disabled: "true",
				description: "Loading…",
			},
		);
	});

	it("writes remoteControlAtStartup true on and false (not a delete) off", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await waitFor(() =>
		{
			expect(switchIn("connect-new-sessions-to-remote-control").disabled).toBeNull();
		});

		fireEvent.click(switchIn("connect-new-sessions-to-remote-control").element);
		expect(switchIn("connect-new-sessions-to-remote-control").checked).toBe("true");
		await endpoint.reply(0, "ok");
		await waitFor(() =>
		{
			expect(switchIn("connect-new-sessions-to-remote-control").checked).toBe("true");
		});
		fireEvent.click(switchIn("connect-new-sessions-to-remote-control").element);
		await waitFor(() =>
		{
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");
		await waitFor(() =>
		{
			expect(switchIn("connect-new-sessions-to-remote-control").checked).toBe("false");
		});

		expect(endpoint.posts).toStrictEqual([
			{
				key: "remoteControlAtStartup",
				value: true,
				expectedMtimeMs: 1,
			},
			{
				key: "remoteControlAtStartup",
				value: false,
				expectedMtimeMs: 2,
			},
		]);
	});
});

describe("Claude Code settings ▸ Sessions ▸ Output style", () =>
{
	function trigger(): HTMLElement
	{
		return within(row("output-style")).getByRole("combobox");
	}

	function openOptions()
	{
		fireEvent.click(trigger());
		return within(row("output-style"))
			.getAllByRole("option")
			.map((option) => (
			{
				label: option.textContent,
				selected: option.getAttribute("aria-selected"),
				disabled: option.getAttribute("aria-disabled"),
			}));
	}

	function pick(label: string)
	{
		fireEvent.click(trigger());
		fireEvent.click(
			within(row("output-style")).getByRole(
				"option",
				{
					name: label,
				},
			),
		);
	}

	async function stylesLoaded()
	{
		await settled();
		await waitFor(() =>
		{
			expect(trigger().getAttribute("aria-disabled")).toBeNull();
		});
	}

	it("offers Default, the built-ins and the custom styles in a 160px select", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values: {},
				},
				{
					builtIns: ["Explanatory", "Learning"],
					customs: ["Terse"],
				},
			).fetchMock,
		);
		await renderTab();
		await stylesLoaded();

		expect(
			{
				trigger: trigger().textContent,
				width: trigger().closest(".w-\\[160px\\]") !== null,
				options: openOptions(),
			},
		).toStrictEqual(
			{
				trigger: "Default",
				width: true,
				options: [
					{
						label: "Default",
						selected: "true",
						disabled: null,
					},
					{
						label: "Explanatory",
						selected: "false",
						disabled: null,
					},
					{
						label: "Learning",
						selected: "false",
						disabled: null,
					},
					{
						label: "Terse",
						selected: "false",
						disabled: null,
					},
				],
			},
		);
	});

	it("disables the select and reads Loading… while settings load", async () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);
		await renderTab();

		expect(
			{
				disabled: trigger().getAttribute("aria-disabled"),
				description: row("output-style").querySelector("[data-settings-desc]")?.textContent,
			},
		).toStrictEqual(
			{
				disabled: "true",
				description: "Loading…",
			},
		);
	});

	it("appends an uninstalled current style as a disabled item and shows it as the value", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values:
					{
						outputStyle: "Gone",
					},
				},
			).fetchMock,
		);
		await renderTab();
		await stylesLoaded();

		expect(
			{
				trigger: trigger().textContent,
				options: openOptions(),
			},
		).toStrictEqual(
			{
				trigger: "Gone",
				options: [
					{
						label: "Default",
						selected: "false",
						disabled: null,
					},
					{
						label: "Explanatory",
						selected: "false",
						disabled: null,
					},
					{
						label: "Learning",
						selected: "false",
						disabled: null,
					},
					{
						label: "Gone",
						selected: "true",
						disabled: "true",
					},
				],
			},
		);
	});

	it("writes the picked style, and deletes the key when Default is picked", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await stylesLoaded();

		pick("Explanatory");
		expect(trigger().textContent).toBe("Explanatory");
		await endpoint.reply(0, "ok");
		await waitFor(() =>
		{
			expect(trigger().textContent).toBe("Explanatory");
		});
		pick("Default");
		await waitFor(() =>
		{
			expect(endpoint.posts).toHaveLength(2);
		});
		await endpoint.reply(1, "ok");
		await waitFor(() =>
		{
			expect(trigger().textContent).toBe("Default");
		});

		expect(endpoint.posts).toStrictEqual([
			{
				key: "outputStyle",
				value: "Explanatory",
				expectedMtimeMs: 1,
			},
			{
				key: "outputStyle",
				expectedMtimeMs: 2,
			},
		]);
	});

	it("does not write when the picked style is already the current one", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values:
				{
					outputStyle: "default",
				},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await stylesLoaded();

		pick("Default");
		await act(async () => {});

		expect(endpoint.posts).toStrictEqual([]);
	});
});

describe("Claude Code settings ▸ Sessions ▸ Archive inactive sessions", () =>
{
	function trigger(): HTMLElement
	{
		return within(row("archive-inactive-sessions")).getByRole("combobox");
	}

	function openOptions()
	{
		fireEvent.click(trigger());
		return within(row("archive-inactive-sessions"))
			.getAllByRole("option")
			.map((option) => (
			{
				label: option.textContent,
				selected: option.getAttribute("aria-selected"),
			}));
	}

	async function loaded()
	{
		await waitFor(() =>
		{
			expect(trigger().getAttribute("aria-disabled")).toBeNull();
		});
	}

	it("offers Never through 30 days in a 160px select, defaulting to Never", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values: {},
				},
			).fetchMock,
		);
		await renderTab();
		await loaded();

		expect(
			{
				trigger: trigger().textContent,
				width: trigger().closest(".w-\\[160px\\]") !== null,
				options: openOptions(),
			},
		).toStrictEqual(
			{
				trigger: "Never",
				width: true,
				options: [
					{
						label: "Never",
						selected: "true",
					},
					{
						label: "1 day",
						selected: "false",
					},
					{
						label: "2 days",
						selected: "false",
					},
					{
						label: "7 days",
						selected: "false",
					},
					{
						label: "14 days",
						selected: "false",
					},
					{
						label: "30 days",
						selected: "false",
					},
				],
			},
		);
	});

	it("inserts a stored non-listed value in sorted order and shows it", async () =>
	{
		vi.stubGlobal(
			"fetch",
			fakeEndpoint(
				{
					mtimeMs: 1,
					values: {},
				},
				undefined,
				3,
			).fetchMock,
		);
		await renderTab();
		await loaded();

		expect(
			{
				trigger: trigger().textContent,
				options: openOptions().map((option) => option.label),
			},
		).toStrictEqual(
			{
				trigger: "3 days",
				options: ["Never", "1 day", "2 days", "3 days", "7 days", "14 days", "30 days"],
			},
		);
	});

	it("disables the select and reads Loading… while the setting loads", async () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);
		await renderTab();

		expect(
			{
				disabled: trigger().getAttribute("aria-disabled"),
				description: row("archive-inactive-sessions").querySelector("[data-settings-desc]")?.textContent,
			},
		).toStrictEqual(
			{
				disabled: "true",
				description: "Loading…",
			},
		);
	});

	it("saves the picked window and does not save an unchanged pick", async () =>
	{
		const endpoint = fakeEndpoint(
			{
				mtimeMs: 1,
				values: {},
			},
		);
		vi.stubGlobal("fetch", endpoint.fetchMock);
		await renderTab();
		await loaded();

		fireEvent.click(trigger());
		fireEvent.click(
			within(row("archive-inactive-sessions")).getByRole(
				"option",
				{
					name: "Never",
				},
			),
		);
		fireEvent.click(trigger());
		fireEvent.click(
			within(row("archive-inactive-sessions")).getByRole(
				"option",
				{
					name: "7 days",
				},
			),
		);
		await waitFor(() =>
		{
			expect(trigger().textContent).toBe("7 days");
		});

		expect(endpoint.archivePuts).toStrictEqual([
			{
				days: 7,
			},
		]);
	});
});
