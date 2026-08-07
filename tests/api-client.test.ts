import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { z } from "zod";
import { ApiResponseError, apiFetch, apiFetchOptional } from "../src/lib/api/client";

const Schema = z.object({ value: z.string() });

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: string) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(
      new Response(body, { status, headers: { "Content-Type": "application/json" } }),
    );
}

describe("apiFetchOptional", () => {
  it("resolves to null on a 404 instead of throwing", async () => {
    mockFetch(404, "Not Found");
    expect(await apiFetchOptional("/api/plans/missing.md", Schema)).toBeNull();
  });

  it("returns parsed data on a 200", async () => {
    mockFetch(200, JSON.stringify({ value: "hello" }));
    expect(await apiFetchOptional("/api/plans/x.md", Schema)).toEqual({ value: "hello" });
  });

  it("still throws on non-404 errors", async () => {
    mockFetch(500, "boom");
    await expect(apiFetchOptional("/api/plans/x.md", Schema)).rejects.toThrow("500");
  });
});

describe("apiFetch", () => {
  it("throws a status-aware error on a 404", async () => {
    mockFetch(404, "Not Found");
    await expect(apiFetch("/api/plans/missing.md", Schema)).rejects.toStrictEqual(
      new ApiResponseError("/api/plans/missing.md", new Response(null, { status: 404 })),
    );
  });
});
