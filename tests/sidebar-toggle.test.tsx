// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { SidebarToggleButton } from "../src/components/sidebar/sidebar-toggle";
import { readSidebarState, useSidebarToggleShortcut } from "../src/lib/sidebar-store";
import { installLocalStorage } from "./fake-storage";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

function Harness() {
  useSidebarToggleShortcut();
  return (
    <>
      <textarea aria-label="Composer" />
      <SidebarToggleButton />
    </>
  );
}

describe("sidebar toggle", () => {
  beforeEach(() => {
    installLocalStorage();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(MAC_UA);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("toggles with ⌘B from a focused textarea and flips the button label", () => {
    render(<Harness />);
    const composer = screen.getByRole("textbox", { name: "Composer" });
    composer.focus();

    expect(screen.getByRole("button", { name: "Hide sidebar" }).tagName).toBe("BUTTON");

    const event = new KeyboardEvent("keydown", {
      key: "b",
      code: "KeyB",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      composer.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("button", { name: "Show sidebar" }).tagName).toBe("BUTTON");
    expect(readSidebarState().collapsed).toBe(true);

    act(() => {
      fireEvent.keyDown(composer, { key: "b", code: "KeyB", metaKey: true });
    });
    expect(screen.getByRole("button", { name: "Hide sidebar" }).tagName).toBe("BUTTON");
    expect(readSidebarState().collapsed).toBe(false);
  });

  it("toggles when the button is clicked", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));

    expect(screen.getByRole("button", { name: "Show sidebar" }).tagName).toBe("BUTTON");
    expect(readSidebarState().collapsed).toBe(true);
  });
});
