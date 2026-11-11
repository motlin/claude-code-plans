// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {useContext} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {EntriesContext, useComposerNotice} from "../src/components/composer-notice-context";
import {ComposerNoticeProvider, ComposerNoticeRegion} from "../src/components/composer-notice-region";
import {
	REFUSAL_FLAGGED_COPY,
	RefusalFallbackNotice,
	type RefusalOptOutBinding,
} from "../src/components/refusal-fallback-card";
import type {HerdrLaunchResponse} from "../src/lib/api/herdr";
import {startSessionOnModel} from "../src/lib/start-session-on-model";
import type {ToastOptions} from "../src/components/toast-context";
import type {RefusalFallback} from "../src/lib/refusal-fallback";

afterEach(() => {
	cleanup();
});

const FALLBACK: RefusalFallback = {
	originalModel: "claude-opus-4-5",
	fallbackModel: "claude-sonnet-4-5",
	apiRefusalCategory: null,
	apiRefusalCategoryRaw: "weird",
	refusedUserMessageUuid: "u1",
	strike: 1,
	streakOriginalModel: "claude-opus-4-5",
	uuid: "f1",
};

const OFFER: RefusalOptOutBinding = {view: "offer", pending: false, optOut: () => {}, openSettings: () => {}};

function EntryKeys() {
	const entries = useContext(EntriesContext);
	return (
		<output data-testid="entries">
			{[...entries].map(([slot, entry]) => `code-${slot}:${entry.id}`).join(",")}
		</output>
	);
}

function LimitNotice() {
	useComposerNotice("limit", {id: "pace", content: <div data-testid="limit-card">limit</div>});
	return null;
}

interface Props {
	fallback?: RefusalFallback | null;
	optOut?: RefusalOptOutBinding;
	onNewSession?: ((model: string) => void) | undefined;
	onDismiss?: () => void;
	onEditRetry?: (() => boolean) | undefined;
	withLimit?: boolean;
}

function ui({
	fallback = FALLBACK,
	optOut = OFFER,
	onNewSession,
	onDismiss = () => {},
	onEditRetry,
	withLimit = false,
}: Props) {
	return (
		<ComposerNoticeProvider>
			<ComposerNoticeRegion />
			<EntryKeys />
			{withLimit && <LimitNotice />}
			<RefusalFallbackNotice
				fallback={fallback}
				optOut={optOut}
				onNewSession={onNewSession}
				onDismiss={onDismiss}
				onEditRetry={onEditRetry}
			/>
		</ComposerNoticeProvider>
	);
}

const liveCards = () => [...document.querySelectorAll("[data-cds-dock-card]:not([data-cds-dock-leaving])")];
const card = () => screen.getByTestId("code-refusal-card");
const buttonNames = () =>
	[...card().querySelectorAll("button")].map((button) => button.getAttribute("aria-label") ?? button.textContent);

describe("RefusalFallbackNotice", () => {
	it("registers the card in slot refusal as model-switched", () => {
		render(ui({}));
		expect(screen.getByTestId("entries").textContent).toBe("code-refusal:model-switched");
	});

	it("draws upstream's words: Switched to the fallback, a Why TextLink, no icon", () => {
		render(ui({}));
		const atomic = card().querySelector('span[aria-atomic="true"]');
		expect({
			className: atomic?.className,
			children: [...(atomic?.children ?? [])].map((child) => ({
				className: child.className,
				text: child.textContent,
			})),
		}).toStrictEqual({
			className: "flex flex-wrap items-baseline gap-x-2.5 gap-y-0.75",
			children: [{className: "min-w-0", text: "Switched to Sonnet 4.5 Why"}],
		});
		const why = screen.getByRole("button", {name: "Why"});
		expect({cds: why.dataset["cds"], className: why.className}).toStrictEqual({
			cds: "TextLink",
			className: "cds-reset text-link shrink-0 text-body cursor-pointer",
		});
		expect(card().getAttribute("data-icon-layout")).toBe("first-line");
		// No icon slot: the body is the Banner's first child.
		expect(card().firstElementChild?.className.startsWith("flex min-w-0 flex-wrap")).toBe(true);
	});

	it("opens the Why card on hover after the delay, with the flagged copy and the raw category", async () => {
		render(ui({}));
		const why = screen.getByRole("button", {name: "Why"});
		fireEvent.pointerEnter(why, {pointerType: "mouse"});
		fireEvent.mouseEnter(why);
		fireEvent.mouseMove(why);
		expect(document.querySelector("[data-refusal-why-card]")).toBeNull();
		const popup = await waitFor(() => {
			const found = document.querySelector("[data-refusal-why-card]");
			if (!(found instanceof HTMLElement)) throw new Error("no card");
			return found;
		});
		// jsdom has no layout, so the 48px top collision padding flips the side; only the align is stable.
		expect({
			align: popup.getAttribute("data-align"),
			children: [...popup.children].map((child) => ({
				className: child.className,
				text: child.textContent,
			})),
			code: popup.querySelector("code")?.className,
		}).toStrictEqual({
			align: "start",
			children: [
				{
					className: "text-footnote font-medium text-secondary pb-1.5 comfortable:pb-2",
					text: "Switched to Sonnet 4.5",
				},
				{className: "text-pretty text-body text-muted-as-secondary break-words", text: REFUSAL_FLAGGED_COPY},
				{
					className: "block text-body text-muted-as-secondary pt-1.5 comfortable:pt-2",
					text: "Details: [weird]",
				},
			],
			code: "font-mono-ui break-all",
		});
		expect(REFUSAL_FLAGGED_COPY).toBe(
			"This model's safeguards flagged this message. This sometimes happens with safe, normal conversations.",
		);
	});

	it("leaves the Details line out when the raw category is missing", async () => {
		render(ui({fallback: {...FALLBACK, apiRefusalCategoryRaw: null}}));
		const why = screen.getByRole("button", {name: "Why"});
		fireEvent.focus(why);
		const popup = await waitFor(() => {
			const found = document.querySelector("[data-refusal-why-card]");
			if (!(found instanceof HTMLElement)) throw new Error("no card");
			return found;
		});
		expect([...popup.children].map((child) => child.textContent)).toStrictEqual([
			"Switched to Sonnet 4.5",
			REFUSAL_FLAGGED_COPY,
		]);
	});

	it("dismisses once and stays gone for that fallback", () => {
		const onDismiss = vi.fn<() => void>();
		const {rerender} = render(ui({onDismiss}));
		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));
		expect(onDismiss).toHaveBeenCalledTimes(1);
		rerender(ui({onDismiss}));
		expect(screen.getByTestId("entries").textContent).toBe("");
		rerender(ui({onDismiss, fallback: {...FALLBACK, uuid: "f2"}}));
		expect(screen.getByTestId("entries").textContent).toBe("code-refusal:model-switched");
	});

	it("withdraws the card when there is no fallback", () => {
		render(ui({fallback: null}));
		expect(screen.getByTestId("entries").textContent).toBe("");
	});

	it("is ordered after the limit notice", () => {
		render(ui({withLimit: true}));
		expect(screen.getByTestId("entries").textContent).toBe("code-limit:pace,code-refusal:model-switched");
		const cards = liveCards();
		expect(cards.map((item) => item.querySelector("[data-testid]")?.getAttribute("data-testid"))).toStrictEqual([
			"limit-card",
			"code-refusal-card",
		]);
	});

	describe("opt-out", () => {
		it("offers Don’t switch models automatically and calls optOut", () => {
			const optOut = vi.fn<() => void>();
			render(ui({optOut: {...OFFER, optOut}}));
			const group = card().querySelector("div.flex.min-w-0.flex-wrap.items-center.gap-xs");
			expect([...(group?.querySelectorAll("button") ?? [])].map((button) => button.textContent)).toStrictEqual([
				"Don’t switch models automatically",
			]);
			fireEvent.click(screen.getByRole("button", {name: "Don’t switch models automatically"}));
			expect(optOut).toHaveBeenCalledTimes(1);
		});

		it("marks the opt-out busy while the write is pending", () => {
			render(ui({optOut: {...OFFER, pending: true}}));
			const button = card().querySelector('[data-approval-variant="secondary"]');
			expect(button?.getAttribute("aria-busy")).toBe("true");
		});

		it("shows Automatic switching is off. and Open settings in the off view", () => {
			const openSettings = vi.fn<() => void>();
			render(ui({optOut: {...OFFER, view: "off", openSettings}}));
			const atomic = card().querySelector('span[aria-atomic="true"]');
			expect([...(atomic?.children ?? [])].map((child) => [child.className, child.textContent])).toStrictEqual([
				["min-w-0", "Switched to Sonnet 4.5 Why"],
				["min-w-0 text-secondary", "Automatic switching is off."],
			]);
			fireEvent.click(screen.getByRole("button", {name: "Open settings"}));
			expect(openSettings).toHaveBeenCalledTimes(1);
		});

		it("draws no opt-out when hidden", () => {
			render(ui({optOut: {...OFFER, view: "hidden"}}));
			expect(buttonNames()).toStrictEqual(["Why", "Dismiss"]);
		});
	});

	describe("escalated", () => {
		it("offers Start a new session on the streak's original model at strike 2", () => {
			const onNewSession = vi.fn<(model: string) => void>();
			render(ui({fallback: {...FALLBACK, strike: 2}, onNewSession, optOut: {...OFFER, view: "hidden"}}));
			expect(buttonNames()).toStrictEqual(["Why", "Start a new session", "Dismiss"]);
			expect(screen.queryByRole("button", {name: "Rewind and retry"})).toBeNull();
			fireEvent.click(screen.getByRole("button", {name: "Start a new session"}));
			expect(onNewSession.mock.calls).toStrictEqual([["claude-opus-4-5"]]);
		});

		it("puts Start a new session before the opt-out", () => {
			render(ui({fallback: {...FALLBACK, strike: 2}, onNewSession: () => {}}));
			expect(buttonNames()).toStrictEqual([
				"Why",
				"Start a new session",
				"Don’t switch models automatically",
				"Dismiss",
			]);
		});

		it("offers no new session at strike 1", () => {
			render(ui({onNewSession: () => {}}));
			expect(screen.queryByRole("button", {name: "Start a new session"})).toBeNull();
		});

		it("offers no new session without a launcher", () => {
			render(ui({fallback: {...FALLBACK, strike: 2}, onNewSession: undefined}));
			expect(screen.queryByRole("button", {name: "Start a new session"})).toBeNull();
		});
	});

	describe("Rewind and retry", () => {
		it("is the primary CTA at strike 1, before the opt-out, as a secondary button", () => {
			const onEditRetry = vi.fn<() => boolean>(() => true);
			render(ui({onEditRetry}));
			expect(buttonNames()).toStrictEqual([
				"Why",
				"Rewind and retry",
				"Don’t switch models automatically",
				"Dismiss",
			]);
			const button = screen.getByRole("button", {name: "Rewind and retry"});
			expect({tag: button.tagName, variant: button.getAttribute("data-approval-variant")}).toStrictEqual({
				tag: "BUTTON",
				variant: "secondary",
			});
			fireEvent.click(button);
			expect(onEditRetry.mock.calls).toStrictEqual([[]]);
		});

		it("is absent without a handler", () => {
			render(ui({onEditRetry: undefined}));
			expect(screen.queryByRole("button", {name: "Rewind and retry"})).toBeNull();
		});

		it("gives way to Start a new session when escalated", () => {
			render(ui({fallback: {...FALLBACK, strike: 2}, onNewSession: () => {}, onEditRetry: () => true}));
			expect(buttonNames()).toStrictEqual([
				"Why",
				"Start a new session",
				"Don’t switch models automatically",
				"Dismiss",
			]);
		});

		it("is not offered when escalated without a launcher", () => {
			render(
				ui({fallback: {...FALLBACK, strike: 2}, onEditRetry: () => true, optOut: {...OFFER, view: "hidden"}}),
			);
			expect(buttonNames()).toStrictEqual(["Why", "Dismiss"]);
		});
	});
});

describe("startSessionOnModel", () => {
	it("launches claude in the session's folder with --model", async () => {
		const launch = vi.fn<(request: {cwd: string; args: string[]}) => Promise<HerdrLaunchResponse>>(async () =>
			Promise.resolve({ok: true, tabId: "t", paneId: "p", sessionId: "new"}),
		);
		const toasts: ToastOptions[] = [];
		const opened: string[] = [];
		await act(async () => {
			await startSessionOnModel("/repo", "claude-opus-4-5", {
				launch,
				toast: (options) => toasts.push(options),
				open: (id) => opened.push(id),
			});
		});
		expect({calls: launch.mock.calls, toasts, opened}).toStrictEqual({
			calls: [[{cwd: "/repo", args: ["--model", "claude-opus-4-5"]}]],
			toasts: [],
			opened: ["new"],
		});
	});

	it("toasts success when herdr reports no session id yet", async () => {
		const launch = vi.fn<(request: {cwd: string; args: string[]}) => Promise<HerdrLaunchResponse>>(async () =>
			Promise.resolve({ok: true, tabId: "t", paneId: "p", sessionId: null}),
		);
		const toasts: ToastOptions[] = [];
		await startSessionOnModel("/repo", "claude-opus-4-5", {
			launch,
			toast: (options) => toasts.push(options),
			open: () => {},
		});
		expect(toasts).toStrictEqual([{kind: "success", message: "Started a session in a new terminal tab"}]);
	});

	it("toasts the launch error", async () => {
		const launch = vi.fn<(request: {cwd: string; args: string[]}) => Promise<HerdrLaunchResponse>>(async () =>
			Promise.reject(new Error("herdr is not running")),
		);
		const toasts: ToastOptions[] = [];
		await startSessionOnModel("/repo", "claude-opus-4-5", {
			launch,
			toast: (options) => toasts.push(options),
			open: () => {},
		});
		expect(toasts).toStrictEqual([
			{kind: "error", message: "Couldn’t start a session. Try again.", description: "herdr is not running"},
		]);
	});
});
