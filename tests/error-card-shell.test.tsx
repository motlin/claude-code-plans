// @vitest-environment jsdom

import {cleanup, fireEvent, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {ErrorCardShell} from "../src/components/error-card-shell";
import {CompactScope} from "./fizzy-lake-off";

const HEADLINE = "Couldn’t complete that";
const HINT = "/permissions doesn’t take arguments here. Remove the text after the command, then send it again.";

afterEach(cleanup);

describe("ErrorCardShell", () =>
{
	it("draws upstream's literal card: sr-only alert, warning header with Dismiss, hint row", () =>
	{
		const {container} = render(
			<ErrorCardShell
				headline={HEADLINE}
				hint={HINT}
				icon="warning"
				announce="alert"
				onDismiss={() =>
				{
				}}
			/>,
		);
		const root = container.firstElementChild;
		const [alert, header, hintRow] = [...(root?.children ?? [])];
		const [iconSlot, headline, dismissSlot] = [...(header?.children ?? [])];
		const icon = iconSlot?.firstElementChild;
		const dismiss = dismissSlot?.firstElementChild;

		expect(
			{
				root: root?.className,
				childCount: root?.children.length,
				alert:
				{
					tag: alert?.tagName,
					className: alert?.className,
					role: alert?.getAttribute("role"),
					text: alert?.textContent,
				},
				header: header?.className,
				iconSlot: iconSlot?.className,
				icon:
				{
					className: icon?.getAttribute("class"),
					hidden: icon?.getAttribute("aria-hidden"),
				},
				headline:
				{
					tag: headline?.tagName,
					className: headline?.className,
					text: headline?.textContent,
				},
				dismissSlot: dismissSlot?.className,
				dismiss:
				{
					tag: dismiss?.tagName,
					type: dismiss?.getAttribute("type"),
					label: dismiss?.getAttribute("aria-label"),
					className: dismiss?.className,
					glyph: dismiss?.querySelector("svg")?.getAttribute("class"),
				},
				hintRow: hintRow?.className,
				hint:
				{
					tag: hintRow?.firstElementChild?.tagName,
					className: hintRow?.firstElementChild?.className,
					text: hintRow?.textContent,
				},
			},
		).toStrictEqual(
			{
				root: "card-outline-layer flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-card select-text",
				childCount: 3,
				alert:
				{
					tag: "SPAN",
					className: "sr-only",
					role: "alert",
					text: `${HEADLINE} ${HINT}`,
				},
				header: "flex items-start gap-md px-lg py-md bg-alpha-1 text-body contain-inline-size",
				iconSlot: "flex h-[1lh] shrink-0 items-center",
				icon:
				{
					className: "lucide lucide-triangle-alert size-4 shrink-0 text-danger-000",
					hidden: "true",
				},
				headline:
				{
					tag: "SPAN",
					className: "min-w-0 grow text-primary break-words",
					text: HEADLINE,
				},
				dismissSlot: "-me-pad-xs flex h-[1lh] shrink-0 items-center",
				dismiss:
				{
					tag: "BUTTON",
					type: "button",
					label: "Dismiss",
					className:
						"inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 p-0 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus",
					glyph: "lucide lucide-x size-4",
				},
				hintRow: "flex flex-col gap-md px-lg pt-lg pb-md last:pb-lg empty:hidden contain-inline-size",
				hint:
				{
					tag: "SPAN",
					className: "text-body text-secondary whitespace-pre-line break-words",
					text: HINT,
				},
			},
		);
	});

	it("calls onDismiss on click and keeps focus where it was on mouse down", () =>
	{
		const onDismiss = vi.fn<() => void>();
		const {getByRole, getByTestId} = render(
			<>
				<textarea data-testid="composer" />
				<ErrorCardShell headline={HEADLINE} hint={HINT} icon="warning" announce="alert" onDismiss={onDismiss} />
			</>,
		);
		const composer = getByTestId("composer");
		composer.focus();
		const dismiss = getByRole(
			"button",
			{
				name: "Dismiss",
			},
		);

		const mouseDownAllowed = fireEvent.mouseDown(dismiss);
		fireEvent.click(dismiss);

		expect(
			{
				mouseDownAllowed,
				calls: onDismiss.mock.calls.length,
				focused: document.activeElement === composer,
			},
		).toStrictEqual(
			{
				mouseDownAllowed: false,
				calls: 1,
				focused: true,
			},
		);
	});

	it("draws no Dismiss without onDismiss and no alert without announce", () =>
	{
		const {container} = render(<ErrorCardShell headline={HEADLINE} hint={HINT} icon="gauge" />);
		const root = container.firstElementChild;

		expect(
			{
				children: [...(root?.children ?? [])].map((child) => child.className),
				header: [...(root?.firstElementChild?.children ?? [])].map((child) => child.getAttribute("class")),
				icon: root?.querySelector("svg")?.getAttribute("class"),
				busy: root?.getAttribute("aria-busy"),
				buttons: container.querySelectorAll("button").length,
				alerts: container.querySelectorAll("[role=alert]").length,
			},
		).toStrictEqual(
			{
				children: [
					"flex items-start gap-md px-lg py-md bg-alpha-1 text-body contain-inline-size",
					"flex flex-col gap-md px-lg pt-lg pb-md last:pb-lg empty:hidden contain-inline-size",
				],
				header: ["flex h-[1lh] shrink-0 items-center", "min-w-0 grow text-primary break-words"],
				icon: "lucide lucide-gauge size-4 shrink-0 text-danger-000",
				busy: null,
				buttons: 0,
				alerts: 0,
			},
		);
	});

	it("draws upstream's options row and note after the hint, and marks the card busy", () =>
	{
		const {container} = render(
			<ErrorCardShell
				headline={HEADLINE}
				hint={HINT}
				icon="warning"
				busy
				options={<button type="button">Try again</button>}
				note="Retrying uses the same model."
			/>,
		);
		const root = container.firstElementChild;
		const hintRow = root?.children[1];

		expect(
			{
				busy: root?.getAttribute("aria-busy"),
				hintRow: [...(hintRow?.children ?? [])].map((child) => (
				{
					tag: child.tagName,
					className: child.className,
					text: child.textContent,
				})),
			},
		).toStrictEqual(
			{
				busy: "true",
				hintRow: [
					{
						tag: "SPAN",
						className: "text-body text-secondary whitespace-pre-line break-words",
						text: HINT,
					},
					{
						tag: "DIV",
						className: "flex flex-wrap items-center gap-1 empty:hidden",
						text: "Try again",
					},
					{
						tag: "SPAN",
						className: "text-footnote text-secondary",
						text: "Retrying uses the same model.",
					},
				],
			},
		);
	});
});

describe("ErrorCardShell density", () =>
{
	const metrics = (root: Element | null | undefined) =>
	{
		const [header, hintRow] = [...(root?.children ?? [])];
		return {
			scope: root?.parentElement?.closest("[data-density]")?.getAttribute("data-density") ?? null,
			header: header?.className,
			dismissSlot: header?.lastElementChild?.className,
			hintRow: hintRow?.className,
		};
	};
	const SPACING =
	{
		header: "flex items-start gap-md px-lg py-md bg-alpha-1 text-body contain-inline-size",
		dismissSlot: "-me-pad-xs flex h-[1lh] shrink-0 items-center",
		hintRow: "flex flex-col gap-md px-lg pt-lg pb-md last:pb-lg empty:hidden contain-inline-size",
	};

	it("draws upstream's verbatim cds spacing in any scope, leaving the values to the nearest data-density", () =>
	{
		const panels = metrics(
			render(
				<ErrorCardShell
					headline={HEADLINE}
					hint={HINT}
					icon="warning"
					onDismiss={() =>
					{
					}}
				/>,
			).container.firstElementChild,
		);
		cleanup();
		const compact = metrics(
			render(
				<CompactScope>
					<ErrorCardShell
						headline={HEADLINE}
						hint={HINT}
						icon="warning"
						onDismiss={() =>
						{
						}}
					/>
				</CompactScope>,
			).container.querySelector("[data-density]")?.firstElementChild,
		);

		expect(
			{
				panels,
				compact,
			},
		).toStrictEqual(
			{
				panels:
				{
					scope: null,
					...SPACING,
				},
				compact:
				{
					scope: "compact",
					...SPACING,
				},
			},
		);
	});
});
