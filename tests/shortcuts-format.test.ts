import { describe, expect, it } from "vite-plus/test";

import { formatKeys, toAriaKeyShortcuts } from "../src/lib/shortcuts/format";

describe("formatKeys", () => {
  it("renders mac glyphs with spoken labels in ctrl, alt, shift, cmd order", () => {
    expect(formatKeys("cmd+alt+r", true)).toEqual([
      { label: "⌥", spoken: "Option" },
      { label: "⌘", spoken: "Command" },
      { label: "R" },
    ]);
  });

  it("renders non-mac names and rewrites cmd to Ctrl", () => {
    expect(formatKeys("cmd+alt+r", false)).toEqual([
      { label: "Ctrl" },
      { label: "Alt" },
      { label: "R" },
    ]);
  });

  it("orders every modifier ctrl < alt < shift < cmd regardless of input order", () => {
    expect(formatKeys("cmd+shift+alt+ctrl+d", true)).toEqual([
      { label: "⌃", spoken: "Control" },
      { label: "⌥", spoken: "Option" },
      { label: "⇧", spoken: "Shift" },
      { label: "⌘", spoken: "Command" },
      { label: "D" },
    ]);
    expect(formatKeys("shift+cmd+k", false)).toEqual([
      { label: "Ctrl" },
      { label: "Shift" },
      { label: "K" },
    ]);
  });

  it("collapses cmd and ctrl into one Ctrl on non-mac", () => {
    expect(formatKeys("ctrl+cmd+s", false)).toEqual([{ label: "Ctrl" }, { label: "S" }]);
  });

  it("renders esc without a spoken label", () => {
    expect(formatKeys("esc", true)).toEqual([{ label: "Esc" }]);
    expect(formatKeys("escape", false)).toEqual([{ label: "Esc" }]);
  });

  it("renders enter as ⏎ with the spoken label Enter", () => {
    expect(formatKeys("cmd+alt+enter", true)).toEqual([
      { label: "⌥", spoken: "Option" },
      { label: "⌘", spoken: "Command" },
      { label: "⏎", spoken: "Enter" },
    ]);
    expect(formatKeys("cmd+alt+enter", false)).toEqual([
      { label: "Ctrl" },
      { label: "Alt" },
      { label: "⏎", spoken: "Enter" },
    ]);
  });

  it("keeps a digit range as one label", () => {
    expect(formatKeys("1…9", true)).toEqual([{ label: "1…9" }]);
  });

  it("renders named keys and punctuation", () => {
    expect(formatKeys("ctrl+`", true)).toEqual([{ label: "⌃", spoken: "Control" }, { label: "`" }]);
    expect(formatKeys("cmd+\\", true)).toEqual([
      { label: "⌘", spoken: "Command" },
      { label: "\\" },
    ]);
    expect(formatKeys("shift+f6", false)).toEqual([{ label: "Shift" }, { label: "F6" }]);
    expect(formatKeys("arrowup", true)).toEqual([{ label: "↑", spoken: "Up" }]);
    expect(formatKeys("space", false)).toEqual([{ label: "Space" }]);
    expect(formatKeys("space", true)).toEqual([{ label: "␣", spoken: "Space" }]);
  });
});

describe("toAriaKeyShortcuts", () => {
  it("uses Meta on mac and Control elsewhere", () => {
    expect(toAriaKeyShortcuts("cmd+shift+o", true)).toBe("Shift+Meta+o");
    expect(toAriaKeyShortcuts("cmd+shift+o", false)).toBe("Control+Shift+o");
  });

  it("maps named keys to KeyboardEvent.key names", () => {
    expect(toAriaKeyShortcuts("cmd+alt+enter", true)).toBe("Alt+Meta+Enter");
    expect(toAriaKeyShortcuts("esc", false)).toBe("Escape");
    expect(toAriaKeyShortcuts("ctrl+`", true)).toBe("Control+Backquote");
  });
});
