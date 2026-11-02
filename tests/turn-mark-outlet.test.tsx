// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {useState, type ReactNode} from "react";
import {afterEach, describe, expect, it} from "vite-plus/test";

import {TurnMarkCarrier, TurnMarkOutlet, TurnMarkOutletProvider} from "../src/components/turn-mark-outlet";
import {OUTLET_LATE_NOTICE_MS} from "../src/lib/turn-mark-outlet";

afterEach(() =>
{
	cleanup();
});

function Counter({id}: {id: string})
{
	const [count, setCount] = useState(0);
	return (
		<button
			type="button"
			data-testid={id}
			onClick={() =>
			{
				setCount((n) => n + 1);
			}}
		>
			{count}
		</button>
	);
}

function Page({outlet, underPlan = false, children}: {outlet: boolean; underPlan?: boolean; children: ReactNode})
{
	return (
		<TurnMarkOutletProvider sessionId="s1">
			<div data-testid="transcript">{children}</div>
			{outlet && <TurnMarkOutlet className="empty:hidden" underPlan={underPlan} />}
		</TurnMarkOutletProvider>
	);
}

async function waitLateNotice()
{
	await act(async () =>
	{
		await new Promise((resolve) =>
		{
			setTimeout(resolve, OUTLET_LATE_NOTICE_MS + 20);
		});
	});
}

describe("TurnMarkOutlet", () =>
{
	it("renders upstream's outlet element", () =>
	{
		const {container} = render(<Page outlet>{null}</Page>);
		const outlet = container.querySelector("[data-turn-mark-outlet]");
		expect(
			{
				outlet: outlet?.getAttribute("data-turn-mark-outlet"),
				controls: outlet?.getAttribute("data-transcript-last-row-controls"),
				className: outlet?.className,
			},
		).toStrictEqual(
			{
				outlet: "",
				controls: "",
				className: "[&>[data-turn-mark-box]>*]:!my-0 empty:hidden",
			},
		);
	});
});

describe("TurnMarkCarrier", () =>
{
	it("carries a holding row into the outlet and leaves an empty home in the transcript", () =>
	{
		const {container, getByTestId} = render(
			<Page outlet>
				<TurnMarkCarrier holds>
					<span data-testid="row" />
				</TurnMarkCarrier>
			</Page>,
		);
		const row = getByTestId("row");
		const box = row.parentElement;
		const home = getByTestId("transcript").querySelector("[data-turn-mark-home]");
		expect(
			{
				inOutlet: box?.parentElement?.hasAttribute("data-turn-mark-outlet"),
				box: [box?.className, box?.getAttribute("data-find-omitted")],
				sameId: box?.getAttribute("data-turn-mark-box") === home?.getAttribute("data-turn-mark-home"),
				homeClass: home?.className,
				homeEmpty: home?.childElementCount,
				outlets: container.querySelectorAll("[data-turn-mark-outlet]").length,
			},
		).toStrictEqual(
			{
				inOutlet: true,
				box: ["contents", ""],
				sameId: true,
				homeClass: "contents",
				homeEmpty: 0,
				outlets: 1,
			},
		);
	});

	it("sends the row home with its state when the outlet goes away", async () =>
	{
		const tree = (outlet: boolean) => (
			<Page outlet={outlet}>
				<TurnMarkCarrier holds>
					<Counter id="row" />
				</TurnMarkCarrier>
			</Page>
		);
		const {getByTestId, rerender} = render(tree(true));
		fireEvent.click(getByTestId("row"));
		rerender(tree(false));
		await waitLateNotice();
		const row = getByTestId("row");
		expect(
			{
				home: row.parentElement?.parentElement?.hasAttribute("data-turn-mark-home"),
				count: row.textContent,
			},
		).toStrictEqual(
			{
				home: true,
				count: "1",
			},
		);
	});

	it("renders a row that doesn't hold the mark in place", () =>
	{
		const {getByTestId} = render(
			<Page outlet>
				<TurnMarkCarrier holds={false}>
					<span data-testid="row" />
				</TurnMarkCarrier>
			</Page>,
		);
		expect(getByTestId("row").parentElement).toBe(getByTestId("transcript"));
	});

	it("renders children unchanged without a provider", () =>
	{
		const {container} = render(
			<div data-testid="host">
				<TurnMarkCarrier holds>
					<span data-testid="row" />
				</TurnMarkCarrier>
			</div>,
		);
		expect(container.innerHTML).toBe('<div data-testid="host"><span data-testid="row"></span></div>');
	});

	it("carries every holder under a card", () =>
	{
		const {container} = render(
			<Page outlet>
				<TurnMarkCarrier holds>
					<span data-testid="first" />
				</TurnMarkCarrier>
				<TurnMarkCarrier holds>
					<span data-testid="second" />
				</TurnMarkCarrier>
			</Page>,
		);
		expect(
			[...container.querySelectorAll("[data-turn-mark-outlet] [data-testid]")].map((el) =>
				el.getAttribute("data-testid"),
			),
		).toStrictEqual(["first", "second"]);
	});

	it("carries only the newest in-flight claimer under a plan", () =>
	{
		const {container} = render(
			<Page outlet underPlan>
				<TurnMarkCarrier holds>
					<span data-testid="first" />
				</TurnMarkCarrier>
				<TurnMarkCarrier holds>
					<span data-testid="second" />
				</TurnMarkCarrier>
			</Page>,
		);
		expect(
			[...container.querySelectorAll("[data-turn-mark-outlet] [data-testid]")].map((el) =>
				el.getAttribute("data-testid"),
			),
		).toStrictEqual(["second"]);
	});

	it("leaves the outlet empty once the carrier unmounts", () =>
	{
		const tree = (carried: boolean) => (
			<Page outlet>
				{carried && (
					<TurnMarkCarrier holds>
						<span data-testid="row" />
					</TurnMarkCarrier>
				)}
			</Page>
		);
		const {container, rerender} = render(tree(true));
		rerender(tree(false));
		expect(container.querySelector("[data-turn-mark-outlet]")?.childNodes.length).toBe(0);
	});
});
