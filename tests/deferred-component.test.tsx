// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import type React from "react";
import {Component} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {deferredComponent, deferredModule, useLoadedModule} from "../src/components/deferred-component";
import {composerSurfaces, useComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {DeferredKeyboardShortcutsDialog} from "../src/components/keyboard-shortcuts-dialog-entry";
import {keyboardShortcutsDialogModule} from "../src/components/keyboard-shortcuts-dialog-module";
import {setKeyboardShortcutsOpen} from "../src/components/keyboard-shortcuts-open";
import type {PlanApprovalContextValue} from "../src/components/plan-approval-context";
import {DeferredInlinePlanApproval, sessionPromptCards} from "../src/components/session-prompt-cards-entry";
import type {DeferredModule} from "../src/components/deferred-component";
import {STALE_CHUNK_RELOAD_KEY} from "../src/lib/stale-chunk-reload";

function Greeting({name}: {name: string})
{
	return <p>Hello {name}</p>;
}

const greetingModule =
{
	Greeting,
};

const STALE = "Failed to fetch dynamically imported module: https://example.com/assets/greeting.js";

function Skeleton({name}: {name: string})
{
	return <p>Loading {name}</p>;
}

function Frame({name, children}: {name: string; children: React.ReactNode})
{
	return <section aria-label={`Frame for ${name}`}>{children}</section>;
}

function Crashes(): never
{
	throw new Error("Example render failure");
}

class CatchAll extends Component<
	{
		children: React.ReactNode;
	},
	{
		error: string | null;
	}
>
{
	override state =
	{
		error: null as string | null,
	};

	static getDerivedStateFromError(error: unknown)
	{
		return {
			error: error instanceof Error ? error.message : "unknown",
		};
	}

	override render(): React.ReactNode
	{
		return this.state.error === null ? this.props.children : <p>Caught: {this.state.error}</p>;
	}
}

/** The ErrorView a failed download leaves behind: its state, copy, button and the invisible placeholder under it. */
function chunkError()
{
	const root = document.querySelector("[data-chunk-error]");
	return {
		state: root?.getAttribute("data-chunk-error"),
		placeholder: root?.children[0]?.textContent,
		hidden: root?.children[0]?.getAttribute("aria-hidden"),
		copy: root?.querySelector("[role=status]")?.textContent,
		button: root?.querySelector("button")?.textContent,
		frame: root?.closest("section")?.getAttribute("aria-label"),
	};
}

function controlledLoad(error = new Error("Example chunk unavailable"))
{
	let settle!: (outcome: "resolve" | "reject") => void;
	const load = vi.fn<() => Promise<typeof greetingModule>>(
		async () =>
			new Promise<typeof greetingModule>((resolve, reject) =>
			{
				settle = (outcome) =>
				{
					if (outcome === "resolve") resolve(greetingModule);
					else reject(error);
				};
			}),
	);
	return {
		load,
		settle: (outcome: "resolve" | "reject") =>
		{
			settle(outcome);
		},
	};
}

/** Renders in an awaited act scope, where React retries a render that suspended once its promise settles. */
async function renderAsync(element: React.ReactElement)
{
	let view!: ReturnType<typeof render>;
	await act(async () =>
	{
		view = render(element);
		await Promise.resolve();
	});
	return view;
}

/** Clicks Retry in an awaited act scope, so React retries the render that suspended on the new download. */
async function clickRetry()
{
	await act(async () =>
	{
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Retry",
				},
			),
		);
		await Promise.resolve();
	});
}

async function flush()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, 0);
		});
	});
}

afterEach(() =>
{
	cleanup();
	vi.restoreAllMocks();
	window.sessionStorage.clear();
});

describe("deferredComponent", () =>
{
	it("renders nothing while the module downloads, then the component, and renders a later instance in the first pass", async () =>
	{
		const {load, settle} = controlledLoad();
		const module = deferredModule(load);
		const DeferredGreeting = deferredComponent(module, "Greeting");

		const first = await renderAsync(<DeferredGreeting name="Ada" />);
		const pending = first.container.innerHTML;
		settle("resolve");
		await screen.findByText(
			"Hello Ada",
			{},
			{
				timeout: 1000,
			},
		);
		const loaded = first.container.innerHTML;

		const second = render(<DeferredGreeting name="Grace" />);
		const firstPass = second.container.innerHTML;

		expect(
			{
				pending,
				loaded,
				firstPass,
				downloads: load.mock.calls.length,
			},
		).toStrictEqual(
			{
				pending: "",
				loaded: "<p>Hello Ada</p>",
				firstPass: "<p>Hello Grace</p>",
				downloads: 1,
			},
		);
	});

	it("renders nothing after a failed download (upstream's fail-open) and downloads again on the next preload", async () =>
	{
		vi.spyOn(console, "error").mockImplementation(() => {});
		const {load, settle} = controlledLoad(new TypeError(STALE));
		const module = deferredModule(load);
		const DeferredGreeting = deferredComponent(module, "Greeting");

		const view = await renderAsync(<DeferredGreeting name="Ada" />);
		settle("reject");
		await flush();
		const failed =
		{
			html: view.container.innerHTML,
			loaded: module.loaded(),
		};

		const retry = module.preload();
		settle("resolve");
		await retry;
		const remounted = render(<DeferredGreeting name="Ada" />);

		expect(
			{
				failed,
				retried: remounted.container.innerHTML,
				downloads: load.mock.calls.length,
			},
		).toStrictEqual(
			{
				failed:
				{
					html: "",
					loaded: undefined,
				},
				retried: "<p>Hello Ada</p>",
				downloads: 2,
			},
		);
	});
});

describe("deferredComponent with a loading placeholder", () =>
{
	it("shows the placeholder in its frame, then upstream's inline ErrorView over it, and Retry downloads again", async () =>
	{
		vi.spyOn(console, "error").mockImplementation(() => {});
		const {load, settle} = controlledLoad(new TypeError(STALE));
		const module = deferredModule(load);
		const DeferredGreeting = deferredComponent(
			module,
			"Greeting",
			{
				loading: Skeleton,
				frame: Frame,
			},
		);

		const view = await renderAsync(<DeferredGreeting name="Ada" />);
		const pending = view.container.innerHTML;
		settle("reject");
		await flush();
		const failed = chunkError();

		await clickRetry();
		const retrying = view.container.innerHTML;
		settle("resolve");
		await screen.findByText(
			"Hello Ada",
			{},
			{
				timeout: 1000,
			},
		);

		expect(
			{
				pending,
				failed,
				retrying,
				loaded: view.container.innerHTML,
				downloads: load.mock.calls.length,
			},
		).toStrictEqual(
			{
				pending: '<section aria-label="Frame for Ada"><p>Loading Ada</p></section>',
				failed:
				{
					state: "retry",
					placeholder: "Loading Ada",
					hidden: "true",
					copy: "Couldn’t load this.",
					button: "Retry",
					frame: "Frame for Ada",
				},
				retrying: '<section aria-label="Frame for Ada"><p>Loading Ada</p></section>',
				loaded: "<p>Hello Ada</p>",
				downloads: 2,
			},
		);
	});

	it("says the tab is offline, asks for a reload once the stale-chunk guard fired, and offers Reload after a failed Retry", async () =>
	{
		vi.spyOn(console, "error").mockImplementation(() => {});
		const failure = async () =>
		{
			const {load, settle} = controlledLoad(new TypeError(STALE));
			const DeferredGreeting = deferredComponent(
				deferredModule(load),
				"Greeting",
				{
					loading: Skeleton,
				},
			);
			await renderAsync(<DeferredGreeting name="Ada" />);
			settle("reject");
			await flush();
			return {
				settle,
				result: chunkError(),
			};
		};

		const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
		const offline = (await failure()).result;
		cleanup();
		online.mockReturnValue(true);

		window.sessionStorage.setItem(STALE_CHUNK_RELOAD_KEY, String(Date.now()));
		const reload = (await failure()).result;
		cleanup();
		window.sessionStorage.clear();

		const {settle} = await failure();
		await clickRetry();
		settle("reject");
		await flush();
		const updated = chunkError();

		expect(
			{
				offline,
				reload,
				updated,
			},
		).toStrictEqual(
			{
				offline:
				{
					state: "waiting",
					placeholder: "Loading Ada",
					hidden: "true",
					copy: "You’re offline.",
					button: "Retry",
					frame: undefined,
				},
				reload:
				{
					state: "reload",
					placeholder: "Loading Ada",
					hidden: "true",
					copy: "Couldn’t load this. Reload the page to continue.",
					button: "Reload",
					frame: undefined,
				},
				updated:
				{
					state: "updated",
					placeholder: "Loading Ada",
					hidden: "true",
					copy: "Claude was updated. Reload to continue.",
					button: "Reload",
					frame: undefined,
				},
			},
		);
	});

	it("lets a render crash and a non-chunk download error reach the boundary above it", async () =>
	{
		vi.spyOn(console, "error").mockImplementation(() => {});
		const crashing = deferredModule(async () =>
			Promise.resolve(
				{
					Crashes,
				},
			),
		);
		const DeferredCrash = deferredComponent(
			crashing,
			"Crashes",
			{
				loading: () => <p>Loading</p>,
			},
		);
		const crash = await renderAsync(
			<CatchAll>
				<DeferredCrash />
			</CatchAll>,
		);
		await flush();
		const crashed = crash.container.innerHTML;
		cleanup();

		const {load, settle} = controlledLoad();
		const DeferredGreeting = deferredComponent(
			deferredModule(load),
			"Greeting",
			{
				loading: Skeleton,
			},
		);
		const broken = await renderAsync(
			<CatchAll>
				<DeferredGreeting name="Ada" />
			</CatchAll>,
		);
		settle("reject");
		await flush();

		expect(
			{
				crashed,
				failed: broken.container.innerHTML,
			},
		).toStrictEqual(
			{
				crashed: "<p>Caught: Example render failure</p>",
				failed: "<p>Caught: Example chunk unavailable</p>",
			},
		);
	});
});

describe("useLoadedModule", () =>
{
	it("re-renders its caller with the module once it arrives", async () =>
	{
		const {load, settle} = controlledLoad();
		const module = deferredModule(load);
		function Probe()
		{
			const loaded = useLoadedModule(module);
			return <span>{loaded === undefined ? "pending" : "loaded"}</span>;
		}

		const view = render(<Probe />);
		const before = view.container.textContent;
		const preload = module.preload();
		settle("resolve");
		await act(async () =>
		{
			await preload;
		});

		expect(
			{
				before,
				after: view.container.textContent,
			},
		).toStrictEqual(
			{
				before: "pending",
				after: "loaded",
			},
		);
	});
});

/** Makes `module`'s download fail with a stale-chunk error, as one stable promise React can read. */
/**
 * A module whose download fails: preload rejects, and it never reads as loaded, even when an earlier file in a shared
 * worker downloaded the real chunk or left a download that lands during this test.
 */
function failDownloads<M>(module: DeferredModule<M>)
{
	const failed = Promise.reject(new TypeError(STALE));
	failed.catch(() => {});
	vi.spyOn(module, "preload").mockReturnValue(failed);
	vi.spyOn(module, "loaded").mockReturnValue(undefined);
}

const PLAN: PlanApprovalContextValue =
{
	sessionId: "session-alice",
	answerRoute: "live-pane",
	loadDialog: async () => Promise.reject(new Error("Example dialog not showing")),
	decide: async () => Promise.resolve(),
};

describe("deferred surfaces upstream draws an inline ErrorView for", () =>
{
	it("show it in the open shortcuts dialog, the / popup and both approval card presentations; the parked bar stays fail-open", async () =>
	{
		vi.spyOn(console, "error").mockImplementation(() => {});
		failDownloads(keyboardShortcutsDialogModule);
		failDownloads(composerSurfaces);
		failDownloads(sessionPromptCards);

		act(() =>
		{
			setKeyboardShortcutsOpen(true);
		});
		await renderAsync(<DeferredKeyboardShortcutsDialog />);
		await flush();
		const dialog = screen.getByRole(
			"dialog",
			{
				name: "Keyboard shortcuts",
			},
		);
		const shortcuts =
		{
			state: dialog.querySelector("[data-chunk-error]")?.getAttribute("data-chunk-error"),
			copy: dialog.querySelector("[data-chunk-error] [role=status]")?.textContent,
		};
		act(() =>
		{
			setKeyboardShortcutsOpen(false);
		});
		cleanup();

		function Composer()
		{
			const {SlashCommandMenu, ParkedMessageBar} = useComposerSurfaces();
			return (
				<>
					<SlashCommandMenu
						id="slash"
						items={[]}
						query=""
						highlighted={-1}
						onHighlight={() =>
						{
						}}
						onAccept={() =>
						{
						}}
					/>
					<div data-testid="parked">
						<ParkedMessageBar
							sessionId="session-alice"
							items={[]}
							willAutoSend={false}
							resetsAt={undefined}
							archived={false}
							flushing={false}
							onSendAnyway={() =>
							{
							}}
							onEdit={() =>
							{
							}}
							onRemove={() =>
							{
							}}
						/>
					</div>
				</>
			);
		}
		const composer = await renderAsync(<Composer />);
		// The popup's ErrorView commits on React's retry of the boundary after the download rejects; wait for that commit
		// in this render's own popup instead of for one macrotask.
		const slashError = await waitFor(() =>
		{
			const error = composer.container.querySelector("[data-slash-menu-frame] [data-chunk-error]");
			if (error === null) throw new Error("The / popup has not drawn its ErrorView yet");
			return error;
		});
		const slash =
		{
			state: slashError.getAttribute("data-chunk-error"),
			button: slashError.querySelector("button")?.textContent,
		};
		const parked = screen.getByTestId("parked").innerHTML;
		cleanup();

		const cards = await renderAsync(
			<>
				<DeferredInlinePlanApproval toolUseId="toolu_plan_1" planText="# Plan" plan={PLAN} />
				<DeferredInlinePlanApproval
					toolUseId="toolu_plan_2"
					planText="# Plan"
					plan={PLAN}
					presentation="dock"
				/>
			</>,
		);
		await flush();
		const approvals = [...cards.container.querySelectorAll("[data-chunk-error]")].map((error) => (
		{
			state: error.getAttribute("data-chunk-error"),
			skeleton: error.querySelector("[data-cds=Skeleton]")?.className.includes("max-w-[480px]"),
		}));

		expect(
			{
				shortcuts,
				slash,
				parked,
				approvals,
			},
		).toStrictEqual(
			{
				shortcuts:
				{
					state: "retry",
					copy: "Couldn’t load this.",
				},
				slash:
				{
					state: "retry",
					button: "Retry",
				},
				parked: "",
				approvals: [
					{
						state: "retry",
						skeleton: true,
					},
					{
						state: "retry",
						skeleton: false,
					},
				],
			},
		);
	});
});
