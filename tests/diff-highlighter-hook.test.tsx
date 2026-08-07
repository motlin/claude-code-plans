// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { useShikiDiffHighlighter } from "../src/lib/diff-highlighter";

describe("useShikiDiffHighlighter", () => {
  it("loads a missing grammar and changes adapter identity for DiffView", async () => {
    const { result } = renderHook(() => useShikiDiffHighlighter("typescript"));
    const initialAdapter = result.current;

    await waitFor(() => {
      expect(result.current.hasRegisteredCurrentLang("typescript")).toBe(true);
    });

    expect(result.current).not.toBe(initialAdapter);
    expect({
      name: result.current.name,
      type: result.current.type,
      supportsTypeScript: result.current.hasRegisteredCurrentLang("typescript"),
    }).toStrictEqual({
      name: "shiki",
      type: "style",
      supportsTypeScript: true,
    });
  });
});
