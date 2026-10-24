// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {DiffFile} from "../src/components/changes/diff-file";
import {preloadFileTypeIcons} from "../src/components/lazy-file-type-icon";

const PATCH = `diff --git a/src/greet.ts b/src/greet.ts
index 1111111..2222222 100644
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,3 +1,5 @@
 export function greet(name: string) {
-  return "hi " + name;
+  const greeting = "hello";
+  return greeting + " " + name;
 }
+export const loud = (name: string) => greet(name).toUpperCase();
`;

function shadowRootOf(container: HTMLElement): ShadowRoot {
	const host = container.querySelector("diffs-container");
	if (!host?.shadowRoot) throw new Error("diffs-container has no shadow root yet");
	return host.shadowRoot;
}

function contentRowTypes(root: ShadowRoot): string[] {
	return [...root.querySelectorAll("[data-content] > [data-line-type]")].map(
		(row) => row.getAttribute("data-line-type") ?? "",
	);
}

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeAll(async () => {
	await preloadFileTypeIcons();
});

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("DiffFile", () => {
	it("renders every added, removed and context row of a patch, pairing the rewritten line with its replacement", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			expect(contentRowTypes(shadowRootOf(container))).toEqual([
				"context",
				"change-addition",
				"change-deletion",
				"change-addition",
				"context",
				"change-addition",
			]);
		});
	});

	it("applies the upstream Changes pane options to the rendered <pre>", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			const pre = shadowRootOf(container).querySelector("pre[data-diff]");
			expect({
				indicators: pre?.getAttribute("data-indicators"),
				diffType: pre?.getAttribute("data-diff-type"),
				overflow: pre?.getAttribute("data-overflow"),
			}).toEqual({indicators: "classic", diffType: "single", overflow: "wrap"});
		});
	});

	it("renders side-by-side when diffStyle is split", async () => {
		const {container} = render(<DiffFile patch={PATCH} diffStyle="split" />);

		await waitFor(() => {
			const pre = shadowRootOf(container).querySelector("pre[data-diff]");
			expect(pre?.getAttribute("data-diff-type")).toBe("split");
		});
	});

	it("slots the custom header with the file name and +/- counts instead of the library header", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			const header = container.querySelector("[data-diff-file-header]");
			expect({
				path: header?.getAttribute("data-diff-file-header"),
				slot: header?.parentElement?.getAttribute("slot"),
				text: header?.textContent,
			}).toEqual({path: "src/greet.ts", slot: "header-custom", text: "greet.tssrc+3−1"});
		});
	});

	it("draws upstream's 12px file-type icon for the header's file before the path", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			const header = container.querySelector("[data-diff-file-header]");
			const icon = header?.querySelector<SVGSVGElement>("svg[data-file-type-icon]");
			expect({
				className: icon?.getAttribute("class"),
				width: icon?.style.width,
				height: icon?.style.height,
				fills: [...(icon?.querySelectorAll("path") ?? [])].map((path) => path.getAttribute("fill")),
				nextClass: icon?.nextElementSibling?.getAttribute("class"),
				lucide: header?.querySelectorAll(".lucide-file-text").length,
			}).toEqual({
				className: "shrink-0 text-ink-muted",
				width: "12px",
				height: "12px",
				fills: ["var(--fti-typescript)", "var(--fti-typescript)"],
				nextClass: "flex min-w-0 text-body text-secondary",
				lucide: 0,
			});
		});
	});

	it("mounts the custom header slot inside the shadow root so the header is visible", async () => {
		const {container} = render(<DiffFile patch={PATCH} />);

		await waitFor(() => {
			const header = shadowRootOf(container).querySelector("[data-diffs-header]");
			expect({
				mode: header?.getAttribute("data-diffs-header"),
				changeType: header?.getAttribute("data-change-type"),
				slot: header?.querySelector("slot")?.getAttribute("name"),
			}).toEqual({mode: "custom", changeType: "change", slot: "header-custom"});
		});
	});
});
