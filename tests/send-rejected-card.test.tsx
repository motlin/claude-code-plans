// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SendRejectedCard} from "../src/components/send-rejected-card";
import {CompactScope} from "./fizzy-lake-off";

afterEach(cleanup);

function renderCard(nonResendable = false)
{
	const onRetry = vi.fn<() => void>();
	const onDismiss = vi.fn<() => void>();
	const view = render(
		<SendRejectedCard
			rejection={
			{
				prompt: "hi",
				message: "send failed:\n  pane 3 is gone",
				nonResendable,
			}}
			onRetry={onRetry}
			onDismiss={onDismiss}
		/>,
	);
	return {
		...view,
		onRetry,
		onDismiss,
	};
}

const buttonNames = () =>
	screen.getAllByRole("button").map((button) => button.getAttribute("aria-label") ?? button.textContent);

describe("SendRejectedCard", () =>
{
	it("announces upstream's generic headline and hint", () =>
	{
		renderCard();

		expect(screen.getByRole("alert").textContent).toEqual(
			"Something went wrong Try sending your message again. If it keeps failing, the error details show why.",
		);
	});

	it("orders its buttons Dismiss, View details, Try again, Copy details", () =>
	{
		renderCard();

		expect(buttonNames()).toEqual(["Dismiss", "View details", "Try again", "Copy details"]);
	});

	it("draws View details as upstream's end-caret cds fold: text-current-control label, then the filled caret", () =>
	{
		renderCard();
		const toggle = screen.getByRole(
			"button",
			{
				name: "View details",
			},
		);

		expect(
			{
				root: toggle.closest("[data-cds=Collapsible]")?.className,
				className: toggle.className,
				children: [...toggle.children].map((child) => (
				{
					tag: child.tagName,
					className: child.getAttribute("class"),
					icon: child.getAttribute("data-cds"),
					text: child.textContent,
				})),
			},
		).toStrictEqual(
			{
				root: "flex flex-col self-stretch",
				className:
					"cds-reset group/clp inline-flex w-fit items-center gap-1.5 border-0 select-none outline-none focus-visible:outline-hidden font-sans font-control-regular transition-shadow duration-[60ms] focus-visible:shadow-focus rounded data-[disabled]:opacity-40 data-[disabled]:pointer-events-none shrink-0 whitespace-nowrap text-footnote text-secondary hover:text-primary",
				children: [
					{
						tag: "SPAN",
						className: "text-current-control",
						icon: null,
						text: "View details",
					},
					{
						tag: "svg",
						className:
							"shrink-0 transition-transform group-data-[panel-open]/clp:rotate-90 group-data-[panel-open]/clp:page-rtl:-rotate-90 motion-reduce:transition-none ms-auto",
						icon: "Icon",
						text: "",
					},
				],
			},
		);
	});

	it("opens the details by default and collapses them, unmounting the message", () =>
	{
		const {container} = renderCard();
		const toggle = screen.getByRole(
			"button",
			{
				name: "View details",
			},
		);

		expect(
			{
				expanded: toggle.getAttribute("aria-expanded"),
				message: container.querySelector("[data-send-rejected-message]")?.textContent,
			},
		).toEqual(
			{
				expanded: "true",
				message: "send failed:\n  pane 3 is gone",
			},
		);

		fireEvent.click(toggle);

		expect(
			{
				expanded: toggle.getAttribute("aria-expanded"),
				message: container.querySelector("[data-send-rejected-message]"),
				buttons: buttonNames(),
			},
		).toEqual(
			{
				expanded: "false",
				message: null,
				buttons: ["Dismiss", "View details", "Try again"],
			},
		);
	});

	it("drops Try again and swaps the hint for a prompt that cannot be resent", () =>
	{
		renderCard(true);

		expect(
			{
				alert: screen.getByRole("alert").textContent,
				buttons: buttonNames(),
			},
		).toEqual(
			{
				alert: "Something went wrong Your message didn’t send. Check the error details before sending it again.",
				buttons: ["Dismiss", "View details", "Copy details"],
			},
		);
	});

	it("wires Try again, Dismiss and Copy details", () =>
	{
		const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
		Object.defineProperty(
			navigator,
			"clipboard",
			{
				configurable: true,
				value:
				{
					writeText,
				},
			},
		);
		const {onRetry, onDismiss} = renderCard();

		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Try again",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Dismiss",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Copy details",
				},
			),
		);

		expect(
			{
				retry: onRetry.mock.calls.length,
				dismiss: onDismiss.mock.calls.length,
				copied: writeText.mock.calls,
			},
		).toEqual(
			{
				retry: 1,
				dismiss: 1,
				copied: [["send failed:\n  pane 3 is gone"]],
			},
		);
	});

	it("uses upstream's card shell and lets the details row wrap on a phone", () =>
	{
		const {container} = renderCard();
		const card = container.querySelector("[data-testid=send-rejected-card]");
		const row = screen.getByRole(
			"button",
			{
				name: "View details",
			},
		).parentElement;

		expect(
			{
				card: card?.className,
				row: row?.className.split(/\s+/).includes("flex-wrap"),
			},
		).toEqual(
			{
				card: "card-outline-layer flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-card select-text",
				row: true,
			},
		);
	});

	it("right-aligns a wrapping actions group so Try again drops under View details on a phone", () =>
	{
		renderCard();
		const actions = screen.getByRole(
			"button",
			{
				name: "Try again",
			},
		).parentElement;

		expect(actions?.className).toEqual("ms-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2");
	});

	it("gates the details panel's height animation and the caret's rotation under reduced motion", () =>
	{
		const {container} = renderCard();
		const panel = container.querySelector("[data-send-rejected-message]")?.closest("[data-open]");
		const caret = screen
			.getByRole(
				"button",
				{
					name: "View details",
				},
			)
			.querySelector("svg");

		expect(
			{
				panelAnimated: panel?.getAttribute("class")?.split(/\s+/).includes("transition-[height]"),
				panelReduced: panel?.getAttribute("class")?.split(/\s+/).includes("motion-reduce:transition-none"),
				caretReduced: caret?.getAttribute("class")?.split(/\s+/).includes("motion-reduce:transition-none"),
			},
		).toStrictEqual(
			{
				panelAnimated: true,
				panelReduced: true,
				caretReduced: true,
			},
		);
	});
});

describe("SendRejectedCard on the shared error card shell", () =>
{
	const shell = (wrap: (card: ReactNode) => ReactNode) =>
	{
		const {container} = render(
			wrap(
				<SendRejectedCard
					rejection={
					{
						prompt: "hi",
						message: "send failed",
						nonResendable: false,
					}}
					onRetry={() =>
					{
					}}
					onDismiss={() =>
					{
					}}
				/>,
			),
		);
		const card = container.querySelector("[data-testid=send-rejected-card]");
		const [alert, header, hintRow] = [...(card?.children ?? [])];
		return {
			alert: alert?.getAttribute("role"),
			header: header?.className,
			slots: [...(header?.children ?? [])].map((child) => child.className),
			dismiss: header?.querySelector("button")?.getAttribute("aria-label"),
			hintRow: hintRow?.className,
			hint: hintRow?.firstElementChild?.className,
		};
	};

	it("draws the shell's comfortable header and hint row under fizzy-lake panels", () =>
	{
		expect(shell((card): ReactNode => card)).toStrictEqual(
			{
				alert: "alert",
				header: "flex items-start gap-md px-lg py-md bg-alpha-1 text-body contain-inline-size",
				slots: [
					"flex h-[1lh] shrink-0 items-center",
					"min-w-0 grow text-primary break-words",
					"-me-pad-xs flex h-[1lh] shrink-0 items-center",
				],
				dismiss: "Dismiss",
				hintRow: "flex flex-col gap-md px-lg pt-lg pb-md last:pb-lg empty:hidden contain-inline-size",
				hint: "text-body text-secondary whitespace-pre-line break-words",
			},
		);
	});

	it("draws the shell's pre-panels compact header and hint row with panels off", () =>
	{
		expect(shell((card) => <CompactScope>{card}</CompactScope>)).toStrictEqual(
			{
				alert: "alert",
				header: "flex items-start gap-md px-lg py-md bg-alpha-1 text-body contain-inline-size",
				slots: [
					"flex h-[1lh] shrink-0 items-center",
					"min-w-0 grow text-primary break-words",
					"-me-pad-xs flex h-[1lh] shrink-0 items-center",
				],
				dismiss: "Dismiss",
				hintRow: "flex flex-col gap-md px-lg pt-lg pb-md last:pb-lg empty:hidden contain-inline-size",
				hint: "text-body text-secondary whitespace-pre-line break-words",
			},
		);
	});
});
