// @vitest-environment jsdom

import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {useState, type ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {SessionChat} from "../src/components/session-chat";
import {TurnMarkCarrier, TurnMarkOutlet, TurnMarkOutletProvider} from "../src/components/turn-mark-outlet";
import {useMarkClaim, useMarkHeld, useMarkWords, useYieldMark} from "../src/components/turn-mark-context";
import {TRANSCRIPT_RELEASE_END_FOLLOW_EVENT} from "../src/lib/jump-to-message";
import {OUTLET_LATE_NOTICE_MS} from "../src/lib/turn-mark-outlet";
import {processTranscript} from "../src/lib/transcript";

vi.mock("../src/components/settings-context", () => (
{
	useSettings: () => (
	{
		settings:
		{
			showDebug: false,
			codeThemeLight: "claude-light",
			codeThemeDark: "github-dark",
		},
	}),
}));
vi.mock("../src/lib/hmr-persist", () => (
{
	hmrPersist: <T,>(_key: string, initialize: () => T): T => initialize(),
}));
vi.mock("../src/hooks/use-claude-events", () => (
{
	useClaudeEvents: () => (
	{
		failedTools: new Map(),
	}),
}));

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

	it("forwards a press or Enter in a carried row to the transcript as a follow release (upstream _9)", () =>
	{
		const {getByTestId} = render(
			<Page outlet>
				<TurnMarkCarrier holds>
					<span data-testid="row">Running</span>
					<textarea data-testid="field" />
					<button type="button" data-transcript-keeps-pin="" data-testid="pane-row">
						Agent
					</button>
				</TurnMarkCarrier>
			</Page>,
		);
		const releases: string[] = [];
		const listener = (event: Event) =>
		{
			releases.push(event.type);
		};
		document.addEventListener(TRANSCRIPT_RELEASE_END_FOLLOW_EVENT, listener);
		const count = (fire: () => void) =>
		{
			releases.length = 0;
			fire();
			return releases.length;
		};
		const results =
		{
			pressRow: count(() => fireEvent.pointerDown(getByTestId("row"))),
			enterRow: count(() =>
				fireEvent.keyDown(
					getByTestId("row"),
					{
						key: "Enter",
					},
				),
			),
			letterRow: count(() =>
				fireEvent.keyDown(
					getByTestId("row"),
					{
						key: "a",
					},
				),
			),
			enterField: count(() =>
				fireEvent.keyDown(
					getByTestId("field"),
					{
						key: "Enter",
					},
				),
			),
			pressPaneRow: count(() => fireEvent.pointerDown(getByTestId("pane-row"))),
		};
		document.removeEventListener(TRANSCRIPT_RELEASE_END_FOLLOW_EVENT, listener);
		expect(results).toStrictEqual(
			{
				pressRow: 1,
				enterRow: 1,
				letterRow: 0,
				enterField: 0,
				pressPaneRow: 0,
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

/** The working line's side of the store: optionally takes the mark, and prints what it holds. */
function LineProbe({takesMark}: {takesMark: boolean})
{
	useYieldMark(takesMark);
	const said = useMarkWords();
	const held = useMarkHeld();
	return (
		<output data-testid="line">
			{JSON.stringify(
				{
					held,
					words: said.words ?? null,
					unspoken: said.unspoken,
					callId: said.call?.id ?? null,
				},
			)}
		</output>
	);
}

function ClaimProbe({inFlight, turnLive}: {inFlight: boolean; turnLive: boolean})
{
	return <output data-testid="claim">{String(useMarkClaim(inFlight, turnLive))}</output>;
}

describe("useMarkClaim, as upstream's tf", () =>
{
	it("claims in flight, keeps a held claim when the turn stops being live, and loses it to a yielding line", () =>
	{
		const tree = (inFlight: boolean, turnLive: boolean, takesMark: boolean) => (
			<TurnMarkOutletProvider sessionId="s1">
				<ClaimProbe inFlight={inFlight} turnLive={turnLive} />
				<LineProbe takesMark={takesMark} />
			</TurnMarkOutletProvider>
		);
		const view = render(tree(true, true, false));
		const claim = () => view.getByTestId("claim").textContent;
		const held = () =>
			(
				JSON.parse(view.getByTestId("line").textContent) as
				{
					held: boolean;
				}
			).held;
		const live = [claim(), held()];
		view.rerender(tree(true, false, false));
		const kept = [claim(), held()];
		view.rerender(tree(true, false, true));
		const yielded = [claim(), held()];
		view.rerender(tree(true, false, false));
		const notRegained = [claim(), held()];
		expect(
			{
				live,
				kept,
				yielded,
				notRegained,
			},
		).toStrictEqual(
			{
				live: ["true", true],
				kept: ["true", true],
				yielded: ["false", false],
				notRegained: ["false", false],
			},
		);
	});
});

describe("rows hand their running words to a line that takes the mark (upstream say)", () =>
{
	const prompt =
	{
		type: "user",
		uuid: "u-prompt",
		message:
		{
			role: "user",
			content: "Fabricated request",
		},
	};

	function records(done: boolean): unknown[]
	{
		return [
			prompt,
			{
				type: "assistant",
				uuid: "a1",
				timestamp: "2026-09-28T10:00:01.000Z",
				message:
				{
					id: "msg-1",
					role: "assistant",
					content: [
						...(done
							? [
									{
										type: "tool_use",
										id: "toolu_done",
										name: "Read",
										input:
										{
											file_path: "/repo/src/done.ts",
										},
									},
								]
							: []),
						{
							type: "tool_use",
							id: "toolu_running",
							name: "Read",
							input:
							{
								file_path: "/repo/src/foo.ts",
							},
						},
					],
				},
			},
			...(done
				? [
						{
							type: "user",
							uuid: "r-done",
							message:
							{
								role: "user",
								content: [
									{
										type: "tool_result",
										tool_use_id: "toolu_done",
										content: "ok",
									},
								],
							},
						},
					]
				: []),
		];
	}

	function page(takesMark: boolean, grouped: boolean)
	{
		class FakeResizeObserver
		{
			observe()
			{
			}
			unobserve()
			{
			}
			disconnect()
			{
			}
		}
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
		vi.stubGlobal("requestAnimationFrame", () => 0);
		vi.stubGlobal("cancelAnimationFrame", vi.fn());
		const {lines, toolResultMap} = processTranscript(records(grouped));
		const view = render(
			<TurnMarkOutletProvider sessionId="s1">
				<SessionChat
					sessionId="test-session"
					lines={lines}
					toolResultMap={toolResultMap}
					transcriptMode="normal"
					showTools
					showThinking={false}
					shouldScrollToEnd={false}
				/>
				<LineProbe takesMark={takesMark} />
			</TurnMarkOutletProvider>,
		);
		const result =
		{
			rowMarks: view.container.querySelectorAll("[data-tool-row] [data-cds=WorkingMark]").length,
			line: JSON.parse(view.getByTestId("line").textContent) as unknown,
		};
		vi.unstubAllGlobals();
		return result;
	}

	it("a standalone row holds the mark and says nothing while the line does not take it", () =>
	{
		expect(page(false, false)).toStrictEqual(
			{
				rowMarks: 1,
				line:
				{
					held: true,
					words: null,
					unspoken: false,
					callId: null,
				},
			},
		);
	});

	it("a standalone row loses its mark and says its running words, spoken by the row itself", () =>
	{
		expect(page(true, false)).toStrictEqual(
			{
				rowMarks: 0,
				line:
				{
					held: false,
					words: "Reading foo.ts",
					unspoken: false,
					callId: "toolu_running",
				},
			},
		);
	});

	it("a busy group header loses its mark and says its own busy label, unspoken", () =>
	{
		expect(page(true, true)).toStrictEqual(
			{
				rowMarks: 0,
				line:
				{
					held: false,
					words: "Reading foo.ts",
					unspoken: true,
					callId: "toolu_running",
				},
			},
		);
	});
});
