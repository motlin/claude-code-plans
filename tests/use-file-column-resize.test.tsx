// @vitest-environment jsdom

import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {ResizeHandle} from "../src/components/ui/resize-handle";
import
{
	FILE_COLUMN,
	FILE_COLUMN_DOUBLE_PRESS_MS,
	FILE_COLUMN_MEASURE_DEBOUNCE_MS,
	fileColumnShowsAt,
	useFileColumnResize,
} from "../src/hooks/use-file-column-resize";
import {stubColumnLayout} from "./helpers/column-layout";

interface HarnessProps
{
	width: number;
	onWidthChange?: (width: number) => void;
	shown?: boolean;
	onShownChange?: (shown: boolean) => void;
	onResizing?: (resizing: boolean) => void;
}

function Harness({width, onWidthChange, shown, onShownChange, onResizing}: HarnessProps)
{
	const {columnRef, columnStyle, resizing, handleProps, edgeHandleProps} = useFileColumnResize(
		{
			width,
			...(onWidthChange === undefined
				? {}
				:
					{
						onWidthChange,
					}),
			...(shown === undefined
				? {}
				:
					{
						shown,
					}),
			...(onShownChange === undefined
				? {}
				:
					{
						onShownChange,
					}),
		},
	);
	onResizing?.(resizing);
	return (
		<div
			data-row
			style={
			{
				width: 800,
			}}
		>
			<div data-column ref={columnRef} style={columnStyle} />
			<ResizeHandle {...handleProps} aria-label="Resize file tree" />
			{edgeHandleProps && <ResizeHandle {...edgeHandleProps} aria-label="Show file tree" />}
		</div>
	);
}

function column(): HTMLElement
{
	const element = document.querySelector<HTMLElement>("[data-column]");
	if (element === null) throw new Error("no column");
	return element;
}

function handle(): HTMLElement
{
	return screen.getByRole(
		"separator",
		{
			name: "Resize file tree",
		},
	);
}

function edge(): HTMLElement
{
	return screen.getByRole(
		"separator",
		{
			name: "Show file tree",
		},
	);
}

function press(target: HTMLElement, clientX = 300): void
{
	fireEvent.pointerDown(
		target,
		{
			button: 0,
			clientX,
		},
	);
}

function move(clientX: number): void
{
	fireEvent.pointerMove(
		document,
		{
			clientX,
		},
	);
}

function release(clientX: number): void
{
	fireEvent.pointerUp(
		document,
		{
			clientX,
		},
	);
}

function click(target: HTMLElement): void
{
	press(target);
	release(300);
}

class FakeResizeObserver
{
	static instances: FakeResizeObserver[] = [];
	constructor(readonly callback: () => void)
	{
		FakeResizeObserver.instances.push(this);
	}
	observe(): void
	{
	}
	disconnect(): void
	{
	}
}

describe("useFileColumnResize", () =>
{
	let restoreLayout: () => void;
	beforeEach(() =>
	{
		restoreLayout = stubColumnLayout();
		FakeResizeObserver.instances = [];
		vi.stubGlobal("ResizeObserver", FakeResizeObserver);
	});
	afterEach(() =>
	{
		cleanup();
		restoreLayout();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it("exports upstream's constants", () =>
	{
		expect(
			{
				column: FILE_COLUMN,
				doublePress: FILE_COLUMN_DOUBLE_PRESS_MS,
				debounce: FILE_COLUMN_MEASURE_DEBOUNCE_MS,
				shows: [fileColumnShowsAt(79), fileColumnShowsAt(80)],
			},
		).toStrictEqual(
			{
				column:
				{
					DEFAULT: 240,
					MIN: 160,
					MAX: 640,
				},
				doublePress: 500,
				debounce: 150,
				shows: [false, true],
			},
		);
	});

	it("(a) hides the column live below 80px and hides it on release, keeping the width", () =>
	{
		const onWidthChange = vi.fn<(width: number) => void>();
		const onShownChange = vi.fn<(shown: boolean) => void>();
		render(<Harness width={240} onWidthChange={onWidthChange} onShownChange={onShownChange} />);

		press(handle(), 300);
		move(130);
		const below = column().style.display;
		move(200);
		const back = column().style.display;
		move(130);
		release(130);

		expect(
			{
				below,
				back,
				after: column().style.display,
				width: column().style.width,
				shown: onShownChange.mock.calls,
				widths: onWidthChange.mock.calls,
			},
		).toStrictEqual(
			{
				below: "none",
				back: "",
				after: "",
				width: "240px",
				shown: [[false]],
				widths: [],
			},
		);
	});

	it("(b) hides on a click and hands focus to the edge handle", () =>
	{
		const onShownChange = vi.fn<(shown: boolean) => void>();
		const {rerender} = render(
			<Harness width={240} onWidthChange={vi.fn<(width: number) => void>()} onShownChange={onShownChange} />,
		);

		handle().focus();
		click(handle());
		rerender(
			<Harness
				width={240}
				onWidthChange={vi.fn<(width: number) => void>()}
				onShownChange={onShownChange}
				shown={false}
			/>,
		);

		expect(
			{
				shown: onShownChange.mock.calls,
				focused: document.activeElement === edge(),
			},
		).toStrictEqual(
			{
				shown: [[false]],
				focused: true,
			},
		);
	});

	it("(c) resets to 240 on two clicks within 500ms when the column cannot hide", () =>
	{
		const onWidthChange = vi.fn<(width: number) => void>();
		const now = vi.spyOn(performance, "now");
		render(<Harness width={320} onWidthChange={onWidthChange} />);

		now.mockReturnValue(1000);
		click(handle());
		now.mockReturnValue(1600);
		click(handle());
		const slow = [...onWidthChange.mock.calls];
		now.mockReturnValue(1800);
		click(handle());

		expect(
			{
				slow,
				fast: onWidthChange.mock.calls,
			},
		).toStrictEqual(
			{
				slow: [],
				fast: [[240]],
			},
		);
	});

	it("(d) Enter resets a column that cannot hide, and hides one that can", () =>
	{
		const reset = vi.fn<(width: number) => void>();
		const {unmount} = render(<Harness width={320} onWidthChange={reset} />);
		fireEvent.keyDown(
			handle(),
			{
				key: "Enter",
			},
		);
		unmount();

		const onWidthChange = vi.fn<(width: number) => void>();
		const onShownChange = vi.fn<(shown: boolean) => void>();
		render(<Harness width={320} onWidthChange={onWidthChange} onShownChange={onShownChange} />);
		fireEvent.keyDown(
			handle(),
			{
				key: "Enter",
			},
		);

		expect(
			{
				reset: reset.mock.calls,
				hidingWidths: onWidthChange.mock.calls,
				hidingShown: onShownChange.mock.calls,
			},
		).toStrictEqual(
			{
				reset: [[240]],
				hidingWidths: [],
				hidingShown: [[false]],
			},
		);
	});

	it("(e) measures aria-valuemax from the row on focus, debounced on row resizes", () =>
	{
		vi.useFakeTimers();
		render(<Harness width={240} onWidthChange={vi.fn<(width: number) => void>()} />);
		const row = document.querySelector<HTMLElement>("[data-row]");
		if (row === null) throw new Error("no row");
		let rowWidth = 500;
		Object.defineProperty(
			row,
			"clientWidth",
			{
				configurable: true,
				get: () => rowWidth,
			},
		);
		const initial = handle().getAttribute("aria-valuemax");

		fireEvent.focus(handle());
		const wide = ["aria-valuemax", "aria-valuenow", "aria-valuemin"].map((name) => handle().getAttribute(name));
		rowWidth = 300;
		act(() =>
		{
			for (const observer of FakeResizeObserver.instances) observer.callback();
		});
		const beforeDebounce = handle().getAttribute("aria-valuemax");
		act(() =>
		{
			vi.advanceTimersByTime(FILE_COLUMN_MEASURE_DEBOUNCE_MS);
		});
		const narrow = ["aria-valuemax", "aria-valuenow", "aria-valuemin"].map((name) => handle().getAttribute(name));

		expect(
			{
				initial,
				wide,
				beforeDebounce,
				narrow,
			},
		).toStrictEqual(
			{
				initial: "640",
				wide: ["340", "240", "160"],
				beforeDebounce: "340",
				narrow: ["140", "140", "140"],
			},
		);
	});

	it("(f) an edge drag shows the column at 80px and commits the dragged width", () =>
	{
		const onWidthChange = vi.fn<(width: number) => void>();
		const onShownChange = vi.fn<(shown: boolean) => void>();
		const props =
		{
			width: 240,
			onWidthChange,
			onShownChange,
		};
		const {rerender} = render(<Harness {...props} shown={false} />);
		onShownChange.mockImplementation((shown) =>
		{
			rerender(<Harness {...props} shown={shown} />);
		});

		press(edge(), 0);
		move(60);
		const at60 = [...onShownChange.mock.calls];
		move(100);
		const at100 = [...onShownChange.mock.calls];
		const width = column().style.width;
		release(100);

		expect(
			{
				at60,
				at100,
				width,
				widths: onWidthChange.mock.calls,
			},
		).toStrictEqual(
			{
				at60: [],
				at100: [[true]],
				width: "100px",
				widths: [[160]],
			},
		);
	});

	it("(g) edge Enter shows the column and focuses the main handle; edge ArrowLeft does nothing", () =>
	{
		const onShownChange = vi.fn<(shown: boolean) => void>();
		const props =
		{
			width: 240,
			onWidthChange: vi.fn<(width: number) => void>(),
			onShownChange,
		};
		const {rerender} = render(<Harness {...props} shown={false} />);

		fireEvent.keyDown(
			edge(),
			{
				key: "ArrowLeft",
			},
		);
		const afterArrow = [...onShownChange.mock.calls];
		edge().focus();
		fireEvent.keyDown(
			edge(),
			{
				key: "Enter",
			},
		);
		rerender(<Harness {...props} shown />);

		expect(
			{
				afterArrow,
				shown: onShownChange.mock.calls,
				focused: document.activeElement === handle(),
			},
		).toStrictEqual(
			{
				afterArrow: [],
				shown: [[true]],
				focused: true,
			},
		);
	});

	it("(h) commits a drag once, on release", () =>
	{
		const onWidthChange = vi.fn<(width: number) => void>();
		render(<Harness width={240} onWidthChange={onWidthChange} />);

		press(handle(), 300);
		move(320);
		move(350);
		const during = [...onWidthChange.mock.calls];
		const live = column().style.width;
		release(350);

		expect(
			{
				during,
				live,
				after: onWidthChange.mock.calls,
			},
		).toStrictEqual(
			{
				during: [],
				live: "290px",
				after: [[290]],
			},
		);
	});

	it("(i) reports resizing during column and edge drags", () =>
	{
		const seen: boolean[] = [];
		const onResizing = (resizing: boolean) =>
		{
			if (seen.at(-1) !== resizing) seen.push(resizing);
		};
		const props =
		{
			width: 240,
			onWidthChange: vi.fn<(width: number) => void>(),
			onShownChange: vi.fn<(shown: boolean) => void>(),
			onResizing,
		};
		const {rerender} = render(<Harness {...props} />);
		press(handle(), 300);
		move(320);
		release(320);
		rerender(<Harness {...props} shown={false} />);
		press(edge(), 0);
		move(20);
		release(20);

		expect(seen).toStrictEqual([false, true, false, true, false]);
	});
});
