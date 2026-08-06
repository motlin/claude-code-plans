// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  DEFAULTS,
  SettingsProvider,
  useSettings,
  type LinkCategoryRule,
} from "../src/components/settings-provider";
import { installLocalStorage } from "./fake-storage";

const LINK_CATEGORY_RULES_STORAGE_KEY = "ccp-link-category-rules";

function wrapper({ children }: { children: ReactNode }) {
  return createElement(SettingsProvider, undefined, children);
}

describe("SettingsProvider list persistence", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("serializes and restores the ordered link category rule list as JSON", async () => {
    const rules = [
      { label: "Company", hostPattern: "*.example.com" },
      { label: "Documentation", hostPattern: "docs.example.net" },
    ] satisfies LinkCategoryRule[];
    const firstRender = renderHook(() => useSettings(), { wrapper });

    act(() => firstRender.result.current.setSetting("linkCategoryRules", rules));

    expect({
      stored: localStorage.getItem(LINK_CATEGORY_RULES_STORAGE_KEY),
      current: firstRender.result.current.settings.linkCategoryRules,
    }).toStrictEqual({ stored: JSON.stringify(rules), current: rules });

    firstRender.unmount();
    const reloaded = renderHook(() => useSettings(), { wrapper });
    await waitFor(() =>
      expect(reloaded.result.current.settings.linkCategoryRules).toStrictEqual(rules),
    );
  });

  it.each([
    ["corrupt JSON", "{not-json"],
    ["a wrong JSON type", JSON.stringify({ label: "Company", hostPattern: "*.example.com" })],
    [
      "an invalid row without partial acceptance",
      JSON.stringify([{ label: "Company", hostPattern: "*.example.com" }, { label: "Incomplete" }]),
    ],
  ])("falls back to defaults for %s", async (_description, stored) => {
    localStorage.setItem(LINK_CATEGORY_RULES_STORAGE_KEY, stored);

    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() =>
      expect(result.current.settings.linkCategoryRules).toStrictEqual(DEFAULTS.linkCategoryRules),
    );
  });

  it("preserves scalar string, boolean, and numeric serialization and parsing", async () => {
    const firstRender = renderHook(() => useSettings(), { wrapper });

    act(() => {
      firstRender.result.current.setSetting("defaultSubagentView", "sequence");
      firstRender.result.current.setSetting("sessionSort", "stable");
      firstRender.result.current.setSetting("workingCopyReviewMode", "auto");
      firstRender.result.current.setSetting("showThinking", true);
      firstRender.result.current.setSetting("activeTimeoutSec", 120);
    });

    expect({
      storedString: localStorage.getItem("ccp-subagent-view"),
      storedSessionSort: localStorage.getItem("ccp-session-sort"),
      storedReviewMode: localStorage.getItem("ccp-working-copy-review-mode"),
      storedBoolean: localStorage.getItem("ccp-show-thinking"),
      storedNumber: localStorage.getItem("ccp-active-timeout"),
    }).toStrictEqual({
      storedString: "sequence",
      storedSessionSort: "stable",
      storedReviewMode: "auto",
      storedBoolean: "true",
      storedNumber: "120",
    });

    firstRender.unmount();
    const reloaded = renderHook(() => useSettings(), { wrapper });
    await waitFor(() =>
      expect({
        stringValue: reloaded.result.current.settings.defaultSubagentView,
        sessionSort: reloaded.result.current.settings.sessionSort,
        reviewMode: reloaded.result.current.settings.workingCopyReviewMode,
        booleanValue: reloaded.result.current.settings.showThinking,
        numericValue: reloaded.result.current.settings.activeTimeoutSec,
      }).toStrictEqual({
        stringValue: "sequence",
        sessionSort: "stable",
        reviewMode: "auto",
        booleanValue: true,
        numericValue: 120,
      }),
    );
  });

  it("rejects an unknown working-copy review mode", async () => {
    localStorage.setItem("ccp-working-copy-review-mode", "sometimes");
    const { result } = renderHook(() => useSettings(), { wrapper });

    await waitFor(() =>
      expect(result.current.settings.workingCopyReviewMode).toBe(DEFAULTS.workingCopyReviewMode),
    );
  });
});
