// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ErrorCardShell} from "../src/components/error-card-shell";

const HEADLINE = "Couldn’t complete that";
const HINT = "/permissions doesn’t take arguments here. Remove the text after the command, then send it again.";

afterEach(cleanup);

describe("ErrorCardShell", () => {
	it("draws upstream's literal card: sr-only alert, warning header with Dismiss, hint row", () => {
		const {container} = render(
			<ErrorCardShell headline={HEADLINE} hint={HINT} icon="warning" announce="alert" onDismiss={() => {}} />,
		);
		const root = container.firstElementChild;
		const [alert, header, hintRow] = [...(root?.children ?? [])];
		const [icon, headline, dismissSlot] = [...(header?.children ?? [])];
		const dismiss = dismissSlot?.firstElementChild;

		expect({
			root: root?.className,
			childCount: root?.children.length,
			alert: {
				tag: alert?.tagName,
				className: alert?.className,
				role: alert?.getAttribute("role"),
				text: alert?.textContent,
			},
			header: header?.className,
			icon: {
				className: icon?.getAttribute("class"),
				hidden: icon?.getAttribute("aria-hidden"),
			},
			headline: {tag: headline?.tagName, className: headline?.className, text: headline?.textContent},
			dismissSlot: dismissSlot?.className,
			dismiss: {
				tag: dismiss?.tagName,
				type: dismiss?.getAttribute("type"),
				label: dismiss?.getAttribute("aria-label"),
				className: dismiss?.className,
				glyph: dismiss?.querySelector("svg")?.getAttribute("class"),
			},
			hintRow: hintRow?.className,
			hint: {
				tag: hintRow?.firstElementChild?.tagName,
				className: hintRow?.firstElementChild?.className,
				text: hintRow?.textContent,
			},
		}).toStrictEqual({
			root: "card-outline-layer flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-r7 select-text",
			childCount: 3,
			alert: {tag: "SPAN", className: "sr-only", role: "alert", text: `${HEADLINE} ${HINT}`},
			header: "flex items-center gap-3 bg-alpha-1 px-3 py-2 contain-inline-size",
			icon: {className: "lucide lucide-triangle-alert size-4 shrink-0 text-danger-000", hidden: "true"},
			headline: {tag: "SPAN", className: "min-w-0 grow text-body text-primary break-words", text: HEADLINE},
			dismissSlot: "-my-1 -me-1 flex shrink-0",
			dismiss: {
				tag: "BUTTON",
				type: "button",
				label: "Dismiss",
				className:
					"inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r5 p-0 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
				glyph: "lucide lucide-x size-5",
			},
			hintRow: "flex flex-col gap-3 px-3 pt-3 pb-2 last:pb-3 empty:hidden contain-inline-size",
			hint: {tag: "SPAN", className: "text-body text-secondary whitespace-pre-line break-words", text: HINT},
		});
	});

	it("calls onDismiss on click and keeps focus where it was on mouse down", () => {
		const onDismiss = vi.fn<() => void>();
		const {getByRole, getByTestId} = render(
			<>
				<textarea data-testid="composer" />
				<ErrorCardShell headline={HEADLINE} hint={HINT} icon="warning" announce="alert" onDismiss={onDismiss} />
			</>,
		);
		const composer = getByTestId("composer");
		composer.focus();
		const dismiss = getByRole("button", {name: "Dismiss"});

		const mouseDownAllowed = fireEvent.mouseDown(dismiss);
		fireEvent.click(dismiss);

		expect({
			mouseDownAllowed,
			calls: onDismiss.mock.calls.length,
			focused: document.activeElement === composer,
		}).toStrictEqual({mouseDownAllowed: false, calls: 1, focused: true});
	});

	it("draws no Dismiss without onDismiss and no alert without announce", () => {
		const {container} = render(<ErrorCardShell headline={HEADLINE} hint={HINT} icon="gauge" />);
		const root = container.firstElementChild;

		expect({
			children: [...(root?.children ?? [])].map((child) => child.className),
			header: [...(root?.firstElementChild?.children ?? [])].map((child) => child.getAttribute("class")),
			buttons: container.querySelectorAll("button").length,
			alerts: container.querySelectorAll("[role=alert]").length,
		}).toStrictEqual({
			children: [
				"flex items-center gap-3 bg-alpha-1 px-3 py-2 contain-inline-size",
				"flex flex-col gap-3 px-3 pt-3 pb-2 last:pb-3 empty:hidden contain-inline-size",
			],
			header: [
				"lucide lucide-gauge size-4 shrink-0 text-danger-000",
				"min-w-0 grow text-body text-primary break-words",
			],
			buttons: 0,
			alerts: 0,
		});
	});
});
