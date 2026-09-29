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
  it("lists all 36 upstream web entries", () => {
    expect(SHORTCUT_IDS).toHaveLength(36);
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
      "new_session",
      "rename_session",
      "archive_session",
      "toggle_read_session",
      "copy_session_link",
      "open_session_pr",
      "fork_session",
      "transcript_view",
      "jump_prev_prompt",
      "jump_next_prompt",
      "focus_next_region",
      "focus_previous_region",
      "stop_response",
      "toggle_changes",
      "toggle_changes_file_list",
      "go_to_file_in_changes",
      "toggle_files",
      "attach_selection",
      "toggle_terminal",
      "close_pane",
      "expand_collapse_pane",
      "toggle_side_chat",
      "open_mode_menu",
      "open_model_menu",
      "open_effort_selector",
      "select_menu_item",
    ]);
  });

  it("binds F6 (plus ⌘F6 / Ctrl+F6) forward and ⇧F6 backward", () => {
    expect({
      nextMac: bindingsFor("focus_next_region", true),
      nextNonMac: bindingsFor("focus_next_region", false),
      previous: bindingsFor("focus_previous_region", true),
    }).toStrictEqual({
      nextMac: [
        { key: "f6", code: "F6", modifiers: [] },
        { key: "f6", code: "F6", modifiers: ["cmd"], platform: "mac" },
      ],
      nextNonMac: [
        { key: "f6", code: "F6", modifiers: [] },
        { key: "f6", code: "F6", modifiers: ["ctrl"], platform: "non-mac" },
      ],
      previous: [{ key: "f6", code: "F6", modifiers: ["shift"] }],
    });
  });

  it("binds ⌥⌘↑ / ⌥⌘↓ on mac and Alt+↑ / Alt+↓ elsewhere", () => {
    expect({
      prevMac: bindingsFor("jump_prev_prompt", true),
      prevNonMac: bindingsFor("jump_prev_prompt", false),
      nextMac: bindingsFor("jump_next_prompt", true),
      nextNonMac: bindingsFor("jump_next_prompt", false),
    }).toStrictEqual({
      prevMac: [{ key: "arrowup", code: "ArrowUp", modifiers: ["cmd", "alt"], platform: "mac" }],
      prevNonMac: [{ key: "arrowup", code: "ArrowUp", modifiers: ["alt"], platform: "non-mac" }],
      nextMac: [
        { key: "arrowdown", code: "ArrowDown", modifiers: ["cmd", "alt"], platform: "mac" },
      ],
      nextNonMac: [
        { key: "arrowdown", code: "ArrowDown", modifiers: ["alt"], platform: "non-mac" },
      ],
    });
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
