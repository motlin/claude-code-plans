// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
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

function toastTexts(role: "status" | "alert"): string[] {
	return Array.from(screen.getByRole(role).querySelectorAll("[data-toast]")).map(
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

	it("marks each toast data-cds=Toast so an F6 landing ring survives focus moving into it", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const toasts = Array.from(screen.getByRole("status").querySelectorAll("[data-toast]"));
		expect(toasts.map((el) => el.getAttribute("data-cds"))).toStrictEqual(["Toast"]);
	});

	it("renders a success toast in the polite live region", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const polite = screen.getByRole("status");
		expect(polite.getAttribute("aria-live")).toBe("polite");
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);
		expect(toastTexts("alert")).toEqual([]);
	});

	it("renders error toasts in the assertive live region", () => {
		renderWithToast({message: "Couldn’t save the new name. Try again.", kind: "error"});

		const assertive = screen.getByRole("alert");
		expect(assertive.getAttribute("aria-live")).toBe("assertive");
		expect(toastTexts("alert")).toEqual(["Couldn’t save the new name. Try again."]);
		expect(toastTexts("status")).toEqual([]);
	});

	it("auto-dismisses after the default 4 seconds", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		act(() => {
			vi.advanceTimersByTime(3999);
		});
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("status")).toEqual([]);
	});

	it("keeps a toast with no duration up until its signal aborts, like upstream's timeout Infinity", () => {
		const controller = new AbortController();
		renderWithToast({message: "Rewinding…", kind: "success", durationMs: null, signal: controller.signal});

		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		const held = toastTexts("status");
		act(() => {
			controller.abort();
		});

		expect({held, after: toastTexts("status")}).toStrictEqual({held: ["Rewinding…"], after: []});
	});

	it("drops a toast whose signal already aborted", () => {
		renderWithToast({message: "Rewinding…", kind: "success", signal: AbortSignal.abort()});

		expect(toastTexts("status")).toStrictEqual([]);
	});

	it("honors a custom duration", () => {
		renderWithToast({message: "Archived 3 sessions", kind: "success", durationMs: 3000});

		act(() => {
			vi.advanceTimersByTime(2999);
		});
		expect(toastTexts("status")).toEqual(["Archived 3 sessions"]);

		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("status")).toEqual([]);
	});

	it("pauses the timer while hovered and resumes with the remaining time", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});
		act(() => {
			vi.advanceTimersByTime(3000);
		});

		const toastEl = screen.getByRole("status").querySelector("[data-toast]");
		if (!toastEl) throw new Error("toast not rendered");
		fireEvent.mouseEnter(toastEl);
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		fireEvent.mouseLeave(toastEl);
		act(() => {
			vi.advanceTimersByTime(999);
		});
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("status")).toEqual([]);
	});

	it("pauses the timer while focus is inside the toast", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const dismiss = screen.getByRole("button", {name: "Dismiss"});
		fireEvent.focus(dismiss);
		act(() => {
			vi.advanceTimersByTime(10_000);
		});
		expect(toastTexts("status")).toEqual(["Link copied to clipboard."]);

		fireEvent.blur(dismiss);
		act(() => {
			vi.advanceTimersByTime(4000);
		});
		expect(toastTexts("status")).toEqual([]);
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
		expect(toastTexts("status")).toEqual([]);
		expect(screen.queryByRole("button", {name: "Undo"})).toBeNull();
	});

	it("closes the toast from the dismiss button without running the action", () => {
		const onAction = vi.fn<() => void>();
		renderWithToast({
			message: "Unpinned Fix login",
			kind: "success",
			action: {label: "Undo", onAction},
		});

		fireEvent.click(screen.getByRole("button", {name: "Dismiss"}));

		expect(onAction).not.toHaveBeenCalled();
		expect(toastTexts("status")).toEqual([]);
	});

	it("keeps distinct toasts in firing order", () => {
		const fire = renderTriggers([
			{message: "Link copied to clipboard.", kind: "success"},
			{message: "Archived 1 session", kind: "success"},
		]);
		fire(0);
		fire(1);

		expect(toastTexts("status")).toEqual(["Link copied to clipboard.", "Archived 1 session"]);
	});

	it("anchors both live regions bottom-right", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		expect(screen.getByRole("status").closest("[data-position]")?.getAttribute("data-position")).toBe(
			"bottom-right",
		);
		expect(screen.getByRole("alert").closest("[data-position]")?.getAttribute("data-position")).toBe(
			"bottom-right",
		);
	});

	it("renders an info icon before the message on a borderless card", () => {
		renderWithToast({message: "Link copied to clipboard.", kind: "success"});

		const toastEl = screen.getByRole("status").querySelector("[data-toast]");
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

		const el = screen.getByRole("alert").querySelector("[data-toast]");
		expect({
			kind: el?.getAttribute("data-kind"),
			type: el?.getAttribute("data-type"),
			icon: el?.querySelector("[data-toast-icon]")?.getAttribute("data-toast-icon"),
		}).toStrictEqual({kind: "error", type: "warning", icon: "warning"});
	});

	it("renders addDanger twins as the danger variant", () => {
		renderWithToast({message: "Failed to send response. You can try again.", kind: "danger"});

		const el = screen.getByRole("alert").querySelector("[data-toast]");
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

		expect(toastTexts("alert")).toStrictEqual(["Careful (×2)"]);
	});

	it("keeps a danger and an error with the same text as two toasts", () => {
		const fire = renderTriggers([
			{message: "Broke", kind: "danger"},
			{message: "Broke", kind: "error"},
		]);
		fire(0);
		fire(1);

		expect(toastTexts("alert")).toStrictEqual(["Broke", "Broke"]);
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
		expect(toastTexts("alert")).toEqual(["Couldn’t save."]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("alert")).toEqual([]);
	});

	it("keeps a toast with an action until it is used or dismissed", () => {
		renderWithToast({message: "Archived 1 session", kind: "success", action: {label: "Undo", onAction: () => {}}});
		act(() => {
			vi.advanceTimersByTime(60_000);
		});
		expect(toastTexts("status")).toEqual(["Archived 1 session"]);
	});

	it("folds a repeat into the open toast as (×2), keeping it at least 6 more seconds", () => {
		const fire = renderTriggers([{message: "Link copied", kind: "success"}]);
		fire(0);
		act(() => {
			vi.advanceTimersByTime(3500);
		});
		fire(0);

		expect(toastTexts("status")).toEqual(["Link copied (×2)"]);
		act(() => {
			vi.advanceTimersByTime(5999);
		});
		expect(toastTexts("status")).toEqual(["Link copied (×2)"]);
		act(() => {
			vi.advanceTimersByTime(1);
		});
		expect(toastTexts("status")).toEqual([]);
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
		const toast = screen.getByText(`toast ${kind}`).closest<HTMLElement>("[data-toast]");
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
