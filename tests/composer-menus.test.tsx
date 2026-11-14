// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, fireEvent, render, screen, waitFor, within} from "@testing-library/react";
import type {useNavigate} from "@tanstack/react-router";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {Composer} from "../src/components/composer";
import {CompactScope} from "./fizzy-lake-off";
import {FileMentionMenu} from "../src/components/file-mention-menu";
import {customizeMcpServersQueryOptions, type McpServerSummary} from "../src/lib/api/customize";
import {toConnectorSlug} from "../src/lib/customize/mcp-tool-permissions";
import type {ComposerState} from "../src/lib/composer-state";
import type {LiveLaunchControls} from "../src/hooks/use-live-launch-options";
import type {LaunchOptions} from "../src/lib/launch-options";

const navigate = vi.hoisted(() => vi.fn<ReturnType<typeof useNavigate>>());
vi.mock("@tanstack/react-router", async (importOriginal) => (
{
	...(await importOriginal<typeof import("@tanstack/react-router")>()),
	useNavigate: () => navigate,
}));

const MAC_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const CHIN: ComposerState =
{
	mode:
	{
		id: "default",
		label: "Manual",
	},
	model: "Opus 5.5",
	modelId: "claude-opus-5-5",
	settingsModelId: "claude-opus-5-5",
	fastMode: false,
	fastModeBlocked: null,
	effort:
	{
		id: "high",
		label: "High",
	},
	usage: null,
};

type OnSend = (prompt: string, launchOptions: LaunchOptions) => void;

function renderComposer(
	extra:
	{
		bypassPermissionsAllowed?: boolean;
		live?: LiveLaunchControls;
		chin?: ComposerState;
	} = {},
)
{
	const onSend = vi.fn<OnSend>();
	// The composer sits in the compact main column.
	render(
		<CompactScope>
			<Composer variant="session" draftKey="session-alice" onSend={onSend} chin={CHIN} {...extra} />
		</CompactScope>,
	);
	return onSend;
}

function press(init: KeyboardEventInit)
{
	fireEvent.keyDown(document.activeElement ?? document.body, init);
}

const openModeMenu = () =>
{
	press(
		{
			key: "µ",
			code: "KeyM",
			metaKey: true,
			altKey: true,
		},
	);
};
const openModelMenu = () =>
{
	press(
		{
			key: "I",
			code: "KeyI",
			metaKey: true,
			shiftKey: true,
		},
	);
};
const openEffort = () =>
{
	press(
		{
			key: "E",
			code: "KeyE",
			metaKey: true,
			shiftKey: true,
		},
	);
};

function sendPrompt(text: string)
{
	const textarea = screen.getByRole(
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
				value: text,
			},
		},
	);
	fireEvent.keyDown(
		textarea,
		{
			key: "Enter",
		},
	);
}

async function pickEffort(name: RegExp)
{
	openEffort();
	await waitFor(() =>
	{
		expect(screen.getAllByRole("menu")).toHaveLength(2);
	});
	const submenu = screen.getAllByRole("menu")[1];
	if (submenu === undefined) throw new Error("no Effort submenu");
	fireEvent.click(
		within(submenu).getByRole(
			"menuitemradio",
			{
				name,
			},
		),
	);
}

function radioRows(menu: HTMLElement)
{
	return within(menu)
		.getAllByRole("menuitemradio")
		.map((item) => (
		{
			label: item.querySelector("[data-menu-item-label]")?.textContent,
			description: item.querySelector("[data-menu-item-description]")?.textContent ?? null,
			key: item.getAttribute("aria-keyshortcuts"),
			checked: item.getAttribute("aria-checked"),
		}));
}

/** Upstream's two-line row bottom pad: (h-control − body size − footnote leading + footnote size) / 2. */
const TWO_LINE_PB =
	"pb-[calc((var(--cds-h-control)-var(--upstream-text-body)-var(--upstream-leading-footnote)+var(--upstream-text-footnote))/2)]";
/** Upstream's 500-weight footnote menu header. */
const MENU_HEADER = "px-2 comfortable:px-2.5 py-1 text-footnote font-medium text-[var(--menu-muted)]";

beforeEach(() =>
{
	vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
});

afterEach(() =>
{
	cleanup();
	localStorage.clear();
	vi.restoreAllMocks();
});

describe("Composer mode menu", () =>
{
	it("opens on ⌥⌘M with the upstream local-session items and digit keycaps", async () =>
	{
		renderComposer();

		openModeMenu();
		const menu = await screen.findByRole("menu");

		expect(radioRows(menu)).toStrictEqual([
			{
				label: "Auto",
				description: "Claude handles permission decisions",
				key: "1",
				checked: "false",
			},
			{
				label: "Manual",
				description: "Always ask before making changes",
				key: "2",
				checked: "true",
			},
			{
				label: "Accept edits",
				description: "Automatically accept all file edits",
				key: "3",
				checked: "false",
			},
			{
				label: "Plan",
				description: "Create a plan before making changes",
				key: "4",
				checked: "false",
			},
		]);
	});

	it("renders upstream's two-line rows: label over a wrapping description, trailing pinned to the first line", async () =>
	{
		renderComposer();

		openModeMenu();
		const menu = await screen.findByRole("menu");
		const popup = menu.closest("[data-cds]");
		const rows = within(menu)
			.getAllByRole("menuitemradio")
			.map((item) =>
			{
				const classes = item.className.split(" ");
				return {
					twoLine: classes.includes("items-start"),
					singleLine: classes.includes("h-6"),
					paddedBottom: classes.includes(TWO_LINE_PB),
					description: item.querySelector("[data-menu-item-description]")?.className,
					trailing: item.querySelector("[data-menu-item-trailing]")?.className,
				};
			});

		const row =
		{
			twoLine: true,
			singleLine: false,
			paddedBottom: true,
			description: "break-words text-footnote text-[var(--menu-muted)]",
			trailing: "flex shrink-0 items-center gap-1.5 ms-3 h-[1lh] self-start",
		};
		expect(
			{
				rows,
				fixedWidth: popup?.classList.contains("w-[280px]"),
			},
		).toStrictEqual(
			{
				rows: [row, row, row, row],
				fixedWidth: false,
			},
		);
	});

	it("picks an item with its digit, closes the menu, and sends it as a launch option", async () =>
	{
		const onSend = renderComposer();

		openModeMenu();
		fireEvent.keyDown(
			await screen.findByRole("menu"),
			{
				key: "3",
				code: "Digit3",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const readout = document.querySelector("[data-chin-mode]")?.textContent;
		sendPrompt("Continue Alice's test");

		expect(
			{
				readout,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				readout: "Accept edits",
				calls: [
					[
						"Continue Alice's test",
						{
							permissionMode: "acceptEdits",
						},
					],
				],
			},
		);
	});

	it("offers Bypass permissions only when settings allow it", async () =>
	{
		renderComposer();
		openModeMenu();
		const withoutBypass = radioRows(await screen.findByRole("menu")).map((row) => row.label);
		cleanup();

		renderComposer(
			{
				bypassPermissionsAllowed: true,
			},
		);
		openModeMenu();
		const bypass = within(await screen.findByRole("menu")).getByRole(
			"menuitemradio",
			{
				name: /Bypass permissions/,
			},
		);

		expect(
			{
				withoutBypass,
				variant: bypass.getAttribute("data-variant"),
			},
		).toStrictEqual(
			{
				withoutBypass: ["Auto", "Manual", "Accept edits", "Plan"],
				variant: "warning",
			},
		);
	});
});

const BYPASS_DIALOG_TEXT =
	"Bypass all permissions?Claude will read, edit, and execute files without asking — including potentially destructive commands. Only use this in isolated or disposable environments./wYou won’t be asked again for this workspace. Read our security guide(opens in new tab) for details.CancelBypass permissions";
const AUTO_DIALOG_TEXT =
	"Enable auto mode?Claude will decide which actions are safe to run without asking. Longer tasks run uninterrupted, with extra safeguards against prompt injection./wYou won’t be asked again. Read our security guide(opens in new tab) for details.CancelEnable auto mode";

describe("Composer mode menu consent guard", () =>
{
	interface Consent
	{
		autoModeIsDefault: boolean;
		autoConsented: boolean;
		acks: string[];
	}

	/** A session composer in `cwd` over a stubbed consent store; returns the sends and the store's POST bodies. */
	function renderGuarded({
		consent =
		{
			autoModeIsDefault: false,
			autoConsented: false,
			acks: [],
		},
		cwd = "/w",
		live,
	}:
	{
		consent?: Consent;
		cwd?: string;
		live?: LiveLaunchControls;
	} = {})
	{
		let stored = consent;
		const posts: unknown[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) =>
		{
			if (String(input) !== "/api/permission-mode-consent") throw new Error(`unexpected fetch ${String(input)}`);
			if (init?.method === "POST")
			{
				const body = JSON.parse(String(init.body)) as
				{
					mode: string;
					workspace: string;
				};
				posts.push(body);
				stored =
					body.mode === "auto"
						?
							{
								...stored,
								autoConsented: true,
							}
						:
							{
								...stored,
								acks: [...stored.acks, `${body.workspace}:bypassPermissions`],
							};
			}
			return Promise.resolve(Response.json(stored));
		});
		const onSend = vi.fn<OnSend>();
		const queryClient = new QueryClient(
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
				<CompactScope>
					<Composer
						variant="session"
						draftKey="session-erin"
						onSend={onSend}
						chin={CHIN}
						bypassPermissionsAllowed
						permissionCwd={cwd}
						{...(live === undefined
							? {}
							:
								{
									live,
								})}
					/>
				</CompactScope>
			</QueryClientProvider>,
		);
		return {
			onSend,
			posts,
		};
	}

	async function pickMode(name: RegExp)
	{
		openModeMenu();
		fireEvent.click(
			within(await screen.findByRole("menu")).getByRole(
				"menuitemradio",
				{
					name,
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
	}

	const readout = () => document.querySelector("[data-chin-mode]")?.textContent;

	it("asks before the first Bypass in a folder, stores the ack on confirm, then applies the pick", async () =>
	{
		const {onSend, posts} = renderGuarded();
		await pickMode(/Bypass permissions/);
		const dialog = await screen.findByRole("alertdialog");
		const text = dialog.textContent;
		const before = readout();
		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Bypass permissions",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});
		await waitFor(() =>
		{
			expect(posts).toHaveLength(1);
		});
		sendPrompt("Continue Erin's test");

		expect(
			{
				text,
				before,
				after: readout(),
				posts,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				text: BYPASS_DIALOG_TEXT,
				before: "Manual",
				after: "Bypass",
				posts: [
					{
						mode: "bypassPermissions",
						workspace: "/w",
					},
				],
				calls: [
					[
						"Continue Erin's test",
						{
							permissionMode: "bypassPermissions",
						},
					],
				],
			},
		);
	});

	it("applies Bypass at once in an acked folder and in its worktrees, but asks again in another folder", async () =>
	{
		const consent =
		{
			autoModeIsDefault: true,
			autoConsented: false,
			acks: ["/w:bypassPermissions"],
		};
		renderGuarded(
			{
				consent,
			},
		);
		await pickMode(/Bypass permissions/);
		await waitFor(() =>
		{
			expect(readout()).toBe("Bypass");
		});
		const acked = screen.queryByRole("alertdialog");
		cleanup();

		renderGuarded(
			{
				consent,
				cwd: "/w/.claude/worktrees/feat",
			},
		);
		await pickMode(/Bypass permissions/);
		await waitFor(() =>
		{
			expect(readout()).toBe("Bypass");
		});
		const worktree = screen.queryByRole("alertdialog");
		cleanup();

		renderGuarded(
			{
				consent,
				cwd: "/other",
			},
		);
		await pickMode(/Bypass permissions/);
		const other = await screen.findByRole("alertdialog");

		expect(
			{
				acked,
				worktree,
				other: other.textContent.includes("/other"),
			},
		).toStrictEqual(
			{
				acked: null,
				worktree: null,
				other: true,
			},
		);
	});

	it("asks before Auto unless auto is the default or already consented", async () =>
	{
		const {posts} = renderGuarded();
		await pickMode(/^Auto/);
		const dialog = await screen.findByRole("alertdialog");
		const text = dialog.textContent;
		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Enable auto mode",
				},
			),
		);
		await waitFor(() =>
		{
			expect(posts).toHaveLength(1);
		});
		const confirmed = readout();
		cleanup();

		renderGuarded(
			{
				consent:
				{
					autoModeIsDefault: true,
					autoConsented: false,
					acks: [],
				},
			},
		);
		await pickMode(/^Auto/);
		await waitFor(() =>
		{
			expect(readout()).toBe("Auto");
		});
		const asDefault = screen.queryByRole("alertdialog");
		cleanup();

		renderGuarded(
			{
				consent:
				{
					autoModeIsDefault: false,
					autoConsented: true,
					acks: [],
				},
			},
		);
		await pickMode(/^Auto/);
		await waitFor(() =>
		{
			expect(readout()).toBe("Auto");
		});

		expect(
			{
				text,
				posts,
				confirmed,
				asDefault,
				consented: screen.queryByRole("alertdialog"),
			},
		).toStrictEqual(
			{
				text: AUTO_DIALOG_TEXT,
				posts: [
					{
						mode: "auto",
						workspace: "/w",
					},
				],
				confirmed: "Auto",
				asDefault: null,
				consented: null,
			},
		);
	});

	it("keeps the previous mode on Cancel and stores nothing", async () =>
	{
		const {onSend, posts} = renderGuarded();
		await pickMode(/Bypass permissions/);
		fireEvent.click(
			within(await screen.findByRole("alertdialog")).getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});
		sendPrompt("Continue Frank's test");

		expect(
			{
				readout: readout(),
				posts,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				readout: "Manual",
				posts: [],
				calls: [["Continue Frank's test", {}]],
			},
		);
	});

	it("holds a live pane's mode change until the consent is confirmed", async () =>
	{
		const apply = vi.fn<LiveLaunchControls["apply"]>(async () => {});
		renderGuarded(
			{
				live:
				{
					options: {},
					apply,
				},
			},
		);
		await pickMode(/Bypass permissions/);
		const dialog = await screen.findByRole("alertdialog");
		const whileAsking = [...apply.mock.calls];
		fireEvent.click(
			within(dialog).getByRole(
				"button",
				{
					name: "Bypass permissions",
				},
			),
		);
		await waitFor(() =>
		{
			expect(apply).toHaveBeenCalled();
		});

		expect(
			{
				whileAsking,
				applied: apply.mock.calls,
			},
		).toStrictEqual(
			{
				whileAsking: [],
				applied: [
					[
						{
							permissionMode: "bypassPermissions",
						},
					],
				],
			},
		);
	});
});

function renderHomeComposer()
{
	render(
		<CompactScope>
			<Composer
				variant="home"
				draftKey="home-dana"
				onSend={vi.fn<OnSend>()}
				chin={CHIN}
				environment={<span>Dana's project</span>}
			/>
		</CompactScope>,
	);
}

describe("Composer home bar permissions menu", () =>
{
	function hoverTooltip(trigger: Element): string | null
	{
		const anchor = trigger.parentElement;
		if (anchor === null) throw new Error("trigger has no parent");
		fireEvent.pointerEnter(anchor);
		act(() =>
		{
			vi.advanceTimersByTime(400);
		});
		const text = screen.queryByRole("tooltip")?.textContent ?? null;
		fireEvent.pointerLeave(anchor);
		return text;
	}

	it("labels the home bar menu Permissions · this session with no digit keycaps", async () =>
	{
		renderHomeComposer();

		openModeMenu();
		const menu = await screen.findByRole("menu");

		expect(
			{
				labelText: within(menu).queryByText("Permissions · this session")?.textContent ?? null,
				accelerators: menu.querySelectorAll("[data-accelerator]").length,
				rows: radioRows(menu),
			},
		).toStrictEqual(
			{
				labelText: "Permissions · this session",
				accelerators: 0,
				rows: [
					{
						label: "Auto",
						description: "Claude handles permission decisions",
						key: null,
						checked: "false",
					},
					{
						label: "Manual",
						description: "Always ask before making changes",
						key: null,
						checked: "true",
					},
					{
						label: "Accept edits",
						description: "Automatically accept all file edits",
						key: null,
						checked: "false",
					},
					{
						label: "Plan",
						description: "Create a plan before making changes",
						key: null,
						checked: "false",
					},
				],
			},
		);
	});

	it("names the home bar trigger Permissions: {mode} with the Permissions ⌥⌘M tooltip", () =>
	{
		vi.useFakeTimers();
		try
		{
			renderHomeComposer();
			const trigger = screen.getByRole(
				"button",
				{
					name: "Permissions: Manual",
				},
			);

			expect(
				{
					text: trigger.textContent,
					tooltip: hoverTooltip(trigger),
				},
			).toStrictEqual(
				{
					text: "Manual",
					tooltip: "Permissions⌥Option⌘CommandM",
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("keeps the session chin menu labelled Mode with digits and no aria-label", async () =>
	{
		renderComposer();

		openModeMenu();
		const menu = await screen.findByRole("menu");

		expect(
			{
				mode: within(menu).queryByText("Mode")?.textContent ?? null,
				permissions: within(menu).queryByText("Permissions · this session"),
				accelerators: menu.querySelectorAll("[data-accelerator]").length,
				ariaLabel: document.querySelector("[data-chin-mode]")?.getAttribute("aria-label") ?? null,
			},
		).toStrictEqual(
			{
				mode: "Mode",
				permissions: null,
				accelerators: 4,
				ariaLabel: null,
			},
		);
	});
});

describe("Composer home bar model menu", () =>
{
	function modelHeader(menu: HTMLElement)
	{
		const label = within(menu).queryByText("Model · this session");
		const wrapper = label?.parentElement;
		return label === null || wrapper === null || wrapper === undefined
			? null
			:
				{
					role: label.getAttribute("role"),
					labelClass: label.className,
					wrapperClass: wrapper.className,
					insideScroller: wrapper.closest("[data-menu-scroller]") !== null,
				};
	}

	it("pins upstream's Model · this session header above the scroller", async () =>
	{
		renderHomeComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");

		expect(modelHeader(menu)).toStrictEqual(
			{
				role: "presentation",
				labelClass: MENU_HEADER,
				wrapperClass: "shrink-0 px-1 pt-1",
				insideScroller: false,
			},
		);
	});

	it("has no header in a session chin", async () =>
	{
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");

		expect(modelHeader(menu)).toBeNull();
	});

	it("opens the model menu on ⇧⌘E with the Effort submenu closed", async () =>
	{
		renderHomeComposer();

		openEffort();
		const menu = await screen.findByRole("menu");

		expect(
			{
				menus: screen.getAllByRole("menu").length,
				firstRow: radioRows(menu)[0]?.label,
				effortExpanded:
					within(menu)
						.getByRole(
							"menuitem",
							{
								name: /Effort/,
							},
						)
						.getAttribute("aria-expanded") ?? "false",
			},
		).toStrictEqual(
			{
				menus: 1,
				firstRow: "Opus 5.5",
				effortExpanded: "false",
			},
		);
	});
});

describe("Composer model menu", () =>
{
	it("opens on ⇧⌘I with versioned labels, the checked row's ✓ in place of its digit, and a More models submenu", async () =>
	{
		const onSend = renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const rows = radioRows(menu).map(({label, key, checked}) => (
		{
			label,
			key,
			checked,
		}));
		const more = within(menu).getByRole(
			"menuitem",
			{
				name: /More models/,
			},
		).textContent;
		fireEvent.keyDown(
			menu,
			{
				key: "2",
				code: "Digit2",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const trigger = screen
			.getByRole(
				"button",
				{
					name: /^Model:/,
				},
			)
			.getAttribute("aria-label");
		sendPrompt("Continue Carol's test");

		expect(
			{
				rows,
				more,
				trigger,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				rows: [
					{
						label: "Opus 5.5",
						key: "1",
						checked: "true",
					},
					{
						label: "Fable 5.1",
						key: "2",
						checked: "false",
					},
					{
						label: "Sonnet 5.5",
						key: "3",
						checked: "false",
					},
					{
						label: "Haiku 5.5",
						key: "4",
						checked: "false",
					},
				],
				more: "More models",
				trigger: "Model: Fable 5.1 High",
				calls: [
					[
						"Continue Carol's test",
						{
							model: "fable",
						},
					],
				],
			},
		);
	});

	it("puts each Model row's digit inside its check slot, as upstream's Bp rows", async () =>
	{
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const slots = within(menu)
			.getAllByRole("menuitemradio")
			.map((item) =>
			{
				const trailing = item.querySelector("[data-menu-item-trailing]");
				return {
					count: trailing?.children.length,
					slot: trailing?.firstElementChild?.className,
					text: trailing?.textContent,
				};
			});

		const slot = "-me-1 flex size-4 shrink-0 items-center justify-center";
		expect(slots).toStrictEqual([
			{
				count: 1,
				slot,
				text: "",
			},
			{
				count: 1,
				slot,
				text: "2",
			},
			{
				count: 1,
				slot,
				text: "3",
			},
			{
				count: 1,
				slot,
				text: "4",
			},
		]);
	});

	it("numbers the rows around a checked middle row and picks the row a digit names", async () =>
	{
		const onSend = renderComposer(
			{
				chin:
				{
					...CHIN,
					model: "Fable 5.1",
					modelId: "claude-fable-5-1",
				},
			},
		);

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const rows = radioRows(menu).map(({label, key}) => (
		{
			label,
			key,
		}));
		const text = within(menu)
			.getAllByRole("menuitemradio")
			.map((item) => item.textContent);
		fireEvent.keyDown(
			menu,
			{
				key: "3",
				code: "Digit3",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Erin's test");

		expect(
			{
				rows,
				text,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				rows: [
					{
						label: "Opus 5.5",
						key: "1",
					},
					{
						label: "Fable 5.1",
						key: "2",
					},
					{
						label: "Sonnet 5.5",
						key: "3",
					},
					{
						label: "Haiku 5.5",
						key: "4",
					},
				],
				text: ["Opus 5.51", "Fable 5.1", "Sonnet 5.53", "Haiku 5.54"],
				calls: [
					[
						"Continue Erin's test",
						{
							model: "sonnet",
						},
					],
				],
			},
		);
	});

	it("keeps the checked row's digit live: pressing 1 on the checked Opus row closes the menu", async () =>
	{
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const opus = within(menu).getByRole(
			"menuitemradio",
			{
				name: /^Opus/,
			},
		);
		const attrs =
		{
			key: opus.getAttribute("aria-keyshortcuts"),
			number: opus.getAttribute("data-accelerator"),
		};
		fireEvent.keyDown(
			menu,
			{
				key: "1",
				code: "Digit1",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});

		expect(attrs).toStrictEqual(
			{
				key: "1",
				number: "1",
			},
		);
	});

	it("matches the digit by e.code, so a Numpad 3 picks Sonnet", async () =>
	{
		const onSend = renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		fireEvent.keyDown(
			menu,
			{
				key: "3",
				code: "Numpad3",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Grace's test");

		expect(onSend.mock.calls).toStrictEqual([
			[
				"Continue Grace's test",
				{
					model: "sonnet",
				},
			],
		]);
	});

	it("ignores a repeating digit key", async () =>
	{
		const onSend = renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		fireEvent.keyDown(
			menu,
			{
				key: "2",
				code: "Digit2",
				repeat: true,
			},
		);
		const stillOpen = screen.queryByRole("menu") !== null;
		const checked = radioRows(menu).find((row) => row.checked === "true")?.label;
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Heidi's test");

		expect(
			{
				stillOpen,
				checked,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				stillOpen: true,
				checked: "Opus 5.5",
				calls: [["Continue Heidi's test", {}]],
			},
		);
	});

	it("shows upstream's Fable tooltip on the left when hovering the Fable row", async () =>
	{
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const anchor = within(menu).getByRole(
			"menuitemradio",
			{
				name: /^Fable/,
			},
		).parentElement;
		if (anchor === null) throw new Error("Fable row has no tooltip anchor");
		fireEvent.pointerEnter(anchor);
		const tooltip = await screen.findByRole("tooltip");

		expect(
			{
				text: tooltip.textContent,
				side: tooltip.getAttribute("data-side"),
			},
		).toStrictEqual(
			{
				text: "Fable is the most capable model and draws down usage much faster than Opus",
				side: "left",
			},
		);
	});

	it("opens More models on hover with only the models the primary rows lack, in upstream order", async () =>
	{
		const onSend = renderComposer();

		openModelMenu();
		const subTrigger = await screen.findByRole(
			"menuitem",
			{
				name: /More models/,
			},
		);
		fireEvent.pointerEnter(
			subTrigger,
			{
				pointerType: "mouse",
			},
		);
		fireEvent.mouseEnter(subTrigger);
		fireEvent.pointerMove(
			subTrigger,
			{
				pointerType: "mouse",
			},
		);
		fireEvent.mouseMove(subTrigger);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const submenu = screen.getAllByRole("menu")[1]!;
		const labels = radioRows(submenu).map((row) => row.label);
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: "Opus 4.6",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Dave's test");

		expect(
			{
				labels,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				labels: [
					"Haiku 4.5",
					"Sonnet 5",
					"Opus 5",
					"Fable 5",
					"Opus 4.8",
					"Opus 4.7",
					"Opus 4.6",
					"Sonnet 4.6",
				],
				calls: [
					[
						"Continue Dave's test",
						{
							model: "claude-opus-4-6",
						},
					],
				],
			},
		);
	});
});

describe("Composer model menu Fast mode section", () =>
{
	async function flushMenu()
	{
		await act(async () =>
		{
			await new Promise((resolve) =>
			{
				setTimeout(resolve, 0);
			});
		});
	}

	const SWITCH_CLASS =
		"relative inline-flex h-[14px] w-[25.2px] shrink-0 rounded-full p-[2px] bg-[var(--menu-switch-track)] hover:bg-[var(--menu-switch-track-hover)] data-[checked]:bg-accent-100 data-[disabled]:opacity-40 forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText] forced-colors:p-px forced-colors:data-[checked]:border-[Highlight] forced-colors:data-[checked]:!bg-[Highlight]";

	function fastRow(menu: HTMLElement)
	{
		return within(menu).getByRole(
			"menuitemcheckbox",
			{
				name: /^Enable fast mode/,
			},
		);
	}

	function describeNode(element: Element | null | undefined): unknown
	{
		if (element === null || element === undefined) return null;
		return {
			tag: element.tagName.toLowerCase(),
			attrs: Object.fromEntries(
				Array.from(element.attributes)
					.filter((attribute) => !["id", "style", "data-base-ui-click-trigger"].includes(attribute.name))
					.map((attribute) => [attribute.name, attribute.value]),
			),
			children: Array.from(element.children).map(describeNode),
		};
	}

	/** Upstream's `kk` label nest, with the blocked row's description span as `extra`. */
	function FAST_LABEL_NEST(extra: unknown[])
	{
		return {
			tag: "span",
			attrs:
			{
				"data-menu-item-title": "",
				class: "min-w-0 flex-1 truncate",
			},
			children: [
				{
					tag: "span",
					attrs:
					{
						class: "block min-w-0 whitespace-normal",
					},
					children: [
						{
							tag: "span",
							attrs:
							{
								class: "flex min-w-0 items-center gap-1",
							},
							children: [
								{
									tag: "span",
									attrs:
									{
										class: "truncate",
									},
									children: [],
								},
							],
						},
						...extra,
					],
				},
			],
		};
	}

	const ENV_BLOCKED =
	{
		line: "Off for this session",
		reason: "An environment variable turns fast mode off in this session.",
	};

	it("greys a blocked row with upstream's second line, forced off, describing it by the reason", async () =>
	{
		const onSend = renderComposer(
			{
				chin:
				{
					...CHIN,
					fastMode: true,
					fastModeBlocked: ENV_BLOCKED,
				},
			},
		);

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const row = fastRow(menu);
		fireEvent.click(row);
		await flushMenu();
		const description = row.querySelector(".mt-1");
		sendPrompt("Continue Peggy's test");

		expect(
			{
				checked: row.getAttribute("aria-checked"),
				disabled: row.hasAttribute("data-disabled"),
				heights: row.className.split(" ").filter((c) => /^(h-|min-h-|items-|pb-)/.test(c)),
				parentRole: row.parentElement?.getAttribute("role"),
				reason: document.getElementById(row.getAttribute("aria-describedby") ?? "")?.textContent,
				labelNest: describeNode(row.firstElementChild),
				description: description?.textContent,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				checked: "false",
				disabled: true,
				heights: ["items-center"],
				parentRole: "none",
				reason: ENV_BLOCKED.reason,
				labelNest: FAST_LABEL_NEST([
					{
						tag: "span",
						attrs:
						{
							class: "mt-1 block text-footnote text-[var(--menu-muted)]",
						},
						children: [],
					},
				]),
				description: "Off for this session",
				calls: [["Continue Peggy's test", {}]],
			},
		);
	});

	it("opens the blocked row's reason tooltip on the right when hovered", async () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					fastModeBlocked: ENV_BLOCKED,
				},
			},
		);

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const wrapper = fastRow(menu).parentElement!;
		vi.useFakeTimers();
		try
		{
			fireEvent.pointerEnter(wrapper);
			act(() =>
			{
				vi.advanceTimersByTime(300);
			});
			const tip = screen.getByRole("tooltip");
			expect(
				{
					side: tip.getAttribute("data-side"),
					text: tip.textContent,
				},
			).toStrictEqual(
				{
					side: "right",
					text: ENV_BLOCKED.reason,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("gives a policy-blocked row its second line but no reason", async () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					fastModeBlocked:
					{
						line: "Not available",
					},
				},
			},
		);

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const row = fastRow(menu);

		expect(
			{
				disabled: row.hasAttribute("data-disabled"),
				describedBy: row.getAttribute("aria-describedby"),
				parentRole: row.parentElement?.getAttribute("role"),
				description: row.querySelector(".mt-1")?.textContent,
			},
		).toStrictEqual(
			{
				disabled: true,
				describedBy: null,
				parentRole: null,
				description: "Not available",
			},
		);
	});

	it("ends the menu with a separator, upstream's Fast mode header and an unchecked switch row on Opus", async () =>
	{
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const row = fastRow(menu);
		const header = row.previousElementSibling;
		const separator = header?.previousElementSibling;
		const trailing = row.lastElementChild;

		expect(
			{
				separator: separator?.getAttribute("role"),
				header:
				{
					role: header?.getAttribute("role"),
					className: header?.className,
					inner: describeNode(header?.firstElementChild),
					text: header?.textContent,
				},
				last: row.nextElementSibling,
				row:
				{
					checked: row.getAttribute("aria-checked"),
					disabled: row.hasAttribute("data-disabled"),
					describedBy: row.getAttribute("aria-describedby"),
					label: row.firstElementChild?.textContent,
					labelNest: describeNode(row.firstElementChild),
					trailingClass: trailing?.className,
				},
				wrapper: describeNode(trailing?.firstElementChild),
				switchClass: row.querySelector("[data-size]")?.className,
			},
		).toStrictEqual(
			{
				separator: "separator",
				header:
				{
					role: "presentation",
					className: MENU_HEADER,
					inner:
					{
						tag: "span",
						attrs:
						{
							class: "flex items-center gap-1",
						},
						children: [],
					},
					text: "Fast mode",
				},
				last: null,
				row:
				{
					checked: "false",
					disabled: false,
					describedBy: null,
					label: "Enable fast mode",
					labelNest: FAST_LABEL_NEST([]),
					trailingClass: "ms-3 flex shrink-0 items-center gap-1.5",
				},
				wrapper:
				{
					tag: "div",
					attrs:
					{
						"aria-hidden": "true",
						class: "pointer-events-none inline-flex items-center",
					},
					children: [
						{
							tag: "span",
							attrs:
							{
								inert: "",
								class: "inline-flex",
							},
							children: [
								{
									tag: "span",
									attrs:
									{
										role: "switch",
										tabindex: "-1",
										"aria-checked": "false",
										"data-size": "sm",
										"data-unchecked": "",
										class: SWITCH_CLASS,
									},
									children: [
										{
											tag: "span",
											attrs:
											{
												"aria-hidden": "true",
												"data-unchecked": "",
												class: expect.stringContaining("data-[checked]:translate-x-[11.2px]"),
											},
											children: [],
										},
									],
								},
							],
						},
					],
				},
				switchClass: SWITCH_CLASS,
			},
		);
	});

	it("toggles on a click with the menu kept open, and launches the next fork in fast mode", async () =>
	{
		const onSend = renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		fireEvent.click(fastRow(menu));
		await flushMenu();
		const after =
		{
			open: screen.queryByRole("menu") !== null,
			checked: fastRow(menu).getAttribute("aria-checked"),
			switchChecked: fastRow(menu).querySelector("[role=switch]")?.getAttribute("aria-checked"),
		};
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Ivan's test");

		expect(
			{
				after,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				after:
				{
					open: true,
					checked: "true",
					switchChecked: "true",
				},
				calls: [
					[
						"Continue Ivan's test",
						{
							fastMode: true,
						},
					],
				],
			},
		);
	});

	it("wraps ↑ from the first row to the Fast row, and Enter then Space toggle it with the menu open", async () =>
	{
		const onSend = renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		fireEvent.keyDown(
			menu,
			{
				key: "ArrowDown",
			},
		);
		await flushMenu();
		const first = menu.querySelector("[data-highlighted]")?.textContent;
		fireEvent.keyDown(
			menu,
			{
				key: "ArrowUp",
			},
		);
		await flushMenu();
		const highlighted = menu.querySelector("[data-highlighted]")?.textContent;
		fireEvent.keyDown(
			fastRow(menu),
			{
				key: "Enter",
			},
		);
		fireEvent.keyUp(
			fastRow(menu),
			{
				key: "Enter",
			},
		);
		await flushMenu();
		const afterEnter = fastRow(menu).getAttribute("aria-checked");
		fireEvent.keyDown(
			fastRow(menu),
			{
				key: " ",
			},
		);
		fireEvent.keyUp(
			fastRow(menu),
			{
				key: " ",
			},
		);
		await flushMenu();
		const afterSpace = fastRow(menu).getAttribute("aria-checked");
		const open = screen.queryByRole("menu") !== null;
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Judy's test");

		expect(
			{
				first,
				highlighted,
				afterEnter,
				afterSpace,
				open,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				first: "Opus 5.5",
				highlighted: "Enable fast mode",
				afterEnter: "true",
				afterSpace: "false",
				open: true,
				calls: [
					[
						"Continue Judy's test",
						{
							fastMode: false,
						},
					],
				],
			},
		);
	});

	it("has no separator, header or row on a model without fast mode", async () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					model: "Sonnet 5.5",
					modelId: "claude-sonnet-5-5",
				},
			},
		);

		openModelMenu();
		const menu = await screen.findByRole("menu");

		expect(
			{
				rows: within(menu).queryAllByRole("menuitemcheckbox").length,
				header: within(menu).queryByText("Fast mode"),
				separators: within(menu).getAllByRole("separator").length,
			},
		).toStrictEqual(
			{
				rows: 0,
				header: null,
				separators: 2,
			},
		);
	});
});

describe("Composer model trigger Fast word and live status", () =>
{
	function triggerParts()
	{
		const trigger = screen.getByRole(
			"button",
			{
				name: /^Model:/,
			},
		);
		return {
			label: trigger.getAttribute("aria-label"),
			collapse: trigger.getAttribute("data-collapse"),
			wrapper: trigger.firstElementChild?.getAttribute("class"),
			children: Array.from(trigger.firstElementChild?.children ?? []).map((child) => (
			{
				fast: child.hasAttribute("data-fast-label"),
				className: child.getAttribute("class"),
				text: child.textContent,
			})),
		};
	}

	function liveStatus()
	{
		const status = document.querySelector("[data-fast-mode-status][role=status][aria-live=polite]");
		return status === null
			? null
			:
				{
					className: status.getAttribute("class"),
					text: status.textContent,
				};
	}

	/** Upstream's chin "pill" trigger: a clipping baseline row, a name truncating to 1.5rem and a never-hidden muted tail. */
	const PILL_CLASS = "flex min-w-0 items-baseline overflow-hidden";
	const NAME_CLASS = "min-w-6 truncate";
	const TAIL_CLASS = "shrink-0 whitespace-pre text-ink-muted ms-1";

	it("puts upstream's Fast word between the model and the effort while the session is fast", () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					fastMode: true,
				},
			},
		);

		expect(
			{
				trigger: triggerParts(),
				status: liveStatus(),
			},
		).toStrictEqual(
			{
				trigger:
				{
					label: "Model: Opus 5.5 Fast High",
					collapse: "name",
					wrapper: PILL_CLASS,
					children: [
						{
							fast: false,
							className: NAME_CLASS,
							text: "Opus 5.5",
						},
						{
							fast: true,
							className: TAIL_CLASS,
							text: " Fast",
						},
						{
							fast: false,
							className: TAIL_CLASS,
							text: " High",
						},
					],
				},
				status:
				{
					className: "sr-only",
					text: "Fast mode on",
				},
			},
		);
	});

	it("has no Fast word with fast mode off, and flips the word and live status when the switch row toggles", async () =>
	{
		renderComposer();
		const before =
		{
			trigger: triggerParts(),
			status: liveStatus(),
		};

		openModelMenu();
		const menu = await screen.findByRole("menu");
		fireEvent.click(
			within(menu).getByRole(
				"menuitemcheckbox",
				{
					name: "Enable fast mode",
				},
			),
		);
		await waitFor(() =>
		{
			expect(liveStatus()?.text).toBe("Fast mode on");
		});

		expect(
			{
				before,
				after: triggerParts().label,
			},
		).toStrictEqual(
			{
				before:
				{
					trigger:
					{
						label: "Model: Opus 5.5 High",
						collapse: "name",
						wrapper: PILL_CLASS,
						children: [
							{
								fast: false,
								className: NAME_CLASS,
								text: "Opus 5.5",
							},
							{
								fast: false,
								className: TAIL_CLASS,
								text: " High",
							},
						],
					},
					status:
					{
						className: "sr-only",
						text: "Fast mode off",
					},
				},
				after: "Model: Opus 5.5 Fast High",
			},
		);
	});

	it("turns a fast session off from its switch row", async () =>
	{
		const onSend = renderComposer(
			{
				chin:
				{
					...CHIN,
					fastMode: true,
				},
			},
		);

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const checked = within(menu)
			.getByRole(
				"menuitemcheckbox",
				{
					name: "Enable fast mode",
				},
			)
			.getAttribute("aria-checked");
		fireEvent.click(
			within(menu).getByRole(
				"menuitemcheckbox",
				{
					name: "Enable fast mode",
				},
			),
		);
		await waitFor(() =>
		{
			expect(liveStatus()?.text).toBe("Fast mode off");
		});
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Mallory's test");

		expect(
			{
				checked,
				label: triggerParts().label,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				checked: "true",
				label: "Model: Opus 5.5 High",
				calls: [
					[
						"Continue Mallory's test",
						{
							fastMode: false,
						},
					],
				],
			},
		);
	});

	it("keeps the Fast word but has no live status on the new-session bar, as upstream's bar has none", () =>
	{
		renderHomeComposer();
		const bar =
		{
			label: triggerParts().label,
			status: liveStatus(),
		};
		cleanup();
		render(
			<CompactScope>
				<Composer
					variant="home"
					draftKey="home-erin"
					onSend={vi.fn<OnSend>()}
					chin={
					{
						...CHIN,
						fastMode: true,
					}}
					environment={<span>Erin's project</span>}
				/>
			</CompactScope>,
		);

		expect(
			{
				bar,
				fast:
				{
					label: triggerParts().label,
					status: liveStatus(),
				},
			},
		).toStrictEqual(
			{
				bar:
				{
					label: "Model: Opus 5.5 High",
					status: null,
				},
				fast:
				{
					label: "Model: Opus 5.5 Fast High",
					status: null,
				},
			},
		);
	});

	it("has no word on a model without fast mode, but still announces fast mode off, as upstream's chin does", () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					model: "Sonnet 5.5",
					modelId: "claude-sonnet-5-5",
					fastMode: false,
				},
			},
		);

		expect(
			{
				label: triggerParts().label,
				status: liveStatus(),
			},
		).toStrictEqual(
			{
				label: "Model: Sonnet 5.5 High",
				status:
				{
					className: "sr-only",
					text: "Fast mode off",
				},
			},
		);
	});

	it("has no word and announces fast mode off while the CLI blocks it", () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					fastMode: true,
					fastModeBlocked:
					{
						line: "Not available",
					},
				},
			},
		);

		expect(
			{
				label: triggerParts().label,
				status: liveStatus(),
			},
		).toStrictEqual(
			{
				label: "Model: Opus 5.5 High",
				status:
				{
					className: "sr-only",
					text: "Fast mode off",
				},
			},
		);
	});
});

describe("Composer effort submenu", () =>
{
	async function openEffortMenu()
	{
		openEffort();
		await waitFor(() =>
		{
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const submenu = screen.getAllByRole("menu")[1];
		if (submenu === undefined) throw new Error("no Effort submenu");
		return submenu;
	}

	function effortRows(submenu: HTMLElement)
	{
		return within(submenu)
			.getAllByRole("menuitemradio")
			.map((item) => (
			{
				id: item.getAttribute("data-effort-id"),
				recommended: item.querySelector("[data-effort-recommended]") !== null,
				warning: item.querySelector("[data-effort-warning]") !== null,
				info: item.querySelector("svg[data-effort-info-icon]")?.getAttribute("class") ?? null,
			}));
	}

	it("opens the model menu on ⇧⌘E at upstream's Effort submenu: its hint, Low … Max with the Recommended and Max chips, then the Ultracode switch", async () =>
	{
		renderComposer();
		const submenu = await openEffortMenu();
		const main = screen.getAllByRole("menu")[0];
		const ultracode = within(submenu).getByRole(
			"menuitemcheckbox",
			{
				name: "Ultracode",
			},
		);

		expect(
			{
				main: within(main!)
					.getAllByRole("menuitem")
					.map((item) => item.textContent),
				hint:
				{
					text: submenu.querySelector("[data-menu-label]")?.textContent,
					className: submenu.querySelector("[data-menu-label]")?.className,
				},
				side: submenu.getAttribute("data-side"),
				align: submenu.getAttribute("data-align"),
				rows: within(submenu)
					.getAllByRole("menuitemradio")
					.map((item) => (
					{
						id: item.getAttribute("data-effort-id"),
						label: item.querySelector("[data-menu-item-label]")?.textContent,
						labelClass: item.querySelector("[data-menu-item-label]")?.className,
						checked: item.getAttribute("aria-checked"),
					})),
				recommended: submenu.querySelector("[data-effort-recommended]")?.className,
				warning:
				{
					className: submenu.querySelector("[data-effort-warning]")?.className,
					text: submenu.querySelector("[data-effort-warning]")?.textContent,
					icon: submenu.querySelector("[data-effort-warning] svg")?.getAttribute("class"),
				},
				info: submenu.querySelector("[data-effort-info-icon]"),
				afterRadios: ultracode.previousElementSibling?.getAttribute("role"),
				ultracode:
				{
					checked: ultracode.getAttribute("aria-checked"),
					switchSize: ultracode
						.querySelector('div[aria-hidden="true"].pointer-events-none [role=switch]')
						?.getAttribute("data-size"),
				},
			},
		).toStrictEqual(
			{
				main: ["EffortHigh", "More models"],
				hint:
				{
					text: "Higher effort means more thorough responses, but takes longer and uses your limits faster.",
					className: "px-2 comfortable:px-2.5 py-1 text-footnote font-normal text-[var(--menu-muted)]",
				},
				side: "right",
				align: "end",
				rows: [
					{
						id: "low",
						label: "Low",
						labelClass: "truncate",
						checked: "false",
					},
					{
						id: "medium",
						label: "Medium",
						labelClass: "truncate",
						checked: "false",
					},
					{
						id: "high",
						label: "High",
						labelClass: "truncate",
						checked: "true",
					},
					{
						id: "xhigh",
						label: "Extra",
						labelClass: "truncate",
						checked: "false",
					},
					{
						id: "max",
						label: "Max",
						labelClass: "truncate",
						checked: "false",
					},
				],
				recommended:
					"inline-flex items-center gap-1 h-5 whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium bg-alpha-1 text-secondary",
				warning:
				{
					className:
						"inline-flex items-center gap-1 h-5 whitespace-nowrap rounded-full px-1.5 text-[11px] font-medium min-w-0 shrink bg-[var(--warning-tint)] text-warning-000",
					text: "3.5× or more usage",
					icon: "lucide lucide-triangle-exclamation-point lucide-alert-triangle lucide-triangle-alert size-3 shrink-0",
				},
				info: null,
				afterRadios: "separator",
				ultracode:
				{
					checked: "false",
					switchSize: "sm",
				},
			},
		);
	});

	it.each([
		{
			name: "Fable 5.1",
			modelId: "claude-fable-5-1",
			ids: ["low", "medium", "high", "xhigh", "max"],
			recommended: "high",
		},
		{
			name: "Opus 4.7",
			modelId: "claude-opus-4-7",
			ids: ["low", "medium", "high", "xhigh", "max"],
			recommended: "xhigh",
		},
		{
			name: "Opus 4.6",
			modelId: "claude-opus-4-6",
			ids: ["low", "medium", "high", "max"],
			recommended: "high",
		},
	])(
		"lists $name's own catalog rows: Recommended on $recommended, and a plain Max with an Info glyph",
		async ({name, modelId, ids, recommended}) =>
		{
			renderComposer(
				{
					chin:
					{
						...CHIN,
						model: name,
						modelId,
					},
				},
			);
			const submenu = await openEffortMenu();

			expect(effortRows(submenu)).toStrictEqual(
				ids.map((id) => (
				{
					id,
					recommended: id === recommended,
					warning: false,
					info: id === "max" ? "lucide lucide-info size-3 shrink-0 text-ink-muted" : null,
				})),
			);
		},
	);

	it("shows upstream's generic Max tooltip on a model without the Max warning", async () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					model: "Fable 5.1",
					modelId: "claude-fable-5-1",
				},
			},
		);
		const submenu = await openEffortMenu();
		const anchor = within(submenu).getByRole(
			"menuitemradio",
			{
				name: /^Max/,
			},
		).parentElement;
		if (anchor === null) throw new Error("Max row has no tooltip anchor");
		fireEvent.pointerEnter(anchor);
		const tooltip = await screen.findByRole("tooltip");

		expect(tooltip.textContent).toBe(
			"May use excessive tokens resulting in long response times and may hit token limits. Use sparingly for the hardest tasks.",
		);
	});

	it("opens More models to the inline end, capped at half the viewport, with each row's model id", async () =>
	{
		renderComposer();
		openModelMenu();
		const main = await screen.findByRole("menu");
		fireEvent.click(
			within(main).getByRole(
				"menuitem",
				{
					name: "More models",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const more = screen.getAllByRole("menu")[1]!;

		expect(
			{
				side: more.getAttribute("data-side"),
				capped: more.closest('[class*="max-h-[min(50vh,var(--available-height))]"]') !== null,
				primary: within(main)
					.getAllByRole("menuitemradio")
					.map((item) => item.getAttribute("data-model-id")),
				ids: within(more)
					.getAllByRole("menuitemradio")
					.map((item) => item.getAttribute("data-model-id")),
			},
		).toStrictEqual(
			{
				side: "right",
				capped: true,
				primary: ["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5", "claude-haiku-5-5"],
				ids: [
					"claude-haiku-4-5-20251001",
					"claude-sonnet-5",
					"claude-opus-5",
					"claude-fable-5",
					"claude-opus-4-8",
					"claude-opus-4-7",
					"claude-opus-4-6",
					"claude-sonnet-4-6",
				],
			},
		);
	});

	it("shows upstream's Max usage tooltip on the right when hovering the Max row", async () =>
	{
		renderComposer();
		const submenu = await openEffortMenu();
		const anchor = within(submenu).getByRole(
			"menuitemradio",
			{
				name: /^Max/,
			},
		).parentElement;
		if (anchor === null) throw new Error("Max row has no tooltip anchor");
		fireEvent.pointerEnter(anchor);
		const tooltip = await screen.findByRole("tooltip");

		expect(
			{
				text: tooltip.textContent,
				side: tooltip.getAttribute("data-side"),
			},
		).toStrictEqual(
			{
				text: "Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.",
				side: "right",
			},
		);
	});

	it("toggles Ultracode with the menu kept open, beside the effort: the trigger's pro tail, the hint and the launch", async () =>
	{
		const onSend = renderComposer();
		const submenu = await openEffortMenu();
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemcheckbox",
				{
					name: "Ultracode",
				},
			),
		);
		await waitFor(() =>
		{
			expect(
				within(submenu)
					.getByRole(
						"menuitemcheckbox",
						{
							name: "Ultracode",
						},
					)
					.getAttribute("aria-checked"),
			).toBe("true");
		});
		const main = screen.getAllByRole("menu")[0]!;
		const hint = within(main)
			.getByRole(
				"menuitem",
				{
					name: /^Effort/,
				},
			)
			.querySelector("[data-menu-value]")?.textContent;
		const menus = screen.getAllByRole("menu").length;
		fireEvent.keyDown(
			main,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const trigger = screen.getByRole(
			"button",
			{
				name: /^Model:/,
			},
		);
		sendPrompt("Continue Erin's test");

		expect(
			{
				menus,
				hint,
				name: trigger.getAttribute("aria-label"),
				tail: trigger.querySelector("[data-ultracode-label]")?.outerHTML,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				menus: 2,
				hint: "High · Ultracode",
				name: "Model: Opus 5.5 High · Ultracode",
				tail: '<span data-ultracode-label="" class="shrink-0 whitespace-pre ms-1 font-medium text-[var(--text-pro)]"> · Ultracode</span>',
				calls: [
					[
						"Continue Erin's test",
						{
							ultracode: true,
						},
					],
				],
			},
		);
	});

	it("picks an effort, closes, shows it on the shared trigger and sends it", async () =>
	{
		const onSend = renderComposer();
		const submenu = await openEffortMenu();
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: /^Extra/,
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const trigger = screen.getByRole(
			"button",
			{
				name: /^Model:/,
			},
		);
		sendPrompt("Continue Erin's test");

		expect(
			{
				name: trigger.getAttribute("aria-label"),
				text: trigger.textContent,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				name: "Model: Opus 5.5 Extra",
				text: "Opus 5.5 Extra",
				calls: [
					[
						"Continue Erin's test",
						{
							effort: "xhigh",
						},
					],
				],
			},
		);
	});

	it("drops a picked Extra when switching to a model without it", async () =>
	{
		const onSend = renderComposer();
		const submenu = await openEffortMenu();
		fireEvent.click(
			within(submenu).getByRole(
				"menuitemradio",
				{
					name: /^Extra/,
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		openModelMenu();
		const main = await screen.findByRole("menu");
		fireEvent.click(
			within(main).getByRole(
				"menuitem",
				{
					name: "More models",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		fireEvent.click(
			within(screen.getAllByRole("menu")[1]!).getByRole(
				"menuitemradio",
				{
					name: "Opus 4.6",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Erin's test");

		expect(
			{
				name: screen
					.getByRole(
						"button",
						{
							name: /^Model:/,
						},
					)
					.getAttribute("aria-label"),
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				name: "Model: Opus 4.6 High",
				calls: [
					[
						"Continue Erin's test",
						{
							model: "claude-opus-4-6",
						},
					],
				],
			},
		);
	});

	it("trails the Effort hint with a 12px warning icon at Opus 5.5's Max, and plain text otherwise", async () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					effort:
					{
						id: "max",
						label: "Max",
					},
				},
			},
		);
		openModelMenu();
		const main = await screen.findByRole("menu");
		const effort = within(main).getByRole(
			"menuitem",
			{
				name: /^Effort/,
			},
		);
		const hint = effort.querySelector("[data-effort-warning-hint]");

		expect(
			{
				className: hint?.className,
				text: hint?.textContent,
				name: hint?.firstElementChild?.className,
				icon: hint?.querySelector("svg")?.getAttribute("class"),
				plainValue: effort.querySelector("[data-menu-value]"),
			},
		).toStrictEqual(
			{
				className: "flex items-center gap-1 text-footnote text-[var(--menu-muted)]",
				text: "Max",
				name: "max-w-[160px] truncate",
				icon: "lucide lucide-triangle-exclamation-point lucide-alert-triangle lucide-triangle-alert size-3 shrink-0 text-warning-100",
				plainValue: null,
			},
		);
	});

	it("shows Fable's Max as a plain hint with no warning icon", async () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					model: "Fable 5.1",
					modelId: "claude-fable-5-1",
					effort:
					{
						id: "max",
						label: "Max",
					},
				},
			},
		);
		openModelMenu();
		const main = await screen.findByRole("menu");
		const effort = within(main).getByRole(
			"menuitem",
			{
				name: /^Effort/,
			},
		);

		expect(
			{
				hint: effort.querySelector("[data-effort-warning-hint]"),
				value: effort.querySelector("[data-menu-value]")?.textContent,
			},
		).toStrictEqual(
			{
				hint: null,
				value: "Max",
			},
		);
	});
});

describe("Composer ⌥⌘F fast mode shortcut", () =>
{
	const toggleFast = (init: KeyboardEventInit = {}) =>
	{
		press(
			{
				key: "ƒ",
				code: "KeyF",
				metaKey: true,
				altKey: true,
				...init,
			},
		);
	};
	const modelLabel = () =>
		screen
			.getByRole(
				"button",
				{
					name: /^Model:/,
				},
			)
			.getAttribute("aria-label");

	it("toggles fast mode in a session composer and ignores a held key's repeats", () =>
	{
		const onSend = renderComposer();

		toggleFast();
		const on = modelLabel();
		toggleFast(
			{
				repeat: true,
			},
		);
		toggleFast(
			{
				repeat: true,
			},
		);
		sendPrompt("Continue Frank's test");

		expect(
			{
				on,
				after: modelLabel(),
				menus: screen.queryAllByRole("menu").length,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				on: "Model: Opus 5.5 Fast High",
				after: "Model: Opus 5.5 Fast High",
				menus: 0,
				calls: [
					[
						"Continue Frank's test",
						{
							fastMode: true,
						},
					],
				],
			},
		);
	});

	it("turns a fast session off", () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					fastMode: true,
				},
			},
		);

		toggleFast();

		expect(modelLabel()).toBe("Model: Opus 5.5 High");
	});

	it("does nothing on a model without fast mode", () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					model: "Sonnet 5.5",
					modelId: "claude-sonnet-5-5",
				},
			},
		);

		toggleFast();

		expect(
			{
				label: modelLabel(),
				menus: screen.queryAllByRole("menu").length,
			},
		).toStrictEqual(
			{
				label: "Model: Sonnet 5.5 High",
				menus: 0,
			},
		);
	});

	it("does nothing while the CLI blocks fast mode", () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					fastModeBlocked:
					{
						line: "Not available",
					},
				},
			},
		);

		toggleFast();

		expect(
			{
				label: modelLabel(),
				menus: screen.queryAllByRole("menu").length,
			},
		).toStrictEqual(
			{
				label: "Model: Opus 5.5 High",
				menus: 0,
			},
		);
	});

	it("opens the Model menu on the home composer instead of toggling", async () =>
	{
		renderHomeComposer();

		toggleFast();
		await screen.findByRole("menu");

		expect(
			{
				label: modelLabel(),
				expanded: screen
					.getByRole(
						"button",
						{
							name: /^Model:/,
						},
					)
					.getAttribute("aria-expanded"),
			},
		).toStrictEqual(
			{
				label: "Model: Opus 5.5 High",
				expanded: "true",
			},
		);
	});
});

describe("Composer menu shortcuts", () =>
{
	it("are ignored while a dialog is open", () =>
	{
		renderComposer();
		render(
			<div role="dialog" aria-label="Other dialog">
				<button type="button">Inside</button>
			</div>,
		);
		screen
			.getByRole(
				"button",
				{
					name: "Inside",
				},
			)
			.focus();

		openModeMenu();
		openModelMenu();
		openEffort();

		expect(screen.queryAllByRole("menu").length).toBe(0);
	});

	it("sends no launch options until one is picked", () =>
	{
		const onSend = renderComposer();
		sendPrompt("Continue Grace's test");
		expect(onSend.mock.calls).toStrictEqual([["Continue Grace's test", {}]]);
	});
});

describe("Composer on a live pane", () =>
{
	function liveControls(options: LaunchOptions = {})
	{
		const apply = vi.fn<LiveLaunchControls["apply"]>(async () => {});
		return {
			live:
			{
				options,
				apply,
			},
			apply,
		};
	}

	it("applies a mode pick to the pane instead of storing a launch option", async () =>
	{
		const {live, apply} = liveControls();
		const onSend = renderComposer(
			{
				live,
			},
		);

		openModeMenu();
		fireEvent.keyDown(
			await screen.findByRole("menu"),
			{
				key: "4",
				code: "Digit4",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		sendPrompt("Continue Heidi's test");

		expect(
			{
				applied: apply.mock.calls,
				sends: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				applied: [
					[
						{
							permissionMode: "plan",
						},
					],
				],
				sends: [["Continue Heidi's test", {}]],
			},
		);
	});

	it("checks the session's current model in the Model menu", async () =>
	{
		const {live} = liveControls();
		renderComposer(
			{
				live,
				chin:
				{
					...CHIN,
					model: "Fable 5.1",
					modelId: "claude-fable-5-1",
				},
			},
		);

		openModelMenu();
		const menu = await screen.findByRole("menu");

		expect(
			{
				trigger: screen
					.getByRole(
						"button",
						{
							name: /^Model:/,
						},
					)
					.getAttribute("aria-label"),
				rows: radioRows(menu).map(({label, checked}) => (
				{
					label,
					checked,
				})),
			},
		).toStrictEqual(
			{
				trigger: "Model: Fable 5.1 High",
				rows: [
					{
						label: "Opus 5.5",
						checked: "false",
					},
					{
						label: "Fable 5.1",
						checked: "true",
					},
					{
						label: "Sonnet 5.5",
						checked: "false",
					},
					{
						label: "Haiku 5.5",
						checked: "false",
					},
				],
			},
		);
	});

	it("shows the live picks in the chin", () =>
	{
		const {live} = liveControls(
			{
				model: "fable",
				effort: "max",
				permissionMode: "plan",
			},
		);
		renderComposer(
			{
				live,
			},
		);

		expect(
			{
				mode: document.querySelector("[data-chin-mode]")?.textContent,
				model: screen
					.getByRole(
						"button",
						{
							name: /^Model:/,
						},
					)
					.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				mode: "Plan",
				model: "Model: Fable 5.1 Max",
			},
		);
	});

	it("asks Change effort? before sending an effort change", async () =>
	{
		const {live, apply} = liveControls();
		renderComposer(
			{
				live,
			},
		);

		await pickEffort(/^Low/);
		const confirm = await screen.findByRole("alertdialog");
		const confirmText = confirm.textContent;
		const appliedBeforeConfirm = apply.mock.calls.length;
		fireEvent.click(
			within(confirm).getByRole(
				"button",
				{
					name: "Change effort",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});

		expect(
			{
				confirmText,
				appliedBeforeConfirm,
				applied: apply.mock.calls,
			},
		).toStrictEqual(
			{
				confirmText:
					"Change effort?This session is cached with effort set to High. Changing it to Low means Claude re-reads the whole session on your next message, which uses more of your limit.CancelChange effort",
				appliedBeforeConfirm: 0,
				applied: [
					[
						{
							effort: "low",
						},
					],
				],
			},
		);
	});

	it("drops the effort change when the confirm is cancelled", async () =>
	{
		const {live, apply} = liveControls();
		renderComposer(
			{
				live,
			},
		);

		await pickEffort(/^Max/);
		const confirm = await screen.findByRole("alertdialog");
		fireEvent.click(
			within(confirm).getByRole(
				"button",
				{
					name: "Cancel",
				},
			),
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("alertdialog")).toBeNull();
		});

		expect(
			{
				applied: apply.mock.calls,
				trigger: screen
					.getByRole(
						"button",
						{
							name: /^Model:/,
						},
					)
					.getAttribute("aria-label"),
			},
		).toStrictEqual(
			{
				applied: [],
				trigger: "Model: Opus 5.5 High",
			},
		);
	});
});

describe("Composer chin tooltips and contrast", () =>
{
	function hoverTooltip(trigger: Element): string | null
	{
		const anchor = trigger.parentElement;
		if (anchor === null) throw new Error("trigger has no parent");
		fireEvent.pointerEnter(anchor);
		act(() =>
		{
			vi.advanceTimersByTime(400);
		});
		const text = screen.queryByRole("tooltip")?.textContent ?? null;
		fireEvent.pointerLeave(anchor);
		return text;
	}

	it("shows upstream's Add and Mode ⌥⌘M tooltips, and none on the model + effort trigger", () =>
	{
		vi.useFakeTimers();
		try
		{
			renderComposer();
			const tooltips =
			{
				add: hoverTooltip(
					screen.getByRole(
						"button",
						{
							name: "Add",
						},
					),
				),
				mode: hoverTooltip(document.querySelector("[data-chin-mode]") ?? document.body),
				model: hoverTooltip(
					screen.getByRole(
						"button",
						{
							name: "Model: Opus 5.5 High",
						},
					),
				),
			};

			expect(tooltips).toStrictEqual(
				{
					add: "Add",
					mode: "Mode⌥Option⌘CommandM",
					model: null,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it.each([
		{
			name: "Add",
			trigger: () =>
				screen.getByRole(
					"button",
					{
						name: "Add",
					},
				),
			tooltip: "Add",
		},
		{
			name: "Mode",
			trigger: () => document.querySelector<HTMLElement>("[data-chin-mode]") ?? document.body,
			tooltip: "Mode⌥Option⌘CommandM",
		},
	])("keeps the $name tooltip closed when focus returns from its closed menu", async ({trigger, tooltip}) =>
	{
		renderComposer();
		const button = trigger();
		const anchor = button.parentElement;
		if (anchor === null) throw new Error("trigger has no parent");
		fireEvent.pointerEnter(anchor);
		fireEvent.click(button);
		const menu = await screen.findByRole("menu");
		fireEvent.keyDown(
			menu,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});

		vi.useFakeTimers();
		try
		{
			fireEvent.pointerEnter(anchor);
			fireEvent.focus(button);
			act(() =>
			{
				vi.advanceTimersByTime(400);
			});
			const afterClose = screen.queryByRole("tooltip")?.textContent ?? null;
			fireEvent.pointerLeave(anchor);
			fireEvent.pointerEnter(anchor);
			act(() =>
			{
				vi.advanceTimersByTime(400);
			});
			const afterReentry = screen.queryByRole("tooltip")?.textContent ?? null;

			expect(
				{
					afterClose,
					afterReentry,
				},
			).toStrictEqual(
				{
					afterClose: null,
					afterReentry: tooltip,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("reads every chin control in control ink (secondary with fizzy color off), with r4 corners and an 18px +", () =>
	{
		renderComposer();
		const classes = (element: Element | null) => element?.getAttribute("class")?.split(" ") ?? [];
		const add = screen.getByRole(
			"button",
			{
				name: "Add",
			},
		);
		const pick = (element: Element | null) =>
		{
			const list = classes(element);
			return {
				ink: list.filter((name) => /^text-(primary|secondary|secondary-control)$/.test(name)),
				radius: list.filter((name) => name.startsWith("rounded")),
				lineHeight: list.filter((name) => name.startsWith("leading")),
			};
		};

		expect(
			{
				add: pick(add),
				plusIcon: classes(add.querySelector("svg")).filter((name) => name.startsWith("size-")),
				mode: pick(document.querySelector("[data-chin-mode]")),
				model: pick(
					screen.getByRole(
						"button",
						{
							name: "Model: Opus 5.5 High",
						},
					),
				),
			},
		).toStrictEqual(
			{
				add:
				{
					ink: ["text-secondary-control"],
					radius: ["rounded-r5"],
					lineHeight: ["leading-[20px]"],
				},
				plusIcon: ["size-[18px]"],
				mode:
				{
					ink: ["text-secondary-control"],
					radius: ["rounded-r4"],
					lineHeight: ["leading-[20px]"],
				},
				model:
				{
					ink: ["text-secondary-control"],
					radius: ["rounded-r4"],
					lineHeight: ["leading-[20px]"],
				},
			},
		);
	});

	it("paints upstream's focus ring and keeps the open trigger's ghost fill", () =>
	{
		renderComposer();
		const classes =
			screen
				.getByRole(
					"button",
					{
						name: "Model: Opus 5.5 High",
					},
				)
				.getAttribute("class")
				?.split(" ") ?? [];

		expect(
			{
				focus: classes.filter((name) => name.includes("shadow")),
				expanded: classes.filter((name) => name.startsWith("aria-expanded:")),
				effort: screen.getByText("High").getAttribute("class"),
			},
		).toStrictEqual(
			{
				focus: ["focus-visible:shadow-focus"],
				expanded: ["aria-expanded:bg-fill-ghost-hover"],
				effort: "shrink-0 whitespace-pre text-ink-muted ms-1",
			},
		);
	});

	it("ends the model trigger in a 12px warning icon at Opus 5.5's Max, named by the badge message, with the Max tooltip", () =>
	{
		vi.useFakeTimers();
		try
		{
			renderComposer(
				{
					chin:
					{
						...CHIN,
						effort:
						{
							id: "max",
							label: "Max",
						},
					},
				},
			);
			const trigger = screen.getByRole(
				"button",
				{
					name: "Model: Opus 5.5 Max 3.5× or more usage",
				},
			);
			const last = trigger.lastElementChild;

			expect(
				{
					tag: last?.tagName.toLowerCase(),
					role: last?.getAttribute("role"),
					label: last?.getAttribute("aria-label"),
					hidden: last?.getAttribute("aria-hidden"),
					warning: last?.hasAttribute("data-effort-warning-icon"),
					sized: last
						?.getAttribute("class")
						?.split(" ")
						.filter((name) => name.startsWith("size-") || name.startsWith("text-")),
					tooltip: hoverTooltip(trigger),
				},
			).toStrictEqual(
				{
					tag: "svg",
					role: "img",
					label: "3.5× or more usage",
					hidden: null,
					warning: true,
					sized: ["size-3", "text-warning-100"],
					tooltip: "Claude thinks longer with Max effort and can consume 3.5× or more usage than Medium.",
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("has no warning icon, aria suffix or tooltip at Max on a model without the Max warning", () =>
	{
		vi.useFakeTimers();
		try
		{
			renderComposer(
				{
					chin:
					{
						...CHIN,
						model: "Fable 5.1",
						modelId: "claude-fable-5-1",
						effort:
						{
							id: "max",
							label: "Max",
						},
					},
				},
			);
			const trigger = screen.getByRole(
				"button",
				{
					name: "Model: Fable 5.1 Max",
				},
			);

			expect(
				{
					icon: document.querySelector("[data-effort-warning-icon]"),
					tooltip: hoverTooltip(trigger),
				},
			).toStrictEqual(
				{
					icon: null,
					tooltip: null,
				},
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("has no warning icon below Max", () =>
	{
		renderComposer();

		expect(document.querySelector("[data-effort-warning-icon]")).toBeNull();
	});

	it("drops the effort word and Max warning for a model with no effort levels", () =>
	{
		renderComposer(
			{
				chin:
				{
					...CHIN,
					model: "Haiku 4.5",
					modelId: "claude-haiku-4-5-20251001",
					effort:
					{
						id: "max",
						label: "Max",
					},
				},
			},
		);
		const trigger = screen.getByRole(
			"button",
			{
				name: "Model: Haiku 4.5",
			},
		);

		expect(
			{
				text: trigger.textContent,
				warning: document.querySelector("[data-effort-warning-icon]"),
			},
		).toStrictEqual(
			{
				text: "Haiku 4.5",
				warning: null,
			},
		);
	});

	it("shows the Model ⇧⌘I tooltip on the home bar's model trigger", () =>
	{
		vi.useFakeTimers();
		try
		{
			renderHomeComposer();

			expect(
				hoverTooltip(
					screen.getByRole(
						"button",
						{
							name: "Model: Opus 5.5 High",
						},
					),
				),
			).toBe("Model⇧Shift⌘CommandI");
		}
		finally
		{
			vi.useRealTimers();
		}
	});

	it("heads the Mode menu with upstream's 500-weight footnote label, inside the group it names", async () =>
	{
		renderComposer();
		openModeMenu();
		const menu = await screen.findByRole("menu");
		const label = within(menu).getByText("Mode");

		const group = within(menu).getByRole("group");

		expect(
			{
				className: label.getAttribute("class"),
				hidden: label.getAttribute("aria-hidden"),
				labels: group.getAttribute("aria-labelledby") === label.id && label.parentElement === group,
			},
		).toStrictEqual(
			{
				className: MENU_HEADER,
				hidden: "true",
				labels: true,
			},
		);
	});
});

describe("Composer model settings-baseline override cue", () =>
{
	async function pickSonnet()
	{
		openModelMenu();
		const menu = await screen.findByRole("menu");
		fireEvent.keyDown(
			menu,
			{
				key: "3",
				code: "Digit3",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
	}

	function overriddenLabel()
	{
		const label = document.querySelector("[data-cds=ModelSelector] [data-overridden]");
		return label === null
			? null
			:
				{
					text: label.textContent,
					className: label.getAttribute("class"),
				};
	}

	it("has no cue or Use settings item while the model matches settings.json", async () =>
	{
		renderComposer();

		openModelMenu();
		const menu = await screen.findByRole("menu");

		expect(
			{
				label: overriddenLabel(),
				useSettings: within(menu).queryByRole(
					"menuitem",
					{
						name: /^Use settings/,
					},
				),
			},
		).toStrictEqual(
			{
				label: null,
				useSettings: null,
			},
		);
	});

	it("marks a session pick that differs from settings.json in accent ink", async () =>
	{
		renderComposer();

		await pickSonnet();

		expect(overriddenLabel()).toStrictEqual(
			{
				text: "Sonnet 5.5",
				className: "flex min-w-0 items-center gap-1 text-accent-100",
			},
		);
	});

	it("ends the menu with a separator and Use settings’ Opus 5.5, which clears the pick", async () =>
	{
		const onSend = renderComposer();
		await pickSonnet();

		openModelMenu();
		const menu = await screen.findByRole("menu");
		const items = within(menu).getAllByRole("menuitem");
		const last = items[items.length - 1];
		if (last === undefined) throw new Error("model menu has no items");
		const previous = last.previousElementSibling;
		const shape =
		{
			text: last.textContent,
			afterSeparator: previous?.getAttribute("role") ?? null,
		};
		fireEvent.click(last);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		const cleared = overriddenLabel();
		sendPrompt("Continue Ivan's test");

		expect(
			{
				shape,
				cleared,
				calls: onSend.mock.calls,
			},
		).toStrictEqual(
			{
				shape:
				{
					text: "Use settings’ Opus 5.5",
					afterSeparator: "separator",
				},
				cleared: null,
				calls: [["Continue Ivan's test", {}]],
			},
		);
	});

	it("tooltips an overridden home bar model Model for this session (settings: Opus 5.5) ⇧⌘I", async () =>
	{
		renderHomeComposer();
		await pickSonnet();

		vi.useFakeTimers();
		try
		{
			const anchor = screen.getByRole(
				"button",
				{
					name: "Model: Sonnet 5.5 High",
				},
			).parentElement;
			if (anchor === null) throw new Error("trigger has no parent");
			// The tooltip stays shut as focus returns from the closed menu; a fresh hover opens it.
			fireEvent.pointerLeave(anchor);
			fireEvent.pointerEnter(anchor);
			act(() =>
			{
				vi.advanceTimersByTime(400);
			});

			expect(screen.queryByRole("tooltip")?.textContent ?? null).toBe(
				"Model for this session (settings: Opus 5.5)⇧Shift⌘CommandI",
			);
		}
		finally
		{
			vi.useRealTimers();
		}
	});
});

describe("Composer + menu Add files keycap", () =>
{
	async function addFilesRow(addButton: HTMLElement)
	{
		fireEvent.click(addButton);
		const row = await screen.findByRole(
			"menuitem",
			{
				name: /Add files or photos/,
			},
		);
		const result =
		{
			text: row.textContent,
			keys: row.getAttribute("aria-keyshortcuts"),
		};
		fireEvent.keyDown(
			row,
			{
				key: "Escape",
			},
		);
		await waitFor(() =>
		{
			expect(screen.queryAllByRole("menu")).toHaveLength(0);
		});
		return result;
	}

	it("shows the ⌘U keycap only in the active pane's composer", async () =>
	{
		const queryClient = new QueryClient(
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
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, []);
		render(
			<QueryClientProvider client={queryClient}>
				<Composer variant="session" draftKey="session-alice" onSend={vi.fn<OnSend>()} chin={CHIN} />
				<Composer
					variant="session"
					draftKey="session-bob"
					onSend={vi.fn<OnSend>()}
					chin={CHIN}
					active={false}
				/>
			</QueryClientProvider>,
		);
		const [mainAdd, paneAdd] = screen.getAllByRole(
			"button",
			{
				name: "Add",
			},
		);
		if (mainAdd === undefined || paneAdd === undefined) throw new Error("expected two Add buttons");

		expect(
			{
				main: await addFilesRow(mainAdd),
				pane: await addFilesRow(paneAdd),
			},
		).toStrictEqual(
			{
				main:
				{
					text: "Add files or photos⌘CommandU",
					keys: "Meta+u",
				},
				pane:
				{
					text: "Add files or photos",
					keys: null,
				},
			},
		);
	});

	it("leads Add files with upstream's Attachment Icon at the menu's auto size", async () =>
	{
		const queryClient = new QueryClient(
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
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, []);
		render(
			<QueryClientProvider client={queryClient}>
				<Composer variant="session" draftKey="session-alice" onSend={vi.fn<OnSend>()} chin={CHIN} />
			</QueryClientProvider>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add",
				},
			),
		);
		const row = await screen.findByRole(
			"menuitem",
			{
				name: /Add files or photos/,
			},
		);
		const icon = row.querySelector("svg");
		expect(
			{
				cds: icon?.getAttribute("data-cds"),
				glyph: icon?.classList.contains("lucide-paperclip"),
				stroke: icon?.getAttribute("stroke-width"),
			},
		).toStrictEqual(
			{
				cds: "Icon",
				glyph: true,
				stroke: "1.5",
			},
		);
	});

	it("keeps Add mounted and the editor row inset without a chin", () =>
	{
		render(<Composer variant="session" draftKey="session-alice" onSend={vi.fn<OnSend>()} />);
		const add = screen.getByRole(
			"button",
			{
				name: "Add",
			},
		);

		expect(add.closest("[data-composer-add]")?.parentElement?.classList.contains("pl-[30px]")).toBe(true);
	});
});

describe("Composer + menu Connectors submenu", () =>
{
	const server = (id: string, name: string, enabled: boolean, needsAuth: boolean): McpServerSummary => (
	{
		id,
		name,
		scope: "user",
		transport: "http",
		urlOrCommand: `https://${name.toLowerCase()}.example.com/mcp`,
		enabled,
		envKeys: [],
		headerKeys: [],
		needsAuth,
	});
	const SERVERS = [
		server("user:Gmail", "Gmail", true, false),
		server("user:Calendar", "Calendar", true, false),
		server("plugin:docs@market:Docs", "Docs", false, false),
		server("user:Sentry", "Sentry", true, true),
	];

	function renderWithServers(servers: McpServerSummary[] = SERVERS, mentionCwd?: string)
	{
		const queryClient = new QueryClient(
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
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, servers);
		render(
			<QueryClientProvider client={queryClient}>
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
					{...(mentionCwd === undefined
						? {}
						:
							{
								mentionCwd,
							})}
				/>
			</QueryClientProvider>,
		);
	}

	const scoped = (
		id: string,
		name: string,
		scope: McpServerSummary["scope"],
		projectPath?: string,
		needsAuth = false,
	): McpServerSummary => (
	{
		...server(id, name, true, needsAuth),
		scope,
		...(projectPath === undefined
			? {}
			:
				{
					projectPath,
				}),
	});
	const SCOPED = [
		scoped("user:a", "a", "user"),
		scoped("local:/p/one:b", "b", "local", "/p/one"),
		scoped("local:/p/two:c", "c", "local", "/p/two", true),
		scoped("project:/p/one:d", "d", "project", "/p/one"),
		scoped("plugin:x@y:e", "e", "plugin"),
	];

	const rowTitles = (submenu: HTMLElement) =>
		entries(submenu)
			.slice(3)
			.map((entry) => (typeof entry === "string" ? entry : entry.title));

	it("lists only the composer's project servers plus user and plugin servers", async () =>
	{
		renderWithServers(SCOPED, "/p/one");
		const {trigger, submenu} = await openConnectors();

		expect(
			{
				rows: rowTitles(submenu),
				note: trigger.querySelector("[data-menu-value]")?.textContent ?? null,
			},
		).toStrictEqual(
			{
				rows: ["a", "b", "d", "e"],
				note: null,
			},
		);
	});

	it("lists only user and plugin servers before a folder is chosen", async () =>
	{
		renderWithServers(SCOPED);
		const {submenu} = await openConnectors();

		expect(rowTitles(submenu)).toStrictEqual(["a", "e"]);
	});

	it("dedupes servers by name with precedence local > project > user > plugin", async () =>
	{
		renderWithServers(
			[
				scoped("plugin:x@y:imcp", "imcp", "plugin"),
				scoped("user:imcp", "imcp", "user"),
				scoped("project:/p/one:imcp", "imcp", "project", "/p/one"),
				scoped("local:/p/one:imcp", "imcp", "local", "/p/one", true),
				scoped("user:solo", "solo", "user"),
				scoped("plugin:x@y:solo", "solo", "plugin"),
			],
			"/p/one",
		);
		const {trigger, submenu} = await openConnectors();

		expect(
			{
				rows: entries(submenu)
					.slice(3)
					.map((entry) => (typeof entry === "string" ? entry : [entry.title, entry.role])),
				note: trigger.querySelector("[data-menu-value]")?.textContent ?? null,
			},
		).toStrictEqual(
			{
				rows: [
					["solo", "menuitemcheckbox"],
					["imcp", "menuitem"],
				],
				note: "1 needs reconnection",
			},
		);
	});

	async function openConnectors()
	{
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		const trigger = await within(menu).findByRole(
			"menuitem",
			{
				name: /^Connectors/,
			},
		);
		act(() =>
		{
			trigger.focus();
		});
		fireEvent.keyDown(
			trigger,
			{
				key: "ArrowRight",
			},
		);
		await waitFor(() =>
		{
			expect(screen.getAllByRole("menu")).toHaveLength(2);
		});
		const submenu = screen.getAllByRole("menu").find((candidate) => candidate !== menu);
		if (submenu === undefined) throw new Error("no Connectors submenu");
		return {
			menu,
			trigger,
			submenu,
		};
	}

	function entries(menu: HTMLElement)
	{
		return Array.from(
			menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="separator"]'),
		).map((element) =>
			element.getAttribute("role") === "separator"
				? "---"
				:
					{
						role: element.getAttribute("role"),
						checked: element.getAttribute("aria-checked"),
						title: element.querySelector("[data-menu-item-title]")?.textContent,
						icon: element.querySelector("svg")?.classList[1] ?? null,
						description: element.querySelector("[data-menu-item-description]")?.textContent ?? null,
						switch:
							element.querySelector('span[inert] > [role="switch"]')?.getAttribute("aria-checked") ??
							null,
					},
		);
	}

	it("lists Browse, Manage and one row per server, with read-only switches and a Reconnect row", async () =>
	{
		renderWithServers();
		const {menu, trigger, submenu} = await openConnectors();

		expect(
			{
				addMenu: within(menu)
					.getAllByRole("menuitem")
					.map((item) => item.querySelector("[data-menu-item-title]")?.textContent ?? item.textContent),
				note: trigger.querySelector("[data-menu-value]")?.textContent,
				submenu: entries(submenu),
				switches: Array.from(submenu.querySelectorAll('[role="switch"]')).map((element) => [
					element.getAttribute("aria-label"),
					element.getAttribute("aria-readonly"),
					element.getAttribute("data-size"),
				]),
			},
		).toStrictEqual(
			{
				addMenu: ["Add files or photos", "Slash commands", "Connectors1 needs reconnection"],
				note: "1 needs reconnection",
				submenu: [
					{
						role: "menuitem",
						checked: null,
						title: "Browse connectors",
						icon: "lucide-library-big",
						description: null,
						switch: null,
					},
					{
						role: "menuitem",
						checked: null,
						title: "Manage connectors",
						icon: "lucide-wrench",
						description: null,
						switch: null,
					},
					"---",
					{
						role: "menuitemcheckbox",
						checked: "true",
						title: "Gmail",
						icon: "lucide-blocks",
						description: null,
						switch: "true",
					},
					{
						role: "menuitemcheckbox",
						checked: "true",
						title: "Calendar",
						icon: "lucide-blocks",
						description: null,
						switch: "true",
					},
					{
						role: "menuitemcheckbox",
						checked: "false",
						title: "Docs",
						icon: "lucide-blocks",
						description: null,
						switch: "false",
					},
					{
						role: "menuitem",
						checked: null,
						title: "Sentry",
						icon: "lucide-cloud-off",
						description: "Reconnect",
						switch: null,
					},
				],
				switches: [
					["Gmail enabled", "true", "xs"],
					["Calendar enabled", "true", "xs"],
					["Docs enabled", "true", "xs"],
				],
			},
		);
	});

	it("lists connected servers first, then every server that needs reconnection, each in API order", async () =>
	{
		renderWithServers([
			server("user:A", "A", true, true),
			server("user:B", "B", true, false),
			server("user:C", "C", false, true),
			server("user:D", "D", false, false),
		]);
		const {submenu} = await openConnectors();

		expect(
			entries(submenu)
				.slice(3)
				.map((entry) => (typeof entry === "string" ? entry : [entry.title, entry.role, entry.description])),
		).toStrictEqual([
			["B", "menuitemcheckbox", null],
			["D", "menuitemcheckbox", null],
			["A", "menuitem", "Reconnect"],
			["C", "menuitem", "Reconnect"],
		]);
	});

	it("navigates to Customize > Connectors and to each server's page", async () =>
	{
		renderWithServers();
		const targets: unknown[] = [];
		for (const name of ["Browse connectors", "Manage connectors", "Docs", /^Sentry/])
		{
			navigate.mockClear();
			const {submenu} = await openConnectors();
			fireEvent.click(
				within(submenu).getByRole(
					name === "Docs" ? "menuitemcheckbox" : "menuitem",
					{
						name,
					},
				),
			);
			await waitFor(() =>
			{
				expect(screen.queryByRole("menu")).toBeNull();
			});
			targets.push(...navigate.mock.calls.map(([options]) => options));
		}

		expect(targets).toStrictEqual([
			{
				to: "/customize/connectors",
			},
			{
				to: "/customize/connectors",
			},
			{
				to: "/customize/connectors/id/$serverId",
				params:
				{
					serverId: toConnectorSlug("plugin:docs@market:Docs"),
				},
			},
			{
				to: "/customize/connectors/id/$serverId",
				params:
				{
					serverId: toConnectorSlug("user:Sentry"),
				},
			},
		]);
	});

	it("opens the Add menu 6px above a 28px button with upstream's 6px radius", async () =>
	{
		const queryClient = new QueryClient(
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
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, SERVERS.slice(0, 2));
		render(
			<QueryClientProvider client={queryClient}>
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>
			</QueryClientProvider>,
		);
		const add = screen.getByRole(
			"button",
			{
				name: "Add",
			},
		);
		fireEvent.click(add);
		const menu = await screen.findByRole("menu");
		const classes = add.className.split(" ");

		expect(
			{
				sideOffset: menu.parentElement?.getAttribute("data-side-offset"),
				radius: classes.filter((name) => name.startsWith("rounded-")),
				size: classes.filter((name) => name.startsWith("size-") || name.startsWith("h-")),
			},
		).toStrictEqual(
			{
				sideOffset: "6",
				radius: ["rounded-r5"],
				size: ["size-7"],
			},
		);
	});

	it("shows a disabled Connectors row with a 16px spinner while the MCP config loads", async () =>
	{
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Promise<Response>(() => {})),
		);
		const queryClient = new QueryClient(
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
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>
			</QueryClientProvider>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		const row = await within(menu).findByRole(
			"menuitem",
			{
				name: /^Connectors/,
			},
		);
		const spinner = row.querySelector("[data-spinner]");

		expect(
			{
				rows: within(menu)
					.getAllByRole("menuitem")
					.map((item) => item.querySelector("[data-menu-item-title]")?.textContent),
				disabled: row.hasAttribute("data-disabled"),
				popup: row.getAttribute("aria-haspopup"),
				icon: row.querySelector("svg")?.classList[1],
				status: row.querySelector('[role="status"]') !== null,
				spinnerSize: [spinner?.getAttribute("style")],
			},
		).toStrictEqual(
			{
				rows: ["Add files or photos", "Slash commands", "Connectors"],
				disabled: true,
				popup: null,
				icon: "lucide-blocks",
				status: true,
				spinnerSize: ["width: 1rem; height: 1rem;"],
			},
		);
		vi.unstubAllGlobals();
	});

	it("shows a plain Add connectors item that opens Customize > Connectors when no servers are configured", async () =>
	{
		renderWithServers([]);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add",
				},
			),
		);
		const menu = await screen.findByRole("menu");
		const row = await within(menu).findByRole(
			"menuitem",
			{
				name: "Add connectors",
			},
		);

		expect(
			{
				rows: within(menu)
					.getAllByRole("menuitem")
					.map((item) => item.querySelector("[data-menu-item-title]")?.textContent),
				popup: row.getAttribute("aria-haspopup"),
				disabled: row.hasAttribute("data-disabled"),
				icon: row.querySelector("svg")?.classList[1],
			},
		).toStrictEqual(
			{
				rows: ["Add files or photos", "Slash commands", "Add connectors"],
				popup: null,
				disabled: false,
				icon: "lucide-blocks",
			},
		);

		navigate.mockClear();
		fireEvent.click(row);
		await waitFor(() =>
		{
			expect(screen.queryByRole("menu")).toBeNull();
		});
		expect(navigate.mock.calls.map(([options]) => options)).toStrictEqual([
			{
				to: "/customize/connectors",
			},
		]);
	});

	it("shows no reconnection note while every server is healthy", async () =>
	{
		const queryClient = new QueryClient(
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
		queryClient.setQueryData(customizeMcpServersQueryOptions.queryKey, SERVERS.slice(0, 2));
		render(
			<QueryClientProvider client={queryClient}>
				<Composer
					variant="session"
					draftKey="session-alice"
					onSend={() =>
					{
					}}
					chin={CHIN}
				/>
			</QueryClientProvider>,
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Add",
				},
			),
		);
		const trigger = await within(await screen.findByRole("menu")).findByRole(
			"menuitem",
			{
				name: /^Connectors/,
			},
		);

		expect(trigger.querySelector("[data-menu-value]")).toBeNull();
	});
});

describe("Composer text-entry menus at a coarse pointer below 640px", () =>
{
	beforeEach(() =>
	{
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => (
			{
				matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
				media: query,
				onchange: null,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			})),
		);
	});

	afterEach(() =>
	{
		vi.unstubAllGlobals();
	});

	function presentation(popup: HTMLElement)
	{
		return {
			presentation: popup.getAttribute("data-presentation"),
			scrim: document.querySelector("[data-sheet-scrim]"),
		};
	}

	it("keeps the slash command menu anchored above the composer", () =>
	{
		render(
			<Composer
				variant="session"
				draftKey="session-alice"
				onSend={vi.fn<OnSend>()}
				slashCommands={[
					{
						name: "plan",
						description: "Switch to plan mode",
						source: "builtin",
					},
				]}
			/>,
		);
		fireEvent.change(
			screen.getByRole(
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
			presentation(
				screen.getByRole(
					"menu",
					{
						name: "Slash commands",
					},
				),
			),
		).toStrictEqual(
			{
				presentation: null,
				scrim: null,
			},
		);
	});

	it("keeps the @-mention list anchored above the composer", () =>
	{
		render(
			<FileMentionMenu
				id="mentions"
				entries={[
					{
						name: "src",
						relPath: "src",
						isDirectory: true,
					},
				]}
				highlighted={0}
				onHighlight={() => undefined}
				onAccept={() => undefined}
			/>,
		);

		expect(
			presentation(
				screen.getByRole(
					"listbox",
					{
						name: "Mention suggestions",
					},
				),
			),
		).toStrictEqual(
			{
				presentation: null,
				scrim: null,
			},
		);
	});
});

describe("Composer model menu on a coarse pointer under 640px", () =>
{
	function stubCoarsePhone()
	{
		vi.stubGlobal(
			"matchMedia",
			vi.fn((query: string) => (
			{
				matches: query === "(pointer: coarse)" || query === "(pointer: coarse) and (max-width: 639.98px)",
				media: query,
				onchange: null,
				addEventListener: () => undefined,
				removeEventListener: () => undefined,
				addListener: () => undefined,
				removeListener: () => undefined,
				dispatchEvent: () => false,
			})),
		);
	}

	it("names the model menu popup ModelSelector, anchored on a fine pointer and as a coarse-phone sheet", async () =>
	{
		renderComposer();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Model:/,
				},
			),
		);
		const anchored = (await screen.findByRole("menu")).getAttribute("data-cds");
		cleanup();
		stubCoarsePhone();
		renderComposer();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Model:/,
				},
			),
		);
		const sheet = await screen.findByRole("menu");
		expect(
			{
				anchored,
				sheet: sheet.getAttribute("data-cds"),
				presentation: sheet.getAttribute("data-presentation"),
				size: sheet.hasAttribute("data-size"),
			},
		).toStrictEqual(
			{
				anchored: "ModelSelector",
				sheet: "ModelSelector",
				presentation: "sheet",
				size: false,
			},
		);
	});

	it("presents a ModelSelector sheet without data-size, keeping upstream's 32px 14/20 rows and 12px top radius", async () =>
	{
		stubCoarsePhone();
		renderComposer();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: /^Model:/,
				},
			),
		);
		// The sheet presentation is its own lazily loaded chunk.
		const menu = await screen.findByRole("menu");
		const radioClasses = within(menu)
			.getAllByRole("menuitemradio")
			.map((item) => item.className.split(" "));
		const popupClasses = menu.className.split(" ");

		expect(
			{
				presentation: menu.getAttribute("data-presentation"),
				size: menu.hasAttribute("data-size"),
				handle: menu.firstElementChild?.hasAttribute("data-cds-sheet-handle"),
				radius: popupClasses.filter((name) => name.startsWith("rounded-t-")),
				popupText: popupClasses.filter((name) => name.startsWith("text-[")),
				rows: radioClasses.map((names) => (
				{
					text: names.filter((name) => name.startsWith("text-[")),
					height: names.includes("h-8"),
				})),
			},
		).toStrictEqual(
			{
				presentation: "sheet",
				size: false,
				handle: true,
				radius: ["rounded-t-card"],
				popupText: ["text-[14px]/[20px]"],
				rows: Array.from(
					{
						length: radioClasses.length,
					},
					() => (
					{
						text: ["text-[14px]/[20px]"],
						height: true,
					}),
				),
			},
		);
	});
});
