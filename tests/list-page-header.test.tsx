import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vite-plus/test";
import {ListPageHeader} from "../src/components/list-page-header";

const TITLE_CLASS = "min-w-0 font-voice text-[24px]/[32px] font-medium text-primary";
/** Upstream cf35aed38 PageHeader under panels: the header markers and the title-motion block around the title row. */
const HEADER_OPEN = '<header data-cds="PageHeader" data-band="tall" class="@container flex flex-col pb-4 sm:-mt-1">';
const MOTION_OPEN =
	'<div data-cds-part="page-title-motion" class="flex min-w-0 flex-col basis-full origin-left opacity-[var(--cds-page-header-title-opacity,1)] transition-opacity duration-150 rtl:origin-right"><div data-cds-part="title-row">';

describe("ListPageHeader", () => {
	it("sets upstream's 24/32 serif PageHeader title over a 13px muted count caption", () => {
		const markup = [0, 1, 100].map((count) =>
			renderToStaticMarkup(<ListPageHeader title="Items" count={count} itemLabel="item" />),
		);

		expect(markup).toStrictEqual(
			["0 items", "1 item", "100 items"].map(
				(caption) =>
					`${HEADER_OPEN}${MOTION_OPEN}<h1 class="${TITLE_CLASS}">Items</h1></div><p class="mt-1 text-[13px] text-t6">${caption}</p></div></header>`,
			),
		);
	});

	it("puts the actions on the toolbar row, right-aligned", () => {
		const markup = renderToStaticMarkup(
			<ListPageHeader title="Tasks" count={2} itemLabel="task" actions={<button type="button">List</button>} />,
		);

		expect(markup).toBe(
			`${HEADER_OPEN}${MOTION_OPEN}<h1 class="${TITLE_CLASS}">Tasks</h1></div><p class="mt-1 text-[13px] text-t6">2 tasks</p></div><div class="mt-5 flex min-h-8 flex-wrap items-center gap-x-4 gap-y-2"><div data-cds-part="controls" class="ms-auto flex max-w-full shrink-0 flex-wrap items-center justify-end gap-2 [&amp;[data-search-open]]:min-w-min [&amp;[data-search-open]]:flex-nowrap @min-[640px]:[&amp;[data-search-open]]:grow-[3] @min-[640px]:[&amp;[data-search-open]]:basis-0 @max-[640px]:[&amp;[data-search-open]]:basis-full @max-[640px]:[&amp;[data-search-open]&gt;:not([role=search])]:hidden"><button type="button">List</button></div></div></header>`,
		);
	});

	it("pluralizes consonant-y labels with -ies", () => {
		const markup = renderToStaticMarkup(<ListPageHeader title="Claude Memories" count={2} itemLabel="memory" />);
		expect(markup).toContain("2 memories");

		const singular = renderToStaticMarkup(<ListPageHeader title="Claude Memories" count={1} itemLabel="memory" />);
		expect(singular).toContain("1 memory");
	});
});
