// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {DiffFile} from "../src/components/changes/diff-file";
import {InlineDiff} from "../src/components/tool-renderers/inline-diff";
import {UserCodeBlock} from "../src/components/user-code-block";

/** Props each pierre React view received, newest last; the stubs render nothing. */
const recorded = vi.hoisted(() => ({fileDiff: [] as Record<string, unknown>[], file: [] as Record<string, unknown>[]}));

vi.mock("@pierre/diffs/react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@pierre/diffs/react")>();
	return {
		...actual,
		FileDiff: (props: Record<string, unknown>) => {
			recorded.fileDiff.push(props);
			return null;
		},
		File: (props: Record<string, unknown>) => {
			recorded.file.push(props);
			return null;
		},
	};
});

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,1 +1,1 @@
-export const greeting = "hi";
+export const greeting = "hello";
`;

afterEach(() => {
	cleanup();
	recorded.fileDiff.length = 0;
	recorded.file.length = 0;
});

describe("pierre metrics props", () => {
	it("passes the Changes FileDiff upstream's metrics and writes their lineHeight through diffLineHeightStyle on the host div", () => {
		const {container} = render(<DiffFile patch={PATCH} />);
		const props = recorded.fileDiff.at(-1);
		// The host style sits on upstream's cds FileDiff wrapper div (ca7ba268c Va), not on pierre's element.
		const host = container.querySelector<HTMLElement>("[data-cds=FileDiff]");
		expect({
			metrics: props?.["metrics"],
			leading: host?.style.getPropertyValue("--diffs-line-height"),
		}).toStrictEqual({
			metrics: {hunkLineCount: 50, lineHeight: 20, diffHeaderHeight: 32, spacing: 8},
			leading: "20px",
		});
	});

	// Pierre reads metrics only under a Virtualizer (react/utils/useFileDiffInstance.js:78), so upstream's
	// transcript {17, header 0, paddingTop 8} is inert; don't add dead props here "for parity".
	it("passes no metrics to the non-virtualized transcript diff or user code snippet", () => {
		render(<InlineDiff filePath="src/greet.ts" oldStr="hi" newStr="hello" />);
		render(<UserCodeBlock code="const greeting = 1;" lang="ts" />);
		expect({
			inline: recorded.fileDiff.map((props) => "metrics" in props),
			snippet: recorded.file.map((props) => "metrics" in props),
		}).toStrictEqual({inline: [false], snippet: [false]});
	});
});
