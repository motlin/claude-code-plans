// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeAll, describe, expect, it, vi} from "vite-plus/test";

import {Composer} from "../src/components/composer";
import {preloadComposerSurfaces} from "../src/components/composer-surfaces-entry";
import {PaneHostContext, type PaneHostApi} from "../src/components/panes/pane-host-context";
import {ToastProvider} from "../src/components/toast";
import type {ComposerState} from "../src/lib/composer-state";
import {defaultPaneLayout} from "../src/lib/pane-layout";
import {PHONE_SHEET_QUERY} from "../src/lib/use-phone-sheet";

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

const NO_PLAN_YET = "Already in plan mode. No plan written yet.";
const ALREADY = "Already in plan mode.";
const COMMAND_LIKE =
	"/plan takes a description, not a command. Leave out the description’s leading “/” or “!” and try again.";
const UNAVAILABLE = "Plan mode isn’t available for this session.";

function chinIn(mode: "default" | "plan"): ComposerState
{
	return {
		mode:
		{
			id: mode,
			label: mode === "plan" ? "Plan" : "Manual",
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
}

function stubPhone(phone: boolean)
{
	vi.stubGlobal(
		"matchMedia",
		vi.fn((query: string) => (
		{
			matches: query === PHONE_SHEET_QUERY ? phone : false,
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

function paneHost(openPane: PaneHostApi["openPane"], paneOpen: boolean): PaneHostApi
{
	return {
		layout: defaultPaneLayout(),
		openKinds: paneOpen ? ["plan"] : [],
		isOpen: (kind) => paneOpen && kind === "plan",
		openPane,
		closePane: () =>
		{
		},
		togglePane: () =>
		{
		},
	};
}

function setup({
	mode = "default",
	chin = true,
	hasPlan = false,
	paneOpen = false,
	variant = "session",
}:
{
	mode?: "default" | "plan";
	chin?: boolean;
	hasPlan?: boolean;
	paneOpen?: boolean;
	variant?: "session" | "home";
} = {})
{
	const onSend = vi.fn<(prompt: string, launchOptions: unknown, routing?: unknown) => void>();
	const openPane = vi.fn<PaneHostApi["openPane"]>();
	const host = paneHost(openPane, paneOpen);
	const composer = (
		<Composer
			variant={variant}
			draftKey={`${variant}-plan`}
			onSend={onSend}
			{...(chin
				?
					{
						chin: chinIn(mode),
					}
				: {})}
			{...(variant === "session"
				?
					{
						plan:
						{
							hasPlan,
							olderMessagesNotLoaded: false,
						},
					}
				: {})}
		/>
	);
	render(
		<ToastProvider>
			{variant === "session" ? (
				<PaneHostContext.Provider value={host}>{composer}</PaneHostContext.Provider>
			) : (
				composer
			)}
		</ToastProvider>,
	);
	const textarea = screen.getByRole<HTMLTextAreaElement>(
		"textbox",
		{
			name: "Prompt",
		},
	);
	return {
		textarea,
		onSend,
		openPane,
	};
}

function send(textarea: HTMLTextAreaElement, text: string)
{
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

function toastTitles(): string[]
{
	return [...document.querySelectorAll("[data-toast]")].map((toast) => toast.textContent);
}

describe("/plan in the session composer", () =>
{
	it("says it's already in plan mode with no plan yet, and clears without sending", () =>
	{
		const {textarea, onSend, openPane} = setup(
			{
				mode: "plan",
			},
		);
		send(textarea, "/plan");
		expect(
			{
				sent: onSend.mock.calls,
				opened: openPane.mock.calls,
				toasts: toastTitles(),
				text: textarea.value,
			},
		).toStrictEqual(
			{
				sent: [],
				opened: [],
				toasts: [NO_PLAN_YET],
				text: "",
			},
		);
	});

	it("replaces one plan notice with the other rather than stacking them", () =>
	{
		const {textarea} = setup(
			{
				mode: "plan",
			},
		);
		send(textarea, "/plan");
		send(textarea, "/plan");
		expect(toastTitles()).toStrictEqual([NO_PLAN_YET]);
		cleanup();
		const again = setup(
			{
				mode: "plan",
				hasPlan: true,
				paneOpen: true,
			},
		);
		send(again.textarea, "/plan");
		expect(toastTitles()).toStrictEqual([ALREADY]);
	});

	it("opens the Plan pane in plan mode when there is a plan and the pane is closed", () =>
	{
		const {textarea, onSend, openPane} = setup(
			{
				mode: "plan",
				hasPlan: true,
			},
		);
		send(textarea, "/plan");
		expect(
			{
				sent: onSend.mock.calls,
				opened: openPane.mock.calls,
				toasts: toastTitles(),
			},
		).toStrictEqual(
			{
				sent: [],
				opened: [["plan"]],
				toasts: [],
			},
		);
	});

	it("sends a description as a plain prompt when already in plan mode", () =>
	{
		const {textarea, onSend} = setup(
			{
				mode: "plan",
			},
		);
		send(textarea, "/plan fix it");
		expect(onSend.mock.calls.map((call) => call[0])).toStrictEqual(["fix it"]);
	});

	it("lets the CLI switch and query a description outside plan mode", () =>
	{
		const {textarea, onSend, openPane} = setup();
		send(textarea, "/plan fix it");
		expect(
			{
				sent: onSend.mock.calls.map((call) => call[0]),
				opened: openPane.mock.calls,
				text: textarea.value,
			},
		).toStrictEqual(
			{
				sent: ["/plan fix it"],
				opened: [],
				text: "",
			},
		);
	});

	it("switches through the CLI and opens the pane for /plan open with a plan", () =>
	{
		const {textarea, onSend, openPane} = setup(
			{
				hasPlan: true,
			},
		);
		send(textarea, "/plan open");
		expect(
			{
				sent: onSend.mock.calls.map((call) => call[0]),
				opened: openPane.mock.calls,
			},
		).toStrictEqual(
			{
				sent: ["/plan"],
				opened: [["plan"]],
			},
		);
	});

	it("refuses a command-like description and keeps the text", () =>
	{
		const {textarea, onSend} = setup();
		send(textarea, "/plan /foo");
		expect(
			{
				sent: onSend.mock.calls,
				toasts: toastTitles(),
				text: textarea.value,
			},
		).toStrictEqual(
			{
				sent: [],
				toasts: [COMMAND_LIKE],
				text: "/plan /foo",
			},
		);
	});

	it("says plan mode is unavailable without a mode picker, once however often it's sent", () =>
	{
		const {textarea, onSend} = setup(
			{
				chin: false,
			},
		);
		send(textarea, "/plan x");
		send(textarea, "/plan x");
		expect(
			{
				sent: onSend.mock.calls,
				toasts: toastTitles(),
				text: textarea.value,
			},
		).toStrictEqual(
			{
				sent: [],
				toasts: [UNAVAILABLE],
				text: "/plan x",
			},
		);
	});

	it("never opens the pane on a phone", () =>
	{
		stubPhone(true);
		const {textarea, onSend, openPane} = setup(
			{
				hasPlan: true,
			},
		);
		send(textarea, "/plan");
		expect(
			{
				sent: onSend.mock.calls.map((call) => call[0]),
				opened: openPane.mock.calls,
			},
		).toStrictEqual(
			{
				sent: ["/plan"],
				opened: [],
			},
		);
	});
});

describe("/plan in the home composer", () =>
{
	it("sets the draft's mode to Plan without launching", async () =>
	{
		const {textarea, onSend} = setup(
			{
				variant: "home",
			},
		);
		send(textarea, "/plan");
		await act(async () => {});
		expect(
			{
				sent: onSend.mock.calls,
				text: textarea.value,
				trigger: document.querySelector("[data-chin-mode]")?.textContent,
			},
		).toStrictEqual(
			{
				sent: [],
				text: "",
				trigger: "Plan",
			},
		);
		send(textarea, "/plan");
		expect(toastTitles()).toStrictEqual([NO_PLAN_YET]);
	});

	it("launches a description in plan mode", () =>
	{
		const {textarea, onSend} = setup(
			{
				variant: "home",
			},
		);
		send(textarea, "/plan write tests");
		expect(onSend.mock.calls).toStrictEqual([
			[
				"write tests",
				{
					permissionMode: "plan",
				},
			],
		]);
	});
});
