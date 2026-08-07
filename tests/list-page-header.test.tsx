import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ListPageHeader } from "../src/components/list-page-header";

describe("ListPageHeader", () => {
  it("renders counts with consistent singular and plural labels", () => {
    const markup = [0, 1, 100].map((count) =>
      renderToStaticMarkup(<ListPageHeader title="Items" count={count} itemLabel="item" />),
    );

    expect(markup).toStrictEqual([
      '<header class="flex items-start justify-between gap-4"><div><h1 class="text-lg font-semibold">Items</h1><p class="mt-1 text-sm text-text-500">0 items</p></div></header>',
      '<header class="flex items-start justify-between gap-4"><div><h1 class="text-lg font-semibold">Items</h1><p class="mt-1 text-sm text-text-500">1 item</p></div></header>',
      '<header class="flex items-start justify-between gap-4"><div><h1 class="text-lg font-semibold">Items</h1><p class="mt-1 text-sm text-text-500">100 items</p></div></header>',
    ]);
  });
});
