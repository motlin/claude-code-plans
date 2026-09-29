import { afterEach, describe, expect, it } from "vite-plus/test";

const originalTitle = process.title;

afterEach(() => {
  process.title = originalTitle;
});

describe("dev server process title", () => {
  it("names the Vite dev process so it is identifiable in ps", async () => {
    process.title = "node";

    await import("../vite.config");

    expect(process.title).toBe("claude-code-browser");
  });
});
