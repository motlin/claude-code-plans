// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";
import { Route } from "../src/routes/__root";

describe("root route head", () => {
  it("extends the layout viewport under phone safe areas", () => {
    const head = Route.options.head as () => { meta: Array<Record<string, string>> };
    expect(head().meta.filter((meta) => meta["name"] === "viewport")).toStrictEqual([
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
    ]);
  });
});
