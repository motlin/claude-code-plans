// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { SettingsProvider } from "../src/components/settings-provider";
import { ClaudeCodeSettings } from "../src/components/settings/settings-sections";
import { ThemeProvider } from "../src/components/theme-provider";
import { installLocalStorage } from "./fake-storage";

async function renderClaudeCode() {
  render(
    <ThemeProvider>
      <SettingsProvider>
        <ClaudeCodeSettings />
      </SettingsProvider>
    </ThemeProvider>,
  );
  await act(async () => {});
}

function preview(name: string) {
  const figure = screen.getByRole("figure", { name });
  return {
    theme: figure.getAttribute("data-code-theme"),
    background: figure.style.backgroundColor,
    text: figure.textContent,
  };
}

beforeEach(() => {
  installLocalStorage();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--font-mono");
});

describe("Claude Code settings ▸ Code appearance", () => {
  it("re-renders the dark preview with the chosen theme", async () => {
    await renderClaudeCode();

    await waitFor(() => {
      expect(preview("Dark code theme preview").background).toBe("rgb(36, 41, 46)");
    });
    const before = preview("Dark code theme preview");

    fireEvent.click(screen.getByRole("combobox", { name: "Dark code theme" }));
    fireEvent.click(screen.getByRole("option", { name: "Nord" }));

    await waitFor(() => {
      expect(preview("Dark code theme preview").background).toBe("rgb(46, 52, 64)");
    });

    expect({
      before,
      after: preview("Dark code theme preview"),
      stored: localStorage.getItem("ccp-code-theme-dark"),
      light: preview("Light code theme preview").theme,
    }).toStrictEqual({
      before: {
        theme: "github-dark",
        background: "rgb(36, 41, 46)",
        text: '1function greet(name: string) {2-  return "Hello, " + name;2+  return `Hello, ${name}!`;3}',
      },
      after: {
        theme: "nord",
        background: "rgb(46, 52, 64)",
        text: '1function greet(name: string) {2-  return "Hello, " + name;2+  return `Hello, ${name}!`;3}',
      },
      stored: "nord",
      light: "claude-light",
    });
  });

  it("applies a custom code font to --font-mono and clears it when emptied", async () => {
    await renderClaudeCode();
    const input = screen.getByRole("textbox", { name: "Code font" });

    fireEvent.change(input, { target: { value: "Fira Code" } });
    const custom = document.documentElement.style.getPropertyValue("--font-mono");
    fireEvent.change(input, { target: { value: "" } });
    const cleared = document.documentElement.style.getPropertyValue("--font-mono");

    expect({
      placeholder: input.getAttribute("placeholder"),
      custom,
      cleared,
      stored: localStorage.getItem("ccp-code-font"),
    }).toStrictEqual({
      placeholder: "e.g. JetBrains Mono",
      custom:
        '"Fira Code", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Code", monospace',
      cleared: "",
      stored: "",
    });
  });
});
