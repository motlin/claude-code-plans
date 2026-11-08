// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ToastProvider} from "../src/components/toast";
import {useToast, type ToastKind, type ToastOptions} from "../src/components/toast-context";
import {FIZZY_LAKE_PARTS, FizzyLakeContext, type FizzyLakePart} from "../src/lib/fizzy-lake";

function Trigger({options}: {options: ToastOptions}) {
	const toast = useToast();
	return (
		<button
			type="button"
			onClick={() => {
				toast(options);
			}}
		>
			fire
		</button>
	);
}

function renderWithToast(options: ToastOptions) {
	render(
		<ToastProvider>
			<Trigger options={options} />
		</ToastProvider>,
	);
	fireEvent.click(screen.getByRole("button", {name: "fire"}));
}

function notifications(): HTMLElement {
	return screen.getByRole("region", {name: "Notifications"});
}

/** Dismiss is aria-hidden until the deck is hovered or focused, so it has no accessible name at rest. */
function dismissButton(): HTMLButtonElement {
	const button = notifications().querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
	if (!button) throw new Error("no Dismiss button");
	return button;
}

/** Toast titles in DOM order (newest first, as upstream's Base UI viewport). */
function toastTexts(): string[] {
	return Array.from(notifications().querySelectorAll("[data-toast]")).map(
		(el) => el.querySelector("[data-toast-message]")?.textContent ?? "",
	);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("ToastProvider", () => {
	it("is a notifications F6 stop only while it holds a toast", () => {
		render(
			<ToastProvider>
				<Trigger options={{message: "Link copied to clipboard.", kind: "success"}} />
			</ToastProvider>,
		);
		const stops = () => document.querySelectorAll('[data-focus-region="notifications"]').length;
		const before = stops();
		fireEvent.click(screen.getByRole("button", {name: "fire"}));

		expect({before, after: stops()}).toStrictEqual({before: 0, after: 1});
	});

	it("keeps the F6 landing ring's data-cds=Toast on the viewport around every toast", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const toasts = Array.from(notifications().querySelectorAll("[data-toast]"));
		expect(
			toasts.map((el) => ({
				own: el.getAttribute("data-cds"),
				viewport: el.closest("[data-cds]")?.getAttribute("data-cds"),
			})),
		).toStrictEqual([{own: null, viewport: "Toast"}]);
	});

	it("renders success toasts in the one polite Notifications region", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		expect({live: notifications().getAttribute("aria-live"), texts: toastTexts()}).toStrictEqual({
			live: "polite",
			texts: ["Link copied to clipboard."],
		});
	});

	it("renders error toasts in the same polite region, with no assertive region", () => {
		renderWithToast({message: "Couldn’t save the new name. Try again.", kind: "error"});

		expect({
			texts: toastTexts(),
			alert: screen.queryByRole("alert"),
			assertive: document.querySelector('[aria-live="assertive"]'),
		}).toStrictEqual({texts: ["Couldn’t save the new name. Try again."], alert: null, assertive: null});
	});

	it("auto-dismisses after the default 4 seconds", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		act(() => {
			vi.advanceTimersByTime(3999);
		});
		expect(toastTexts()).toEqual(["Link copied to clipboard."]);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts()).toEqual([]);
	});

	it("keeps a toast with no duration up until its signal aborts, like upstream's timeout Infinity", () => {
		const controller = new AbortController();
		renderWithToast({message: "Rewinding…", kind: "success", durationMs: null, signal: controller.signal});

		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		const held = toastTexts();
		act(() => {
			controller.abort();
		});

		expect({held, after: toastTexts()}).toStrictEqual({held: ["Rewinding…"], after: []});
	});

	it("drops a toast whose signal already aborted", () => {
		renderWithToast({message: "Rewinding…", kind: "success", signal: AbortSignal.abort()});

		expect(toastTexts()).toStrictEqual([]);
	});

	it("honors a custom duration", () => {
		renderWithToast({message: "Archived 3 sessions", kind: "success", durationMs: 3000});

		act(() => {
			vi.advanceTimersByTime(2999);
		});
		expect(toastTexts()).toEqual(["Archived 3 sessions"]);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts()).toEqual([]);
	});

	it("pauses the timer while hovered and resumes with the remaining time", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});
		act(() => {
			vi.advanceTimersByTime(3000);
		});

		const toastEl = notifications().querySelector("[data-toast]");
		if (!toastEl) throw new Error("toast not rendered");
		fireEvent.mouseEnter(toastEl);
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(toastTexts()).toEqual(["Link copied to clipboard."]);

		fireEvent.mouseLeave(toastEl);
		act(() => {
			vi.advanceTimersByTime(999);
		});
		expect(toastTexts()).toEqual(["Link copied to clipboard."]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts()).toEqual([]);
	});

	it("pauses the timer while focus is inside the toast", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const dismiss = dismissButton();
		fireEvent.focus(dismiss);
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(toastTexts()).toEqual(["Link copied to clipboard."]);

		fireEvent.blur(dismiss);
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(toastTexts()).toEqual([]);
	});

	it("runs the action once and closes the toast", () => {
		const onAction = vi.fn<() => void>();
		renderWithToast({
			message: "Archived 1 session",
			kind: "success",
			action: {label: "Undo", onAction},
		});

		fireEvent.click(screen.getByRole("button", {name: "Undo"}));

		expect(onAction).toHaveBeenCalledTimes(1);
		expect(toastTexts()).toEqual([]);
		expect(screen.queryByRole("button", {name: "Undo"})).toBeNull();
	});

	it("closes the toast from the dismiss button without running the action", () => {
		const onAction = vi.fn<() => void>();
		renderWithToast({
			message: "Unpinned Fix login",
			kind: "success",
			action: {label: "Undo", onAction},
		});

		fireEvent.click(dismissButton());

		expect(onAction).not.toHaveBeenCalled();
		expect(toastTexts()).toEqual([]);
	});

	it("lists distinct toasts newest first, as upstream's Base UI viewport", () => {
		const fire = renderTriggers([
			{message: "Link copied to clipboard.", kind: "success"},
			{message: "Archived 1 session", kind: "success"},
		]);
		fire(0);
		fire(1);

		expect(toastTexts()).toEqual(["Archived 1 session", "Link copied to clipboard."]);
	});

	it("anchors the viewport bottom-right", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		expect(notifications().closest("[data-position]")?.getAttribute("data-position")).toBe("bottom-right");
	});

	it("renders an info icon before the message on a borderless card", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const toastEl = notifications().querySelector("[data-toast]");
		if (!toastEl) throw new Error("toast not rendered");
		const icon = toastEl.querySelector("[data-toast-icon]");
		const message = toastEl.querySelector("[data-toast-message]");
		if (!icon || !message) throw new Error("toast icon or message missing");
		expect({
			icon: icon.getAttribute("data-toast-icon"),
			iconBeforeMessage: Boolean(icon.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_FOLLOWING),
			borderClasses: toastEl.className.split(/\s+/).filter((c) => /^border(-|$)/.test(c)),
		}).toEqual({icon: "info", iconBeforeMessage: true, borderClasses: []});
	});

	it("renders error toasts as upstream addError's warning variant", () => {
		renderWithToast({message: "Couldn’t archive this session. Try again.", kind: "error"});

		const el = notifications().querySelector("[data-toast]");
		expect({
			kind: el?.getAttribute("data-kind"),
			type: el?.getAttribute("data-type"),
			icon: el?.querySelector("[data-toast-icon]")?.getAttribute("data-toast-icon"),
		}).toStrictEqual({kind: "error", type: "warning", icon: "warning"});
	});

	it("renders addDanger twins as the danger variant", () => {
		renderWithToast({message: "Failed to send response. You can try again.", kind: "danger"});

		const el = notifications().querySelector("[data-toast]");
		expect({
			kind: el?.getAttribute("data-kind"),
			type: el?.getAttribute("data-type"),
			icon: el?.querySelector("[data-toast-icon]")?.getAttribute("data-toast-icon"),
		}).toStrictEqual({kind: "danger", type: "danger", icon: "danger"});
	});

	it("marks success toasts neutral and warning toasts warning, as upstream's data-type", () => {
		const fire = renderTriggers([
			{message: "Copied", kind: "success"},
			{message: "Careful", kind: "warning"},
		]);
		fire(0);
		fire(1);
		const typeOf = (message: string) =>
			screen.getByText(message).closest("[data-toast]")?.getAttribute("data-type");

		expect({success: typeOf("Copied"), warning: typeOf("Careful")}).toStrictEqual({
			success: "neutral",
			warning: "warning",
		});
	});

	it("folds an error and a warning with the same text, as upstream's toastType identity", () => {
		const fire = renderTriggers([
			{message: "Careful", kind: "error"},
			{message: "Careful", kind: "warning"},
		]);
		fire(0);
		fire(1);

		expect(toastTexts()).toStrictEqual(["Careful (×2)"]);
	});

	it("keeps a danger and an error with the same text as two toasts", () => {
		const fire = renderTriggers([
			{message: "Broke", kind: "danger"},
			{message: "Broke", kind: "error"},
		]);
		fire(0);
		fire(1);

		expect(toastTexts()).toStrictEqual(["Broke", "Broke"]);
	});

	it("throws when useToast is called outside a provider", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => render(<Trigger options={{message: "x", kind: "success"}} />)).toThrow(
			"useToast must be used within a ToastProvider",
		);
	});
});

function MultiTrigger({batches}: {batches: ToastOptions[]}) {
	const toast = useToast();
	return (
		<>
			{batches.map((options, index) => (
				<button
					key={index}
					type="button"
					onClick={() => {
						toast(options);
					}}
				>
					{`fire ${index}`}
				</button>
			))}
		</>
	);
}

function renderTriggers(batches: ToastOptions[]) {
	render(
		<ToastProvider>
			<MultiTrigger batches={batches} />
		</ToastProvider>,
	);
	return (index: number) => {
		fireEvent.click(screen.getByRole("button", {name: `fire ${index}`}));
	};
}

function deck() {
	return [...document.querySelectorAll<HTMLElement>("[data-toast]")]
		.map((element) => ({
			message: element.querySelector("[data-toast-message]")?.textContent,
			transform: element.style.transform,
			behind: element.hasAttribute("data-behind"),
		}))
		.toSorted((a, b) => Number(a.behind) - Number(b.behind));
}

describe("ToastProvider deck", () => {
	it("stacks toasts as upstream's deck: each older one 14px up and 4% smaller, its content hidden behind the front", () => {
		const fire = renderTriggers([
			{message: "First", kind: "success"},
			{message: "Second", kind: "error"},
		]);
		fire(0);
		fire(1);

		expect(deck()).toStrictEqual([
			{message: "Second", transform: "translateY(0px) scale(1)", behind: false},
			{message: "First", transform: "translateY(-14px) scale(0.96)", behind: true},
		]);
	});

	it("gives error and warning toasts upstream's warning icon on an untinted fizzy card", () => {
		const fire = renderTriggers([
			{message: "Broke", kind: "error"},
			{message: "Careful", kind: "warning"},
		]);
		fire(0);
		fire(1);
		const variant = (message: string) => {
			const toast = screen.getByText(message).closest<HTMLElement>("[data-toast]");
			return {
				kind: toast?.getAttribute("data-kind"),
				icon: toast?.querySelector("[data-toast-icon]")?.getAttribute("data-toast-icon"),
				tinted: toast?.className.includes("color-mix") ?? false,
			};
		};
		expect([variant("Broke"), variant("Careful")]).toStrictEqual([
			{kind: "error", icon: "warning", tinted: false},
			{kind: "warning", icon: "warning", tinted: false},
		]);
	});

	it("keeps error and warning toasts for 10 seconds", () => {
		renderWithToast({message: "Couldn’t save.", kind: "error"});
		act(() => {
			vi.advanceTimersByTime(9999);
		});
		expect(toastTexts()).toEqual(["Couldn’t save."]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts()).toEqual([]);
	});

	it("keeps a toast with an action until it is used or dismissed", () => {
		renderWithToast({message: "Archived 1 session", kind: "success", action: {label: "Undo", onAction: () => {}}});
		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		expect(toastTexts()).toEqual(["Archived 1 session"]);
	});

	it("folds a repeat into the open toast as (×2), keeping it at least 6 more seconds", () => {
		const fire = renderTriggers([{message: "Link copied", kind: "success"}]);
		fire(0);
		act(() => {
			vi.advanceTimersByTime(3500);
		});
		fire(0);

		expect(toastTexts()).toEqual(["Link copied (×2)"]);
		act(() => {
			vi.advanceTimersByTime(5999);
		});
		expect(toastTexts()).toEqual(["Link copied (×2)"]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts()).toEqual([]);
	});
});

const NO_FIZZY_PARTS: readonly FizzyLakePart[] = [];

function renderKinds(kinds: readonly ToastKind[], fizzyColor = true) {
	const batches = kinds.map((kind) => ({message: `toast ${kind}`, kind}));
	render(
		<FizzyLakeContext.Provider value={fizzyColor ? FIZZY_LAKE_PARTS : NO_FIZZY_PARTS}>
			<ToastProvider>
				<MultiTrigger batches={batches} />
			</ToastProvider>
		</FizzyLakeContext.Provider>,
	);
	for (const [index] of batches.entries()) {
		fireEvent.click(screen.getByRole("button", {name: `fire ${index}`}));
	}
	return (kind: ToastKind) => {
		const toast = within(notifications()).getByText(`toast ${kind}`).closest<HTMLElement>("[data-toast]");
		if (!toast) throw new Error(`no ${kind} toast`);
		const icon = toast.querySelector<SVGElement>("[data-toast-icon]");
		if (!icon) throw new Error(`no ${kind} icon`);
		return {toast, icon, classes: toast.className.split(/\s+/)};
	};
}

const ALL_KINDS: readonly ToastKind[] = ["success", "warning", "error", "danger"];

describe("ToastProvider variants", () => {
	it("draws every fizzy-color card untinted with shadow-panel-md and primary ink, as upstream's stacks: classes", () => {
		const of = renderKinds(ALL_KINDS);
		const card = (kind: ToastKind) => {
			const {classes} = of(kind);
			return {
				surface: classes.includes("bg-surface-popover"),
				ink: classes.includes("text-primary"),
				shadow: classes.includes("shadow-panel-md"),
				leftovers: classes.filter((c) =>
					/color-mix|shadow-\[|text-(warning|danger)-000|shadow-panel-sm/.test(c),
				),
			};
		};
		const expected = {surface: true, ink: true, shadow: true, leftovers: []};

		expect(Object.fromEntries(ALL_KINDS.map((kind) => [kind, card(kind)]))).toStrictEqual({
			success: expected,
			warning: expected,
			error: expected,
			danger: expected,
		});
	});

	it("puts the hue only on the icon wrapper: text-fill-warning, text-fill-danger, text-secondary", () => {
		const of = renderKinds(ALL_KINDS);
		const ink = (kind: ToastKind) =>
			(of(kind).icon.parentElement?.getAttribute("class") ?? "")
				.split(/\s+/)
				.filter((c) => c.startsWith("text-"));

		expect(Object.fromEntries(ALL_KINDS.map((kind) => [kind, ink(kind)]))).toStrictEqual({
			success: ["text-secondary"],
			warning: ["text-fill-warning"],
			error: ["text-fill-warning"],
			danger: ["text-fill-danger"],
		});
	});

	it("keeps the pre-fizzy warning and danger tints when color is off", () => {
		const of = renderKinds(["error", "danger"], false);
		const tint = (kind: ToastKind) => {
			const {classes} = of(kind);
			return {
				tint: classes.some((c) => c.includes("color-mix(in_srgb,var(--color-warning-100)_10%")),
				dangerTint: classes.some((c) => c.includes("color-mix(in_srgb,var(--color-danger-100)_10%")),
				ink: classes.filter((c) => /^text-(warning|danger)-000$/.test(c)),
				shadow: classes.filter((c) => c.includes("shadow-panel")),
			};
		};

		expect({error: tint("error"), danger: tint("danger")}).toStrictEqual({
			error: {
				tint: true,
				dangerTint: false,
				ink: ["text-warning-000"],
				shadow: [
					"shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-warning-100)_35%,transparent),var(--shadow-panel-md)]",
				],
			},
			danger: {
				tint: false,
				dangerTint: true,
				ink: ["text-danger-000"],
				shadow: [
					"shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-danger-100)_35%,transparent),var(--shadow-panel-md)]",
				],
			},
		});
	});

	it("swaps in upstream's filled WarningFilled / WarningCircleFilled glyphs at 20px under fizzy color", () => {
		const of = renderKinds(ALL_KINDS);
		const glyph = (kind: ToastKind) => {
			const {icon} = of(kind);
			const path = icon.querySelector("path");
			return {
				icon: icon.getAttribute("data-toast-icon"),
				filled: icon.hasAttribute("data-filled"),
				width: icon.getAttribute("width"),
				height: icon.getAttribute("height"),
				...(icon.hasAttribute("data-filled")
					? {fill: path?.getAttribute("fill"), stroke: path?.getAttribute("stroke") ?? null}
					: {}),
			};
		};

		expect(Object.fromEntries(ALL_KINDS.map((kind) => [kind, glyph(kind)]))).toStrictEqual({
			success: {icon: "info", filled: false, width: "20", height: "20"},
			warning: {icon: "warning", filled: true, width: "20", height: "20", fill: "currentColor", stroke: null},
			error: {icon: "warning", filled: true, width: "20", height: "20", fill: "currentColor", stroke: null},
			danger: {icon: "danger", filled: true, width: "20", height: "20", fill: "currentColor", stroke: null},
		});
	});

	it("keeps the outline Warning / WarningCircle glyphs when color is off", () => {
		const of = renderKinds(["warning", "danger"], false);
		const glyph = (kind: ToastKind) => {
			const {icon} = of(kind);
			return {
				icon: icon.getAttribute("data-toast-icon"),
				filled: icon.hasAttribute("data-filled"),
				width: icon.getAttribute("width"),
			};
		};

		expect({warning: glyph("warning"), danger: glyph("danger")}).toStrictEqual({
			warning: {icon: "warning", filled: false, width: "20"},
			danger: {icon: "danger", filled: false, width: "20"},
		});
	});
});

function viewport(): HTMLElement {
	const element = document.querySelector<HTMLElement>('[data-cds="Toast"]');
	if (!element) throw new Error("no toast viewport");
	return element;
}

function rootOf(message: string): HTMLElement {
	const root = within(notifications()).getByText(message).closest<HTMLElement>("[data-toast]");
	if (!root) throw new Error(`no toast ${message}`);
	return root;
}

describe("ToastProvider region (upstream cds Toast viewport)", () => {
	it("mounts the viewport with an empty sr-only pinned status slot and the Notifications region", () => {
		render(<ToastProvider>{null}</ToastProvider>);
		const [status, region] = [...viewport().children] as HTMLElement[];

		expect({
			children: [...viewport().children].map((child) => ({
				role: child.getAttribute("role"),
				live: child.getAttribute("aria-live"),
				label: child.getAttribute("aria-label"),
			})),
			region: {
				tabIndex: region?.getAttribute("tabindex"),
				atomic: region?.getAttribute("aria-atomic"),
				relevant: region?.getAttribute("aria-relevant"),
			},
			status: {className: status?.className, children: status?.childElementCount},
		}).toStrictEqual({
			children: [
				{role: "status", live: "polite", label: null},
				{role: "region", live: "polite", label: "Notifications"},
			],
			region: {tabIndex: "-1", atomic: "false", relevant: "additions text"},
			status: {className: "sr-only", children: 0},
		});
	});

	it("puts every kind in the region newest first, with no alert or assertive region", () => {
		const fire = renderTriggers([
			{message: "success msg", kind: "success"},
			{message: "warning msg", kind: "warning"},
			{message: "error msg", kind: "error"},
		]);
		fire(0);
		fire(1);
		fire(2);

		expect({
			texts: toastTexts(),
			alert: screen.queryByRole("alert"),
			assertive: document.querySelector('[aria-live="assertive"]'),
		}).toStrictEqual({texts: ["error msg", "warning msg", "success msg"], alert: null, assertive: null});
	});

	it("copies upstream's viewport and region classes", () => {
		render(<ToastProvider>{null}</ToastProvider>);
		const classes = viewport().className.split(/\s+/);
		const expected = [
			"pointer-events-none",
			"fixed",
			"right-4",
			"bottom-4",
			"flex",
			"w-[360px]",
			"max-w-[calc(100vw-2rem)]",
			"flex-col-reverse",
			"gap-md",
			"[&:where(:root[dir=rtl]_:dir(rtl))]:right-auto",
			"[&:where(:root[dir=rtl]_:dir(rtl))]:left-4",
		];

		expect({
			missing: expected.filter((c) => !classes.includes(c)),
			region: notifications().className,
		}).toStrictEqual({
			missing: [],
			region: "pointer-events-auto relative outline-none focus-visible:outline-hidden",
		});
	});

	it("is the notifications F6 stop on the region only while a toast is up", () => {
		render(
			<ToastProvider>
				<Trigger options={{message: "Link copied to clipboard.", kind: "success"}} />
			</ToastProvider>,
		);
		const stop = () =>
			[...document.querySelectorAll('[data-focus-region="notifications"]')].map((el) => el.getAttribute("role"));
		const before = stop();
		fireEvent.click(screen.getByRole("button", {name: "fire"}));

		expect({before, after: stop()}).toStrictEqual({before: [], after: ["region"]});
	});
});

describe("ToastProvider toast roots (Base UI Toast.Root)", () => {
	it("makes a toast a labelled, described non-modal dialog", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success", description: "Paste it anywhere."});
		const root = screen.getByRole("dialog", {name: "Link copied to clipboard."});
		const describedBy = root.getAttribute("aria-describedby") ?? "";

		expect({
			tabIndex: root.getAttribute("tabindex"),
			modal: root.getAttribute("aria-modal"),
			type: root.getAttribute("data-type"),
			description: document.getElementById(describedBy)?.textContent,
			descriptionTag: document.getElementById(describedBy)?.tagName,
		}).toStrictEqual({
			tabIndex: "0",
			modal: "false",
			type: "neutral",
			description: "Paste it anywhere.",
			descriptionTag: "P",
		});
	});

	it("omits aria-describedby without a description", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		expect(screen.getByRole("dialog", {name: "Link copied to clipboard."}).hasAttribute("aria-describedby")).toBe(
			false,
		);
	});

	it("makes warning and error toasts dialogs of the warning type", () => {
		const fire = renderTriggers([
			{message: "Careful", kind: "warning"},
			{message: "Broke", kind: "error"},
		]);
		fire(0);
		fire(1);

		expect(
			screen.getAllByRole("dialog").map((root) => ({
				name: root.querySelector("[data-toast-message]")?.textContent,
				type: root.getAttribute("data-type"),
			})),
		).toStrictEqual([
			{name: "Broke", type: "warning"},
			{name: "Careful", type: "warning"},
		]);
	});

	it("hides a danger alertdialog and announces it through a visually hidden role=alert until the region is focused", () => {
		renderWithToast({message: "Failed to send.", kind: "danger", description: "Try again."});
		const root = rootOf("Failed to send.");
		const announcer = () => {
			const alert = document.querySelector<HTMLElement>('[role="alert"]');
			if (alert === null) return null;
			const box = alert.parentElement;
			return {
				atomic: alert.getAttribute("aria-atomic"),
				texts: [...alert.children].map((child) => child.textContent),
				afterRegion: box?.previousElementSibling === notifications(),
				hidden: {
					position: box?.style.position,
					clipPath: box?.style.clipPath,
					width: box?.style.width,
					height: box?.style.height,
					margin: box?.style.margin,
					overflow: box?.style.overflow,
					whiteSpace: box?.style.whiteSpace,
				},
			};
		};
		const before = {
			role: root.getAttribute("role"),
			hidden: root.getAttribute("aria-hidden"),
			announcer: announcer(),
		};
		act(() => {
			notifications().focus();
		});

		expect({
			before,
			after: {role: root.getAttribute("role"), hidden: root.getAttribute("aria-hidden"), announcer: announcer()},
		}).toStrictEqual({
			before: {
				role: "alertdialog",
				hidden: "true",
				announcer: {
					atomic: "true",
					texts: ["Failed to send.", "Try again."],
					afterRegion: true,
					hidden: {
						position: "fixed",
						clipPath: "inset(50%)",
						width: "1px",
						height: "1px",
						margin: "-1px",
						overflow: "hidden",
						whiteSpace: "nowrap",
					},
				},
			},
			after: {role: "alertdialog", hidden: null, announcer: null},
		});
	});
});

describe("ToastProvider title and description", () => {
	it("titles a toast with h2.font-medium[aria-atomic] around a message span", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});
		const title = notifications().querySelector("[data-toast-message]");

		expect({
			tag: title?.tagName,
			className: title?.className,
			atomic: title?.getAttribute("aria-atomic"),
			first: {tag: title?.firstElementChild?.tagName, text: title?.firstElementChild?.textContent},
			wrapper: title?.parentElement?.className,
		}).toStrictEqual({
			tag: "H2",
			className: "font-medium",
			atomic: "true",
			first: {tag: "SPAN", text: "Link copied to clipboard."},
			wrapper: "min-w-0 flex-1 text-pretty break-words",
		});
	});

	it("puts the fold count in a data-cds-toast-count span, aria-live off past two", () => {
		const fire = renderTriggers([{message: "Careful", kind: "warning"}]);
		const count = () => {
			const span = notifications().querySelector("[data-cds-toast-count]");
			return {
				title: notifications().querySelector("[data-toast-message]")?.textContent,
				count: span?.textContent,
				live: span?.getAttribute("aria-live") ?? null,
			};
		};
		fire(0);
		fire(0);
		const twice = count();
		fire(0);

		expect({twice, thrice: count()}).toStrictEqual({
			twice: {title: "Careful (×2)", count: " (×2)", live: null},
			thrice: {title: "Careful (×3)", count: " (×3)", live: "off"},
		});
	});

	it("renders the description as p.text-secondary with an id and no top margin", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success", description: "Paste it anywhere."});
		const description = screen.getByText("Paste it anywhere.");

		expect({
			tag: description.tagName,
			className: description.className,
			hasId: description.id !== "",
		}).toStrictEqual({tag: "P", className: "text-secondary", hasId: true});
	});
});

/** Tabbable elements in document order: what Tab walks through. */
function tabOrder(): string[] {
	return [...notifications().querySelectorAll<HTMLElement>('[tabindex="0"], button')].map((el) =>
		el.tagName === "BUTTON"
			? `dismiss ${el.closest("[data-toast]")?.querySelector("[data-toast-message]")?.textContent}`
			: `root ${el.querySelector("[data-toast-message]")?.textContent}`,
	);
}

function renderDeckWithOutsideButton() {
	const fire = renderTriggers([
		{message: "First", kind: "success"},
		{message: "Second", kind: "success"},
		{message: "Third", kind: "success"},
	]);
	const outside = screen.getByRole("button", {name: "fire 0"});
	fire(0);
	fire(1);
	fire(2);
	act(() => {
		outside.focus();
	});
	return outside;
}

function focusedLabel(): string {
	const active = document.activeElement;
	if (!(active instanceof HTMLElement)) return "none";
	if (active.hasAttribute("data-toast")) return `root ${active.querySelector("[data-toast-message]")?.textContent}`;
	return active.textContent;
}

describe("ToastProvider keyboard (Base UI Toast)", () => {
	it("tabs from the region to the newest root, its Dismiss, then the next older root", () => {
		renderDeckWithOutsideButton();

		expect(tabOrder().slice(0, 3)).toStrictEqual(["root Third", "dismiss Third", "root Second"]);
	});

	it("closes the focused toast on Escape and hands focus to the next older, then newer, then the pre-F6 element", () => {
		const outside = renderDeckWithOutsideButton();
		act(() => {
			notifications().focus();
		});
		act(() => {
			rootOf("Second").focus();
		});
		const escape = () => {
			fireEvent.keyDown(document.activeElement ?? document.body, {key: "Escape"});
		};
		const steps: {texts: string[]; focused: string}[] = [];
		for (let i = 0; i < 3; i++) {
			escape();
			steps.push({texts: toastTexts(), focused: focusedLabel()});
		}

		expect({steps, restored: document.activeElement === outside}).toStrictEqual({
			steps: [
				{texts: ["Third", "First"], focused: "root First"},
				{texts: ["Third"], focused: "root Third"},
				{texts: [], focused: "fire 0"},
			],
			restored: true,
		});
	});

	it("hands focus off when a focused Dismiss is clicked instead of dropping it to the body", () => {
		renderDeckWithOutsideButton();
		act(() => {
			notifications().focus();
		});
		const dismiss = rootOf("Third").querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]');
		if (!dismiss) throw new Error("no dismiss");
		act(() => {
			dismiss.focus();
		});
		fireEvent.click(dismiss);

		expect({texts: toastTexts(), focused: focusedLabel()}).toStrictEqual({
			texts: ["Second", "First"],
			focused: "root Second",
		});
	});

	it("restores the pre-F6 element on Shift+Tab from the region itself", () => {
		const outside = renderDeckWithOutsideButton();
		act(() => {
			notifications().focus();
		});
		fireEvent.keyDown(notifications(), {key: "Tab", shiftKey: true});

		expect(document.activeElement === outside).toBe(true);
	});

	it("hides Dismiss from assistive tech at rest and exposes it while the deck is hovered or focused", () => {
		renderDeckWithOutsideButton();
		const state = () => ({
			dismissHidden: [...notifications().querySelectorAll('button[aria-label="Dismiss"]')].map((b) =>
				b.getAttribute("aria-hidden"),
			),
			expanded: [notifications(), ...notifications().querySelectorAll("[data-toast]")].map((el) =>
				el.hasAttribute("data-expanded"),
			),
		});
		const rest = state();
		fireEvent.mouseEnter(notifications());
		const hovered = state();
		fireEvent.mouseLeave(notifications());
		act(() => {
			notifications().focus();
		});
		const focused = state();

		expect({rest, hovered, focused}).toStrictEqual({
			rest: {dismissHidden: ["true", "true", "true"], expanded: [false, false, false, false]},
			hovered: {dismissHidden: [null, null, null], expanded: [true, true, true, true]},
			focused: {dismissHidden: [null, null, null], expanded: [true, true, true, true]},
		});
	});

	it("pauses timers while the window is blurred and resumes on focus", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});
		fireEvent.blur(window);
		act(() => {
			vi.advanceTimersByTime(5000);
		});
		const held = toastTexts();
		fireEvent.focus(window);
		act(() => {
			vi.advanceTimersByTime(4000);
		});

		expect({held, after: toastTexts()}).toStrictEqual({held: ["Link copied to clipboard."], after: []});
	});
});

describe("ToastProvider forced colors", () => {
	it("borders every card in CanvasText under forced colors, as upstream's popover surface", () => {
		renderKinds(ALL_KINDS);

		expect(
			[...notifications().querySelectorAll("[data-toast]")].map((card) =>
				["forced-colors:border", "forced-colors:border-solid", "forced-colors:border-[color:CanvasText]"].every(
					(c) => card.classList.contains(c),
				),
			),
		).toStrictEqual([true, true, true, true]);
	});
});
