import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { GhosttyConfig } from "../src/lib/ghostty/config";
import { getGhosttyAppearance } from "../src/lib/server-fns";

const ghosttyConfigState = vi.hoisted(() => ({
  config: {} as GhosttyConfig,
}));

vi.mock("../src/lib/ghostty/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/ghostty/config")>();
  return {
    ...original,
    readGhosttyConfig: vi.fn(() => ghosttyConfigState.config),
  };
});

vi.mock("@tanstack/react-start", () => ({
  createServerFn: vi.fn(() => ({
    handler: vi.fn((handler: () => unknown) => async () => handler()),
  })),
}));

describe("server functions", () => {
  beforeEach(() => {
    ghosttyConfigState.config = {};
  });

  it("returns the configured Ghostty appearance with Nerd Font fallbacks", async () => {
    ghosttyConfigState.config = {
      fontFamily: "Alice Mono",
      fontSize: 16,
      theme: {
        cursor: "#dddddd",
        selectionBackground: "#cccccc",
        selectionForeground: "#111111",
        black: "#000000",
        red: "#110000",
        green: "#001100",
        yellow: "#111100",
        blue: "#000011",
        magenta: "#110011",
        cyan: "#001111",
        white: "#aaaaaa",
        brightBlack: "#555555",
        brightRed: "#ff0000",
        brightGreen: "#00ff00",
        brightYellow: "#ffff00",
        brightBlue: "#0000ff",
        brightMagenta: "#ff00ff",
        brightCyan: "#00ffff",
        brightWhite: "#ffffff",
      },
    };

    await expect(getGhosttyAppearance()).resolves.toStrictEqual({
      fontFamily:
        '"Alice Mono", "MesloLGS Nerd Font Mono", "MesloLGS NF Web", "JetBrains Mono", monospace',
      fontSize: 16,
      theme: {
        background: "#111318",
        foreground: "#e6e6e6",
        cursor: "#dddddd",
        selectionBackground: "#cccccc",
        selectionForeground: "#111111",
        black: "#000000",
        red: "#110000",
        green: "#001100",
        yellow: "#111100",
        blue: "#000011",
        magenta: "#110011",
        cyan: "#001111",
        white: "#aaaaaa",
        brightBlack: "#555555",
        brightRed: "#ff0000",
        brightGreen: "#00ff00",
        brightYellow: "#ffff00",
        brightBlue: "#0000ff",
        brightMagenta: "#ff00ff",
        brightCyan: "#00ffff",
        brightWhite: "#ffffff",
      },
    });
  });

  it("returns the current terminal defaults when Ghostty omits appearance settings", async () => {
    await expect(getGhosttyAppearance()).resolves.toStrictEqual({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 13,
      theme: {
        background: "#111318",
        foreground: "#e6e6e6",
      },
    });
  });
});
