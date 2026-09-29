// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  PROJECT_APPEARANCE_STORAGE_KEY,
  readProjectAppearance,
  setProjectAppearance,
  useProjectAppearance,
} from "../src/lib/project-appearance-store";
import { installLocalStorage } from "./fake-storage";

function stored(): unknown {
  const raw = localStorage.getItem(PROJECT_APPEARANCE_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

describe("project appearance store", () => {
  let storage: ReturnType<typeof installLocalStorage>;

  beforeEach(() => {
    storage = installLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets, merges and clears a project section's icon and color, round-tripping through storage", () => {
    const initial = readProjectAppearance();
    setProjectAppearance("project-alpha", { icon: "code", color: "green" });
    setProjectAppearance("project-__no_project__", { color: "gray" });
    const both = stored();
    setProjectAppearance("project-alpha", { icon: null });
    const iconCleared = readProjectAppearance();
    setProjectAppearance("project-__no_project__", { color: null });

    expect({ initial, both, iconCleared, final: stored() }).toStrictEqual({
      initial: {},
      both: {
        "project-alpha": { icon: "code", color: "green" },
        "project-__no_project__": { color: "gray" },
      },
      iconCleared: {
        "project-alpha": { color: "green" },
        "project-__no_project__": { color: "gray" },
      },
      final: { "project-alpha": { color: "green" } },
    });
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["an unknown icon", JSON.stringify({ "project-alpha": { icon: "unicorn" } })],
    ["unknown keys", JSON.stringify({ "project-alpha": { color: "red", size: 3 } })],
    ["the wrong shape", JSON.stringify([])],
  ])("falls back to empty on %s", (_label, raw) => {
    localStorage.setItem(PROJECT_APPEARANCE_STORAGE_KEY, raw);

    expect(readProjectAppearance()).toStrictEqual({});
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => setProjectAppearance("project-alpha", { icon: "star" })).not.toThrow();
    expect(readProjectAppearance()).toStrictEqual({});
  });

  it("updates hooks locally and from another tab's storage event", () => {
    const hook = renderHook(() => useProjectAppearance());
    act(() => setProjectAppearance("project-alpha", { icon: "star" }));
    const afterLocal = hook.result.current;

    const otherTab = JSON.stringify({ "project-beta": { color: "purple" } });
    act(() => {
      localStorage.setItem(PROJECT_APPEARANCE_STORAGE_KEY, otherTab);
      window.dispatchEvent(
        new StorageEvent("storage", { key: PROJECT_APPEARANCE_STORAGE_KEY, newValue: otherTab }),
      );
    });

    expect({ afterLocal, afterStorageEvent: hook.result.current }).toStrictEqual({
      afterLocal: { "project-alpha": { icon: "star" } },
      afterStorageEvent: { "project-beta": { color: "purple" } },
    });
  });
});
