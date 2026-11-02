// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {InlineDiff} from "../src/components/tool-renderers/inline-diff";

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
	takeRecords()
	{
		return [];
	}
}

beforeEach(() =>
{
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() =>
{
	cleanup();
	vi.unstubAllGlobals();
});

/** The class list of the epitaxy-diff hook element around each rendered pierre host. */
function hostWrappers(container: HTMLElement): (string | null)[]
{
	return [...container.querySelectorAll("diffs-container")].map(
		(host) => host.closest(".epitaxy-diff")?.getAttribute("class") ?? null,
	);
}

// Upstream's Code font size reaches pierre only inside an `epitaxy-diff` hook class.
describe("Code font size hook classes on pierre views", () =>
{
	it("wraps an inline tool diff in div.epitaxy-diff", async () =>
	{
		const {container} = render(
			<InlineDiff filePath="/test/alice.ts" oldStr="const a = 1;" newStr="const a = 2;" />,
		);

		await waitFor(() =>
		{
			expect(hostWrappers(container)).toStrictEqual(["epitaxy-diff"]);
		});
	});
});
