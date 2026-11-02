// @vitest-environment jsdom

import {cleanup, fireEvent, render, screen} from "@testing-library/react";
import {useState} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ResizeHandle} from "../src/components/ui/resize-handle";
import {type ResizeEdge, useResizableWidth} from "../src/hooks/use-resizable-width";

function Harness({
	edge = "end",
	initial = 288,
	onChange,
	onClick,
	defaultWidth,
}: {
	edge?: ResizeEdge;
	initial?: number;
	onChange?: (width: number) => void;
	onClick?: () => void;
	defaultWidth?: number;
})
{
	const [width, setWidth] = useState(initial);
	const handleProps = useResizableWidth(
		{
			label: "Resize sidebar",
			min: 232,
			max: 420,
			edge,
			value: width,
			onChange: (next) =>
			{
				setWidth(next);
				onChange?.(next);
			},
			...(onClick === undefined
				? {}
				:
					{
						onClick,
					}),
			...(defaultWidth === undefined
				? {}
				:
					{
						defaultWidth,
					}),
		},
	);
	return <ResizeHandle {...handleProps} />;
}

function handleState(handle: HTMLElement)
{
	return {
		role: handle.getAttribute("role"),
		orientation: handle.getAttribute("aria-orientation"),
		min: handle.getAttribute("aria-valuemin"),
		max: handle.getAttribute("aria-valuemax"),
		now: handle.getAttribute("aria-valuenow"),
		tabIndex: handle.tabIndex,
	};
}

describe("useResizableWidth", () =>
{
	afterEach(() =>
	{
		cleanup();
		vi.restoreAllMocks();
	});

	it("exposes separator ARIA props and steps with the arrow keys on the end edge", () =>
	{
		render(<Harness />);
		const handle = screen.getByRole(
			"separator",
			{
				name: "Resize sidebar",
			},
		);

		expect(handleState(handle)).toStrictEqual(
			{
				role: "separator",
				orientation: "vertical",
				min: "232",
				max: "420",
				now: "288",
				tabIndex: 0,
			},
		);

		fireEvent.keyDown(
			handle,
			{
				key: "ArrowRight",
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("296");

		fireEvent.keyDown(
			handle,
			{
				key: "ArrowLeft",
			},
		);
		fireEvent.keyDown(
			handle,
			{
				key: "ArrowLeft",
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("280");

		fireEvent.keyDown(
			handle,
			{
				key: "Home",
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("232");

		fireEvent.keyDown(
			handle,
			{
				key: "End",
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("420");

		fireEvent.keyDown(
			handle,
			{
				key: "ArrowRight",
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("420");
	});

	it("mirrors the arrow keys on the start edge", () =>
	{
		render(<Harness edge="start" />);
		const handle = screen.getByRole(
			"separator",
			{
				name: "Resize sidebar",
			},
		);

		fireEvent.keyDown(
			handle,
			{
				key: "ArrowLeft",
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("296");

		fireEvent.keyDown(
			handle,
			{
				key: "ArrowRight",
			},
		);
		fireEvent.keyDown(
			handle,
			{
				key: "ArrowRight",
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("280");
	});

	it("clamps a pointer drag to the bounds and reports every width change", () =>
	{
		const onChange = vi.fn<(width: number) => void>();
		render(<Harness onChange={onChange} />);
		const handle = screen.getByRole(
			"separator",
			{
				name: "Resize sidebar",
			},
		);

		fireEvent.pointerDown(
			handle,
			{
				clientX: 288,
				pointerId: 3,
			},
		);
		fireEvent.pointerMove(
			handle,
			{
				clientX: 338,
				pointerId: 3,
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("338");

		fireEvent.pointerMove(
			handle,
			{
				clientX: 2_000,
				pointerId: 3,
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("420");

		fireEvent.pointerMove(
			handle,
			{
				clientX: 0,
				pointerId: 3,
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("232");

		fireEvent.pointerUp(
			handle,
			{
				clientX: 0,
				pointerId: 3,
			},
		);
		fireEvent.pointerMove(
			handle,
			{
				clientX: 300,
				pointerId: 3,
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("232");

		expect(onChange.mock.calls).toStrictEqual([[338], [420], [232]]);
	});

	it("steps 32px with Shift+Arrow", () =>
	{
		render(<Harness />);
		const handle = screen.getByRole(
			"separator",
			{
				name: "Resize sidebar",
			},
		);
		fireEvent.keyDown(
			handle,
			{
				key: "ArrowRight",
				shiftKey: true,
			},
		);
		expect(handle.getAttribute("aria-valuenow")).toBe("320");
	});

	it("calls onClick for a press with no travel and for Enter, but not after a drag", () =>
	{
		const onClick = vi.fn<() => void>();
		render(<Harness onClick={onClick} />);
		const handle = screen.getByRole(
			"separator",
			{
				name: "Resize sidebar",
			},
		);

		fireEvent.pointerDown(
			handle,
			{
				clientX: 288,
				pointerId: 1,
			},
		);
		fireEvent.pointerUp(
			handle,
			{
				clientX: 288,
				pointerId: 1,
			},
		);
		fireEvent.keyDown(
			handle,
			{
				key: "Enter",
			},
		);
		fireEvent.pointerDown(
			handle,
			{
				clientX: 288,
				pointerId: 1,
			},
		);
		fireEvent.pointerMove(
			handle,
			{
				clientX: 300,
				pointerId: 1,
			},
		);
		fireEvent.pointerUp(
			handle,
			{
				clientX: 300,
				pointerId: 1,
			},
		);

		expect(onClick).toHaveBeenCalledTimes(2);
	});

	it("resets to defaultWidth on double-click and Enter/Space", () =>
	{
		render(<Harness defaultWidth={244} />);
		const handle = screen.getByRole(
			"separator",
			{
				name: "Resize sidebar",
			},
		);

		fireEvent.keyDown(
			handle,
			{
				key: "End",
			},
		);
		fireEvent.keyDown(
			handle,
			{
				key: "Enter",
			},
		);
		const afterEnter = handle.getAttribute("aria-valuenow");
		fireEvent.keyDown(
			handle,
			{
				key: "End",
			},
		);
		fireEvent.keyDown(
			handle,
			{
				key: " ",
			},
		);
		const afterSpace = handle.getAttribute("aria-valuenow");
		fireEvent.keyDown(
			handle,
			{
				key: "End",
			},
		);
		fireEvent.doubleClick(handle);

		expect([afterEnter, afterSpace, handle.getAttribute("aria-valuenow")]).toStrictEqual(["244", "244", "244"]);
	});
});
