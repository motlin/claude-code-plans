// @vitest-environment jsdom

import {act, cleanup, render} from "@testing-library/react";
import {useRef} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";

import {useFilesTreeCanFit} from "../src/hooks/use-files-tree-can-fit";
import {installWidthObservers} from "./helpers/width-observer";

let fits: boolean[] = [];

function Body()
{
	const ref = useRef<HTMLDivElement>(null);
	fits.push(useFilesTreeCanFit(ref));
	return <div ref={ref} />;
}

function stubClientWidth(width: number): void
{
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
}

afterEach(() =>
{
	cleanup();
	fits = [];
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("useFilesTreeCanFit", () =>
{
	it.each([
		[399, false],
		[400, true],
		[0, true],
	])("a body measured %ipx wide on mount fits: %s", (width, expected) =>
	{
		installWidthObservers();
		stubClientWidth(width);
		render(<Body />);
		expect(fits.at(-1)).toBe(expected);
	});

	it("follows the observed width, keeping its last value through a zero width", () =>
	{
		const observers = installWidthObservers();
		render(<Body />);
		const seen: Array<boolean | undefined> = [fits.at(-1)];
		for (const width of [300, 0, 500, 300])
		{
			act(() =>
			{
				observers.resize(width);
			});
			seen.push(fits.at(-1));
		}
		expect(seen).toStrictEqual([true, false, false, true, false]);
	});
});
