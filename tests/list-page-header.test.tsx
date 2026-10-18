import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vite-plus/test";
import {ListPageHeader} from "../src/components/list-page-header";

const TITLE_CLASS = "min-w-0 font-voice text-[24px]/[32px] font-medium text-primary";

describe("ListPageHeader", () => {
	it("sets upstream's 24/32 serif PageHeader title over a 13px muted count caption", () => {
		const markup = [0, 1, 100].map((count) =>
			renderToStaticMarkup(<ListPageHeader title="Items" count={count} itemLabel="item" />),
		);

		expect(markup).toStrictEqual(
			["0 items", "1 item", "100 items"].map(
				(caption) =>
					`<header class="flex flex-col pb-4 sm:-mt-1"><h1 class="${TITLE_CLASS}">Items</h1><p class="mt-1 text-[13px] text-t6">${caption}</p></header>`,
			),
		);
	});

	it("puts the actions on the toolbar row, right-aligned", () => {
		const markup = renderToStaticMarkup(
			<ListPageHeader title="Tasks" count={2} itemLabel="task" actions={<button type="button">List</button>} />,
		);

		expect(markup).toBe(
			`<header class="flex flex-col pb-4 sm:-mt-1"><h1 class="${TITLE_CLASS}">Tasks</h1><p class="mt-1 text-[13px] text-t6">2 tasks</p><div class="mt-5 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2"><div class="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2"><button type="button">List</button></div></div></header>`,
		);
	});

	it("pluralizes consonant-y labels with -ies", () => {
		const markup = renderToStaticMarkup(<ListPageHeader title="Claude Memories" count={2} itemLabel="memory" />);
		expect(markup).toContain("2 memories");

		const singular = renderToStaticMarkup(<ListPageHeader title="Claude Memories" count={1} itemLabel="memory" />);
		expect(singular).toContain("1 memory");
	});
});
