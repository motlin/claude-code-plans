// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen, within} from "@testing-library/react";
import {Component, type ReactNode, useLayoutEffect} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {PaneCrashBoundary} from "../src/components/panes/pane-crash-boundary";
import {usePaneHost} from "../src/components/panes/pane-host-context";
import {registerPane, type PaneDefinition} from "../src/components/panes/pane-registry";
import {TileHost} from "../src/components/panes/tile-host";
import {installLocalStorage} from "./fake-storage";

const placeholder = vi.hoisted(() => (
{
	throws: false,
	commits: 0,
}));

vi.mock("../src/components/panes/pane-placeholder", async (importOriginal) =>
{
	const actual = await importOriginal<typeof import("../src/components/panes/pane-placeholder")>();
	return {
		...actual,
		PanePlaceholder: (props: Parameters<typeof actual.PanePlaceholder>[0]) =>
		{
			// A commit-phase failure, so each one lands over the committed fallback (React escalates a fallback
			// that throws during render straight past the boundary).
			useLayoutEffect(() =>
			{
				placeholder.commits++;
				if (placeholder.throws) throw new Error("Example placeholder failure");
			});
			return actual.PanePlaceholder(props);
		},
	};
});

const pane =
{
	throws: true,
};

function CrashingBody()
{
	if (pane.throws) throw new Error("boom");
	return <button type="button">Body button</button>;
}

function Openers()
{
	const host = usePaneHost();
	return (
		<>
			<button
				type="button"
				onClick={() =>
				{
					host.openPane("plan");
				}}
			>
				Open plan
			</button>
			<button
				type="button"
				onClick={() =>
				{
					host.openPane("files");
				}}
			>
				Open files
			</button>
		</>
	);
}

class OuterBoundary extends Component<
	{
		children: ReactNode;
	},
	{
		error: unknown;
	}
>
{
	override state:
	{
		error: unknown;
	} =
	{
		error: null,
	};

	static getDerivedStateFromError(error: unknown)
	{
		return {
			error,
		};
	}

	override render(): ReactNode
	{
		return this.state.error === null ? this.props.children : <p>Outer caught</p>;
	}
}

let unregister: Array<() => void> = [];

function registerPlan(definition: Partial<PaneDefinition> = {})
{
	unregister.push(
		registerPane(
			"plan",
			{
				title: "Plan",
				render: () => <CrashingBody />,
				...definition,
			},
		),
	);
}

function renderHost()
{
	return render(
		<TileHost
			sessionId="session-alice"
			onExpandWithoutPane={() =>
			{
			}}
		>
			<Openers />
		</TileHost>,
	);
}

function crashState(kind: string)
{
	const section = document.querySelector<HTMLElement>(`section[data-pane-kind="${kind}"]`);
	if (section === null) return null;
	const crash = section.querySelector("[data-side-pane-crash]");
	return {
		headerButtons: [...section.querySelectorAll(":scope > div:first-child button")].map(
			(button) => button.getAttribute("aria-label") ?? button.textContent,
		),
		alert: crash?.querySelector(":scope > div > [data-pane-placeholder] > [role=alert]")?.textContent ?? null,
		crashButtons: crash === null ? null : [...crash.querySelectorAll("button")].map((b) => b.textContent),
	};
}

beforeEach(() =>
{
	installLocalStorage();
	pane.throws = true;
	placeholder.throws = false;
	placeholder.commits = 0;
	vi.spyOn(console, "error").mockImplementation(() => {});
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
		DOMRect.fromRect(
			{
				x: 0,
				y: 0,
				width: 1200,
				height: 800,
			},
		),
	);
});

afterEach(() =>
{
	for (const undo of unregister) undo();
	unregister = [];
	cleanup();
	vi.restoreAllMocks();
});

describe("PaneCrashBoundary", () =>
{
	it("contains a pane body crash in upstream's Something went wrong placeholder, keeping the header and sibling panes", () =>
	{
		registerPlan();
		unregister.push(
			registerPane(
				"files",
				{
					title: "Files",
					render: () => <p>Files body</p>,
				},
			),
		);
		renderHost();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open plan",
				},
			),
		);
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open files",
				},
			),
		);
		const crashed = crashState("plan");
		const placeholderRoot = document.querySelector("[data-side-pane-crash] > div");
		const inner = placeholderRoot?.firstElementChild;
		const alert = inner?.firstElementChild;
		expect(
			{
				crashed,
				sibling: screen.getByText("Files body").textContent,
				markup:
				{
					crash: document.querySelector("[data-side-pane-crash]")?.className,
					root: placeholderRoot?.className,
					inner: inner?.className,
					pad: inner?.getAttribute("style"),
					alert: alert?.className,
					icon: alert?.firstElementChild?.getAttribute("class")?.split(" ").slice(-2),
					iconHidden: alert?.firstElementChild?.getAttribute("aria-hidden"),
					text: alert?.children[1]?.className,
					title: alert?.children[1]?.firstElementChild?.className,
					actions: alert?.children[2]?.className,
				},
			},
		).toStrictEqual(
			{
				crashed:
				{
					headerButtons: ["Expand", "Close", "Move"],
					alert: "Something went wrongTry again",
					crashButtons: ["Try again"],
				},
				sibling: "Files body",
				markup:
				{
					crash: "contents",
					root: "grid h-full min-h-0 grid-cols-1 grid-rows-1 rounded-[inherit] has-[>:focus-visible]:after:pointer-events-none has-[>:focus-visible]:after:relative has-[>:focus-visible]:after:col-start-1 has-[>:focus-visible]:after:row-start-1 has-[>:focus-visible]:after:m-px has-[>:focus-visible]:after:rounded-[inherit] has-[>:focus-visible]:after:shadow-focus has-[>:focus-visible]:after:outline-hidden has-[>:focus-visible]:after:-outline-offset-2",
					inner: "col-start-1 row-start-1 flex flex-col overflow-x-hidden overflow-y-auto scroll-py-2 px-lg text-center outline-none focus-visible:isolate before:min-h-2 before:flex-[1_1_var(--placeholder-pad)] after:min-h-2 after:flex-[1_1_var(--placeholder-pad)]",
					pad: "--placeholder-pad: var(--cds-pad-lg);",
					alert: "flex flex-col items-center gap-md",
					icon: ["!size-7", "text-muted-as-secondary"],
					iconHidden: "true",
					text: "flex flex-col items-center gap-1",
					title: "max-w-[36ch] text-pretty break-words text-body text-primary",
					actions: "flex flex-wrap items-center justify-center gap-1",
				},
			},
		);
	});

	it("redraws the body on Try again, and clears the crash when the pane's resetKey changes", () =>
	{
		registerPlan(
			{
				resetKey: "target-a",
			},
		);
		renderHost();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open plan",
				},
			),
		);
		const crashed = crashState("plan")?.alert;
		pane.throws = false;
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Try again",
				},
			),
		);
		const retried = screen.queryByRole(
			"button",
			{
				name: "Body button",
			},
		)?.textContent;

		pane.throws = true;
		for (const undo of unregister) undo();
		act(() =>
		{
			unregister = [];
			registerPlan(
				{
					resetKey: "target-b",
				},
			);
		});
		const crashedAgain = crashState("plan")?.alert;
		pane.throws = false;
		act(() =>
		{
			registerPlan(
				{
					resetKey: "target-c",
				},
			);
		});
		expect(
			{
				crashed,
				retried,
				crashedAgain,
				retargeted: screen.queryByRole(
					"button",
					{
						name: "Body button",
					},
				)?.textContent,
			},
		).toStrictEqual(
			{
				crashed: "Something went wrongTry again",
				retried: "Body button",
				crashedAgain: "Something went wrongTry again",
				retargeted: "Body button",
			},
		);
	});

	it("hands keyboard focus from Try again to the pane body container once the body redraws", async () =>
	{
		registerPlan();
		renderHost();
		fireEvent.click(
			screen.getByRole(
				"button",
				{
					name: "Open plan",
				},
			),
		);
		const tryAgain = screen.getByRole(
			"button",
			{
				name: "Try again",
			},
		);
		// jsdom never matches :focus-visible after a dispatched click; the keyboard user's ring is assumed here.
		const matches = Element.prototype.matches;
		vi.spyOn(Element.prototype, "matches").mockImplementation(function (this: Element, selector: string)
		{
			return selector === ":focus-visible" ? this === document.activeElement : matches.call(this, selector);
		});
		tryAgain.focus();
		const container = tryAgain.closest("[data-side-pane-crash]")?.parentElement;
		pane.throws = false;
		fireEvent.click(tryAgain);
		await act(async () =>
		{
			await Promise.resolve();
		});
		expect(
			{
				focused: document.activeElement === container,
				tabIndex: container?.getAttribute("tabindex"),
				body: screen.getByRole(
					"button",
					{
						name: "Body button",
					},
				).textContent,
			},
		).toStrictEqual(
			{
				focused: true,
				tabIndex: "-1",
				body: "Body button",
			},
		);
	});

	it("rethrows stale-chunk errors to the boundary above it", () =>
	{
		function StaleChunk(): never
		{
			throw new Error("Failed to fetch dynamically imported module: https://example.com/assets/plan.js");
		}
		render(
			<OuterBoundary>
				<PaneCrashBoundary resetKey="plan:">
					<StaleChunk />
				</PaneCrashBoundary>
			</OuterBoundary>,
		);
		expect(
			{
				outer: screen.queryByText("Outer caught")?.textContent,
				crash: document.querySelector("[data-side-pane-crash]"),
			},
		).toStrictEqual(
			{
				outer: "Outer caught",
				crash: null,
			},
		);
	});

	it("renders nothing once its own fallback keeps throwing, and re-arms when the resetKey changes", () =>
	{
		placeholder.throws = true;
		function Harness({resetKey}: {resetKey: string})
		{
			return (
				<OuterBoundary>
					<section data-testid="pane">
						<PaneCrashBoundary resetKey={resetKey}>
							<CrashingBody />
						</PaneCrashBoundary>
					</section>
				</OuterBoundary>
			);
		}
		const {rerender} = render(<Harness resetKey="plan:a" />);
		const gaveUp =
		{
			body: screen.getByTestId("pane").innerHTML,
			outer: screen.queryByText("Outer caught"),
			commits: placeholder.commits,
		};
		placeholder.throws = false;
		pane.throws = false;
		rerender(<Harness resetKey="plan:b" />);
		expect(
			{
				gaveUp,
				rearmed: within(screen.getByTestId("pane")).getByRole(
					"button",
					{
						name: "Body button",
					},
				).textContent,
			},
		).toStrictEqual(
			{
				gaveUp:
				{
					body: "",
					outer: null,
					commits: 4,
				},
				rearmed: "Body button",
			},
		);
	});
});
