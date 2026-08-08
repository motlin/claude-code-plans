import { describe, expect, it } from "vite-plus/test";

import { resolveLink } from "../src/components/linked-json";

describe("resolveLink", () => {
  it("drops the Markdown extension from plan links", () => {
    const resolved = resolveLink("plans/foo.md", "plan", {
      sessionId: "00000000-0000-0000-0000-000000000000",
    });

    expect(resolved?.href).toBe("/plan/foo");
    expect(resolved?.href).not.toContain(".md");
  });
});
