// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SIDEBAR_STATE,
  readSidebarState,
  setFamiliesCollapsed,
  SIDEBAR_STORAGE_KEY,
  toggleFamilyCollapsed,
  toggleSidebarCollapsed,
  writeSidebarState,
} from "../src/lib/sidebar-store";
import { installLocalStorage } from "./fake-storage";

describe("sidebar-store", () => {
  let storage: ReturnType<typeof installLocalStorage>;

  beforeEach(() => {
    storage = installLocalStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to expanded at the upstream width with no collapsed groups", () => {
    expect(readSidebarState()).toStrictEqual({
      collapsed: false,
      width: 288,
      collapsedGroups: [],
      collapsedFamilies: [],
    });
    expect(DEFAULT_SIDEBAR_STATE).toStrictEqual({
      collapsed: false,
      width: 288,
      collapsedGroups: [],
      collapsedFamilies: [],
    });
  });

  it("persists a toggle to localStorage and reads it back", () => {
    toggleSidebarCollapsed();

    expect(readSidebarState()).toStrictEqual({
      collapsed: true,
      width: 288,
      collapsedGroups: [],
      collapsedFamilies: [],
    });
    expect(JSON.parse(storage.getItem(SIDEBAR_STORAGE_KEY) ?? "null")).toStrictEqual({
      collapsed: true,
      width: 288,
      collapsedGroups: [],
      collapsedFamilies: [],
    });

    toggleSidebarCollapsed();
    expect(readSidebarState()).toStrictEqual({
      collapsed: false,
      width: 288,
      collapsedGroups: [],
      collapsedFamilies: [],
    });
  });

  it("round-trips width and collapsed groups", () => {
    writeSidebarState({
      collapsed: true,
      width: 320,
      collapsedGroups: ["Today", "Older"],
      collapsedFamilies: ["code:a"],
    });

    expect(readSidebarState()).toStrictEqual({
      collapsed: true,
      width: 320,
      collapsedGroups: ["Today", "Older"],
      collapsedFamilies: ["code:a"],
    });
  });

  it("reads state saved before collapsedFamilies existed with no collapsed families", () => {
    storage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ collapsed: true, width: 300, collapsedGroups: ["pinned"] }),
    );

    expect(readSidebarState()).toStrictEqual({
      collapsed: true,
      width: 300,
      collapsedGroups: ["pinned"],
      collapsedFamilies: [],
    });
  });

  it("toggles one family and sets many families collapsed at once", () => {
    toggleFamilyCollapsed("a");
    toggleFamilyCollapsed("b");
    expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:a", "code:b"]);

    toggleFamilyCollapsed("a");
    expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:b"]);

    setFamiliesCollapsed(["a", "b", "c"], true);
    expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:b", "code:a", "code:c"]);

    setFamiliesCollapsed(["a", "c"], false);
    expect(readSidebarState().collapsedFamilies).toStrictEqual(["code:b"]);
  });

  it("falls back to defaults on corrupt JSON", () => {
    storage.setItem(SIDEBAR_STORAGE_KEY, "{not json");

    expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);
  });

  it("falls back to defaults when the stored shape fails the strict schema", () => {
    storage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ collapsed: true, width: 288, collapsedGroups: [], extra: 1 }),
    );
    expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);

    storage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ collapsed: "yes", width: 288, collapsedGroups: [] }),
    );
    expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);

    storage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ collapsed: false, width: 9999, collapsedGroups: [] }),
    );
    expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);
  });

  it("is a no-op when storage throws", () => {
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setItem = vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(readSidebarState()).toStrictEqual(DEFAULT_SIDEBAR_STATE);
    expect(() => toggleSidebarCollapsed()).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});
