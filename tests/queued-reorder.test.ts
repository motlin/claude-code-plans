import {describe, expect, it} from "vite-plus/test";
import type {Modifier} from "@dnd-kit/core";
import {clampQueueDragToList} from "../src/lib/queued-reorder";

type ModifierArgs = Parameters<Modifier>[0];

function rect(top: number, height: number)
{
	return {
		top,
		bottom: top + height,
		height,
		left: 0,
		right: 300,
		width: 300,
	};
}

function args(y: number, withRects: boolean): ModifierArgs
{
	return {
		transform:
		{
			x: 40,
			y,
			scaleX: 1,
			scaleY: 1,
		},
		draggingNodeRect: withRects ? rect(150, 30) : null,
		scrollableAncestorRects: withRects ? [rect(100, 200)] : [],
	} as unknown as ModifierArgs;
}

describe("clampQueueDragToList", () =>
{
	it("locks x and clamps y so the row stays inside its scrolling list", () =>
	{
		const y = (transformY: number, withRects = true) => clampQueueDragToList(args(transformY, withRects));
		expect([y(-100), y(10), y(500), y(500, false)]).toStrictEqual([
			{
				x: 0,
				y: -50,
				scaleX: 1,
				scaleY: 1,
			},
			{
				x: 0,
				y: 10,
				scaleX: 1,
				scaleY: 1,
			},
			{
				x: 0,
				y: 120,
				scaleX: 1,
				scaleY: 1,
			},
			{
				x: 0,
				y: 500,
				scaleX: 1,
				scaleY: 1,
			},
		]);
	});
});
