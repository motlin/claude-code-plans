import { describe, expect, it } from "vite-plus/test";
import { getRouter } from "../src/router";

describe("router query client", () => {
  it("does not refetch mounted queries when the window regains focus", () => {
    const router = getRouter();

    expect(
      router.options.context.queryClient.getDefaultOptions().queries?.refetchOnWindowFocus,
    ).toBe(false);
  });
});
