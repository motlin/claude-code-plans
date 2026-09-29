import { describe, expect, it } from "vite-plus/test";

import { bindingsFor } from "../src/lib/shortcuts/match";
import {
  SHORTCUT_IDS,
  SHORTCUTS,
  type Binding,
  bindingToKeys,
} from "../src/lib/shortcuts/registry";

const BROWSER_RESERVED = ["l", "t", "w", "n"];

function chord(binding: Binding): string {
  return bindingToKeys(binding);
}

describe("shortcut registry", () => {
  it("lists all 32 upstream web entries", () => {
    expect(SHORTCUT_IDS).toHaveLength(32);
  });

  it.each(SHORTCUT_IDS)("%s has mac and non-mac bindings", (id) => {
    expect(bindingsFor(id, true).length).toBeGreaterThan(0);
    expect(bindingsFor(id, false).length).toBeGreaterThan(0);
  });

  it("never binds browser-reserved ⌘L / ⌘T / ⌘W / ⌘N", () => {
    const offenders = SHORTCUT_IDS.flatMap((id) =>
      SHORTCUTS[id].bindings
        .filter(
          (b) =>
            BROWSER_RESERVED.includes(b.key) &&
            b.modifiers.length === 1 &&
            (b.modifiers[0] === "cmd" || (b.modifiers[0] === "ctrl" && b.platform !== "mac")),
        )
        .map((b) => `${id}: ${chord(b)}`),
    );
    expect(offenders).toEqual([]);
  });

  it("never gives two enabled entries the same binding on a platform", () => {
    for (const isMac of [true, false]) {
      const seen = new Map<string, string>();
      const duplicates: string[] = [];
      for (const id of SHORTCUT_IDS.filter((i) => SHORTCUTS[i].enabled)) {
        for (const b of bindingsFor(id, isMac)) {
          const key = chord(b);
          const prior = seen.get(key);
          if (prior !== undefined) duplicates.push(`${prior} and ${id}: ${key}`);
          seen.set(key, id);
        }
      }
      expect(duplicates).toEqual([]);
    }
  });

  it("only enables the shortcuts wired today", () => {
    expect(SHORTCUT_IDS.filter((id) => SHORTCUTS[id].enabled)).toEqual([
      "search_or_start",
      "search",
      "switch_recents",
      "toggle_sidebar",
      "shortcuts_modal",
      "settings",
      "rename_session",
      "archive_session",
      "copy_session_link",
      "transcript_view",
      "toggle_changes",
      "toggle_changes_file_list",
      "go_to_file_in_changes",
      "close_pane",
      "expand_collapse_pane",
    ]);
  });

  it("binds ⌘K strictly on mac and Ctrl+K elsewhere", () => {
    expect(bindingsFor("search_or_start", true)).toEqual([
      { key: "k", modifiers: ["cmd"], platform: "mac" },
    ]);
    expect(bindingsFor("search_or_start", false)).toEqual([
      { key: "k", modifiers: ["ctrl"], platform: "non-mac" },
    ]);
  });
});
