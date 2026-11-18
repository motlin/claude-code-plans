// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ModelSwitchedCard} from "../src/components/refusal-fallback-card";
import
{
	type ModelSwitchedRecord,
	type RefusalFallbackHost,
	type RefusalSettingsLink,
	resetModelSwitchedOpenMemory,
} from "../src/components/refusal-fallback-host";
import {SystemBanner} from "../src/components/system-banner";
import type {HerdrLaunchResponse} from "../src/lib/api/herdr";
import {startSessionOnModel} from "../src/lib/start-session-on-model";
import type {ToastOptions} from "../src/components/toast-context";
import type {RefusalFallback} from "../src/lib/refusal-fallback";

afterEach(() =>
{
	cleanup();
});

const FALLBACK: RefusalFallback =
{
	originalModel: "claude-opus-4-5",
	fallbackModel: "claude-sonnet-4-5",
	apiRefusalCategory: null,
	apiRefusalCategoryRaw: "weird",
	refusedUserMessageUuid: "u1",
	strike: 1,
	streakOriginalModel: "claude-opus-4-5",
	uuid: "f1",
};

const LIVE: RefusalFallbackHost =
{
	sessionId: "s1",
	live: FALLBACK,
	held: false,
	onNewSession: undefined,
	onEditRetry: undefined,
};

const RECORD: ModelSwitchedRecord =
{
	uuid: "f1",
	originalModel: "claude-opus-4-7",
	fallbackModel: "claude-sonnet-4-5",
	apiRefusalCategory: "cyber",
	apiRefusalExplanation: null,
};

const OFFER: RefusalSettingsLink =
{
	view: "offer",
	openSettings: () =>
	{
	},
};

const HIDDEN: RefusalSettingsLink =
{
	view: "hidden",
	openSettings: () =>
	{
	},
};

const card = () => screen.getByTestId("code-model-switched-card");
const toggle = () => card().querySelector("button[aria-expanded]");
const details = () => card().querySelector("p")?.textContent ?? null;
const actions = () =>
	[...card().querySelectorAll("button:not([aria-expanded])")]
		.filter((button) => button.getAttribute("data-cds") !== "TextLink")
		.map((button) => button.textContent);

describe("ModelSwitchedCard", () =>
{
	afterEach(() =>
	{
		resetModelSwitchedOpenMemory();
	});

	it("draws the live fallback at strike 1 open, with the model-named copy, Learn more, the category and Rewind and retry", () =>
	{
		render(
			<ModelSwitchedCard
				record={RECORD}
				host={
				{
					...LIVE,
					onEditRetry: () => true,
				}}
				settings={HIDDEN}
			/>,
		);
		expect(
			{
				title: toggle()?.textContent,
				expanded: toggle()?.getAttribute("aria-expanded"),
				details: details(),
				learnMore: card().querySelector("a")?.getAttribute("href"),
				actions: actions(),
			},
		).toStrictEqual(
			{
				title: "Switched to Sonnet 4.5",
				expanded: "true",
				details:
					"Opus 4.7’s safeguards flagged this message. This sometimes happens with safe, normal conversations. Learn more(opens in new tab).Details: [cyber]",
				learnMore: "https://support.claude.com/en/articles/8106465",
				actions: ["Rewind and retry"],
			},
		);
	});

	it("runs the edit-retry handler from Rewind and retry", () =>
	{
		const onEditRetry = vi.fn<() => boolean>(() => true);
		render(
			<ModelSwitchedCard
				record={RECORD}
				host={
				{
					...LIVE,
					onEditRetry,
				}}
				settings={HIDDEN}
			/>,
		);
		fireEvent.click(screen.getByText("Rewind and retry"));
		expect(onEditRetry.mock.calls).toStrictEqual([[]]);
	});

	it("draws an older fallback closed and with no action", () =>
	{
		render(
			<ModelSwitchedCard
				record={RECORD}
				host={
				{
					...LIVE,
					live: null,
					onEditRetry: () => true,
				}}
				settings={HIDDEN}
			/>,
		);
		expect(
			{
				title: toggle()?.textContent,
				expanded: toggle()?.getAttribute("aria-expanded"),
				actions: actions(),
			},
		).toStrictEqual(
			{
				title: "Switched to Sonnet 4.5",
				expanded: "false",
				actions: [],
			},
		);
	});

	it("offers no action while a card holds the session", () =>
	{
		render(
			<ModelSwitchedCard
				record={RECORD}
				host={
				{
					...LIVE,
					held: true,
					onEditRetry: () => true,
				}}
				settings={HIDDEN}
			/>,
		);
		expect(actions()).toStrictEqual([]);
	});

	it("offers Start a new session on the streak's original model at strike 2", () =>
	{
		const onNewSession = vi.fn<(model: string) => void>();
		render(
			<ModelSwitchedCard
				record={RECORD}
				host={
				{
					...LIVE,
					live:
					{
						...FALLBACK,
						strike: 2,
					},
					onNewSession,
					onEditRetry: () => true,
				}}
				settings={HIDDEN}
			/>,
		);
		expect(actions()).toStrictEqual(["Start a new session"]);
		fireEvent.click(screen.getByText("Start a new session"));
		expect(onNewSession.mock.calls).toStrictEqual([["claude-opus-4-5"]]);
	});

	it("offers nothing when escalated without a launcher", () =>
	{
		render(
			<ModelSwitchedCard
				record={RECORD}
				host={
				{
					...LIVE,
					live:
					{
						...FALLBACK,
						strike: 2,
					},
					onEditRetry: () => true,
				}}
				settings={HIDDEN}
			/>,
		);
		expect(actions()).toStrictEqual([]);
	});

	it("shows the API's explanation in place of the flagged copy and leaves Details out without a category", () =>
	{
		render(
			<ModelSwitchedCard
				record={
				{
					...RECORD,
					apiRefusalCategory: null,
					apiRefusalExplanation: "This request triggered restrictions on violative cyber content.",
				}}
				host={LIVE}
				settings={HIDDEN}
			/>,
		);
		expect(details()).toBe(
			"This request triggered restrictions on violative cyber content. Learn more(opens in new tab).",
		);
	});

	it("points to settings while automatic switching is on, and opens them", () =>
	{
		const openSettings = vi.fn<() => void>();
		render(
			<ModelSwitchedCard
				record={
				{
					...RECORD,
					apiRefusalCategory: null,
				}}
				host={LIVE}
				settings={
				{
					view: "offer",
					openSettings,
				}}
			/>,
		);
		expect(details()).toBe(
			"Opus 4.7’s safeguards flagged this message. This sometimes happens with safe, normal conversations. Learn more(opens in new tab). You can turn off automatic model switching in settings.",
		);
		fireEvent.click(screen.getByText("settings"));
		expect(openSettings.mock.calls).toStrictEqual([[]]);
	});

	it("drops the settings sentence once automatic switching is off", () =>
	{
		render(
			<ModelSwitchedCard
				record={
				{
					...RECORD,
					apiRefusalCategory: null,
				}}
				host={LIVE}
				settings={
				{
					...OFFER,
					view: "off",
				}}
			/>,
		);
		expect(details()).toBe(
			"Opus 4.7’s safeguards flagged this message. This sometimes happens with safe, normal conversations. Learn more(opens in new tab).",
		);
	});

	it("remembers a toggled open state across remounts", () =>
	{
		const first = render(<ModelSwitchedCard record={RECORD} host={LIVE} settings={HIDDEN} />);
		fireEvent.click(toggle()!);
		first.unmount();
		render(<ModelSwitchedCard record={RECORD} host={LIVE} settings={HIDDEN} />);
		expect(toggle()?.getAttribute("aria-expanded")).toBe("false");
	});

	it("has no dismiss X and no opt-out button", () =>
	{
		render(<ModelSwitchedCard record={RECORD} host={LIVE} settings={OFFER} />);
		expect(
			[...card().querySelectorAll("button")].map(
				(button) => button.getAttribute("aria-label") ?? button.textContent,
			),
		).toStrictEqual(["Switched to Sonnet 4.5", "settings"]);
	});
});

describe("SystemBanner model_refusal_fallback", () =>
{
	it("draws nothing without a session host, like upstream's static marker in English", () =>
	{
		const {container} = render(
			<SystemBanner
				line={
				{
					type: "system",
					subtype: "model_refusal_fallback",
					originalModel: "claude-opus-4-7",
					fallbackModel: "claude-sonnet-4-5",
					uuid: "f1",
					lineIndex: 0,
				}}
			/>,
		);
		expect(container.innerHTML).toBe("");
	});
});

describe("startSessionOnModel", () =>
{
	it("launches claude in the session's folder with --model", async () =>
	{
		const launch = vi.fn<(request: {cwd: string; args: string[]}) => Promise<HerdrLaunchResponse>>(async () =>
			Promise.resolve(
				{
					ok: true,
					tabId: "t",
					paneId: "p",
					sessionId: "new",
				},
			),
		);
		const toasts: ToastOptions[] = [];
		const opened: string[] = [];
		await act(async () =>
		{
			await startSessionOnModel(
				"/repo",
				"claude-opus-4-5",
				{
					launch,
					toast: (options) => toasts.push(options),
					open: (id) => opened.push(id),
				},
			);
		});
		expect(
			{
				calls: launch.mock.calls,
				toasts,
				opened,
			},
		).toStrictEqual(
			{
				calls: [
					[
						{
							cwd: "/repo",
							args: ["--model", "claude-opus-4-5"],
						},
					],
				],
				toasts: [],
				opened: ["new"],
			},
		);
	});

	it("toasts success when herdr reports no session id yet", async () =>
	{
		const launch = vi.fn<(request: {cwd: string; args: string[]}) => Promise<HerdrLaunchResponse>>(async () =>
			Promise.resolve(
				{
					ok: true,
					tabId: "t",
					paneId: "p",
					sessionId: null,
				},
			),
		);
		const toasts: ToastOptions[] = [];
		await startSessionOnModel(
			"/repo",
			"claude-opus-4-5",
			{
				launch,
				toast: (options) => toasts.push(options),
				open: () =>
				{
				},
			},
		);
		expect(toasts).toStrictEqual([
			{
				kind: "success",
				message: "Started a session in a new terminal tab",
			},
		]);
	});

	it("toasts the launch error", async () =>
	{
		const launch = vi.fn<(request: {cwd: string; args: string[]}) => Promise<HerdrLaunchResponse>>(async () =>
			Promise.reject(new Error("herdr is not running")),
		);
		const toasts: ToastOptions[] = [];
		await startSessionOnModel(
			"/repo",
			"claude-opus-4-5",
			{
				launch,
				toast: (options) => toasts.push(options),
				open: () =>
				{
				},
			},
		);
		expect(toasts).toStrictEqual([
			{
				kind: "error",
				message: "Couldn’t start a session. Try again.",
				description: "herdr is not running",
			},
		]);
	});
});
