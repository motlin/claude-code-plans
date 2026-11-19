// @vitest-environment jsdom

import {cleanup, render, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";
import {MermaidFenceGate} from "../src/components/mermaid-fence-gate";
import
{
	createMermaidSourceStore,
	FindEnabledContext,
	MermaidBlockIdContext,
	mermaidSourceKey,
	MermaidSourceStoreContext,
	type MermaidSourceStore,
} from "../src/lib/mermaid-find";

const {fence} = vi.hoisted(() => (
{
	fence:
	{
		shows: "code",
	},
}));

// The fence itself is covered in mermaid-fence.test.tsx; here it shows its source or its stand-in on demand.
vi.mock("../src/components/mermaid-fence", () => (
{
	MermaidFence: ({codeBlock, placeholder}: {codeBlock: ReactNode; placeholder: ReactNode}) => (
		<>{fence.shows === "code" ? codeBlock : placeholder}</>
	),
}));

const CODE = "graph TD; A-->B";
const KEY = mermaidSourceKey("reply:0", CODE);

beforeEach(() =>
{
	fence.shows = "code";
});

afterEach(() =>
{
	cleanup();
});

function Fence({store, find, mounted = true}: {store: MermaidSourceStore; find: boolean; mounted?: boolean})
{
	return (
		<FindEnabledContext value={find}>
			<MermaidSourceStoreContext value={store}>
				<MermaidBlockIdContext value="reply:0">
					<div data-transcript-entry-index="0">
						{mounted && <MermaidFenceGate code={CODE} codeBlockHtml={`<pre>${CODE}</pre>`} />}
					</div>
				</MermaidBlockIdContext>
			</MermaidSourceStoreContext>
		</FindEnabledContext>
	);
}

function marks(container: HTMLElement)
{
	return {
		omitted: [...container.querySelectorAll("[data-find-omitted]")].map((element) => element.tagName),
		included: [...container.querySelectorAll("[data-find-included]")].map(
			(element) => `${element.tagName}.${element.className}: ${element.textContent}`,
		),
	};
}

describe("MermaidFenceGate under in-page find (upstream c5071af19 Dn/Tn/En/xn)", () =>
{
	it("omits the fence, includes its shown source and reports the source visible while find is enabled", async () =>
	{
		const store = createMermaidSourceStore();
		const {container} = render(<Fence store={store} find />);
		await waitFor(() =>
		{
			expect(store.getState().isMermaidSourceVisible(KEY)).toBe(true);
		});
		expect(marks(container)).toStrictEqual(
			{
				omitted: ["DIV"],
				included: [`DIV.contents: ${CODE}`],
			},
		);
	});

	it("marks nothing and reports the source hidden while find is not enabled", async () =>
	{
		const store = createMermaidSourceStore();
		const {container} = render(<Fence store={store} find={false} />);
		await waitFor(() =>
		{
			expect(container.querySelector("pre")).not.toBeNull();
		});
		expect(
			{
				...marks(container),
				visible: store.getState().isMermaidSourceVisible(KEY),
				version: store.getState().version,
			},
		).toStrictEqual(
			{
				omitted: [],
				included: [],
				visible: false,
				version: 0,
			},
		);
	});

	it("reports the source hidden when the fence unmounts inside its row, but keeps it when the row itself goes", async () =>
	{
		const store = createMermaidSourceStore();
		const first = render(<Fence store={store} find />);
		await waitFor(() =>
		{
			expect(store.getState().isMermaidSourceVisible(KEY)).toBe(true);
		});
		first.rerender(<Fence store={store} find mounted={false} />);
		const afterFenceUnmount = store.getState().isMermaidSourceVisible(KEY);

		first.rerender(<Fence store={store} find />);
		await waitFor(() =>
		{
			expect(store.getState().isMermaidSourceVisible(KEY)).toBe(true);
		});
		first.unmount();
		expect(
			{
				afterFenceUnmount,
				afterRowUnmount: store.getState().isMermaidSourceVisible(KEY),
			},
		).toStrictEqual(
			{
				afterFenceUnmount: false,
				afterRowUnmount: true,
			},
		);
	});

	it("keeps the reported visibility while the placeholder stands in", async () =>
	{
		fence.shows = "placeholder";
		const store = createMermaidSourceStore();
		const {container} = render(<Fence store={store} find />);
		await waitFor(() =>
		{
			expect(container.querySelector("[data-testid=epitaxy-mermaid-fence-placeholder]")).not.toBeNull();
		});
		expect(
			{
				...marks(container),
				visible: store.getState().isMermaidSourceVisible(KEY),
			},
		).toStrictEqual(
			{
				omitted: ["DIV"],
				included: [],
				visible: false,
			},
		);
	});
});
