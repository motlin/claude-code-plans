// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {InlineDiff} from "../src/components/tool-renderers/inline-diff";
import {EditRenderer} from "../src/components/tool-renderers/edit-renderer";
import {WriteRenderer} from "../src/components/tool-renderers/write-renderer";
import type {ClientToolCall} from "../src/components/tool-renderers/types";
import {OA, SA, WA} from "../src/components/changes/diffs-config";

class FakeResizeObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

function toolCall(name: string, input: Record<string, unknown>): ClientToolCall {
	return {
		id: "tool-call-64",
		name,
		input,
		param: "",
		result: "ok",
		sourceUuid: "source-64",
	};
}

function shadowRoots(container: HTMLElement): ShadowRoot[] {
	return [...container.querySelectorAll("diffs-container")].map((host) => {
		if (!host.shadowRoot) throw new Error("diffs-container has no shadow root yet");
		return host.shadowRoot;
	});
}

interface InlineDiffMarkup {
	rows: string[];
	pre: Record<string, string | null>;
	hasLibraryHeader: boolean;
}

function inlineDiffMarkup(root: ShadowRoot): InlineDiffMarkup {
	const pre = root.querySelector("pre[data-diff]");
	if (!pre) throw new Error("no rendered <pre> yet");
	return {
		rows: [...root.querySelectorAll("[data-content] > [data-line-type]")].map(
			(row) => `${row.getAttribute("data-line-type")}:${row.textContent}`,
		),
		pre: {
			diffType: pre.getAttribute("data-diff-type"),
			overflow: pre.getAttribute("data-overflow"),
			indicators: pre.getAttribute("data-indicators"),
		},
		hasLibraryHeader: root.querySelector("[data-diffs-header]") !== null,
	};
}

describe("inline Edit/Write diffs render with @pierre/diffs", () => {
	// Upstream _a keeps --diffs-line-height: var(--cds-leading-code) unless a caller passes metrics.lineHeight (ca7ba268c za).
	it("reads the scope's density code tokens on the host rather than a fixed 12/17", async () => {
		const hostVars = (container: HTMLElement) =>
			[...container.querySelectorAll<HTMLElement>("[data-cds=FileDiff]")].map((host) => ({
				size: host.style.getPropertyValue("--diffs-font-size"),
				leading: host.style.getPropertyValue("--diffs-line-height"),
			}));
		const {container} = render(
			<>
				<div data-density="comfortable">
					<InlineDiff filePath="/test/alice.ts" oldStr="const alice = 1;" newStr="const alice = 2;" />
				</div>
				<div data-density="compact">
					<InlineDiff filePath="/test/alice.ts" oldStr="const bob = 1;" newStr="const bob = 2;" />
				</div>
			</>,
		);
		const tokens = {
			size: "var(--code-size, var(--upstream-text-code))",
			leading: "var(--code-leading, var(--upstream-leading-code))",
		};
		await waitFor(() => {
			expect(hostVars(container)).toStrictEqual([tokens, tokens]);
		});
	});

	it("injects upstream's za() list led by Sa (header disabled) and paints the transcript's surface-1 background", async () => {
		const {container} = render(
			<InlineDiff filePath="/test/alice.ts" oldStr="const alice = 1;" newStr="const alice = 2;" />,
		);
		await waitFor(() => {
			const [root] = shadowRoots(container);
			const text = [...(root?.querySelectorAll("style") ?? [])].map((style) => style.textContent).join("");
			const layer = text.slice(text.indexOf("@layer unsafe"));
			const host = container.querySelector<HTMLElement>("[data-cds=FileDiff]");
			expect({
				leadsWithSa: layer.replace(/^@layer unsafe\s*\{\s*/, "").startsWith(SA + WA),
				oa: layer.includes(OA),
				bg: host?.style.getPropertyValue("--cds-filediff-bg"),
			}).toStrictEqual({leadsWithSa: true, oa: true, bg: "var(--cds-surface-1)"});
		});
	});

	it("renders an Edit as a unified, wrapped diff with no file header", async () => {
		const {container} = render(
			<EditRenderer
				toolCall={toolCall("Edit", {
					file_path: "/test/alice.ts",
					old_string: "const alice = 100;\nconst bob = 1;",
					new_string: "const alice = 200;\nconst bob = 1;",
				})}
			/>,
		);

		await waitFor(() => {
			expect(shadowRoots(container).map(inlineDiffMarkup)).toStrictEqual([
				{
					rows: [
						"change-deletion:const alice = 100;",
						"change-addition:const alice = 200;",
						"context:const bob = 1;",
					],
					pre: {diffType: "single", overflow: "wrap", indicators: "classic"},
					hasLibraryHeader: false,
				},
			]);
		});
		expect(container.querySelector(".diff-tailwindcss-wrapper")).toBe(null);
	});

	it("renders one diff per MultiEdit replacement", async () => {
		const {container} = render(
			<EditRenderer
				toolCall={toolCall("MultiEdit", {
					file_path: "/test/alice.ts",
					edits: [
						{old_string: "const a = 1;", new_string: "const a = 2;"},
						{old_string: "", new_string: "const d = 3;"},
					],
				})}
			/>,
		);

		await waitFor(() => {
			expect(shadowRoots(container).map((root) => inlineDiffMarkup(root).rows)).toStrictEqual([
				["change-deletion:const a = 1;", "change-addition:const a = 2;"],
				["change-addition:const d = 3;"],
			]);
		});
	});

	it("renders a Write as an all-additions diff with no file header", async () => {
		const {container} = render(
			<WriteRenderer
				toolCall={toolCall("Write", {
					file_path: "/test/alice.ts",
					content: "const alice = 100;\nconst bob = 1;",
				})}
			/>,
		);

		await waitFor(() => {
			expect(shadowRoots(container).map(inlineDiffMarkup)).toStrictEqual([
				{
					rows: ["change-addition:const alice = 100;", "change-addition:const bob = 1;"],
					pre: {diffType: "single", overflow: "wrap", indicators: "classic"},
					hasLibraryHeader: false,
				},
			]);
		});
		expect(container.querySelector(".diff-tailwindcss-wrapper")).toBe(null);
	});
});
