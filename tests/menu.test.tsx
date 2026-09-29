// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ContextMenu,
  ContextMenuTrigger,
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "../src/components/ui/menu";

afterEach(() => {
  cleanup();
});

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function RowMenuBody({ onCopy, onDelete }: { onCopy: () => void; onDelete: () => void }) {
  const [status, setStatus] = useState("active");
  const [showPr, setShowPr] = useState(true);
  return (
    <>
      <MenuLabel>Session</MenuLabel>
      <MenuSub>
        <MenuSubTrigger value="Active">Status</MenuSubTrigger>
        <MenuSubContent>
          <MenuRadioGroup value={status} onValueChange={setStatus}>
            <MenuRadioItem value="active">Active</MenuRadioItem>
            <MenuRadioItem value="all">All</MenuRadioItem>
          </MenuRadioGroup>
        </MenuSubContent>
      </MenuSub>
      <MenuSeparator />
      <MenuItem accelerator="c" onSelect={onCopy}>
        Copy link
      </MenuItem>
      <MenuCheckboxItem checked={showPr} onCheckedChange={setShowPr}>
        Show PR status
      </MenuCheckboxItem>
      <MenuItem accelerator="d" variant="danger" onSelect={onDelete}>
        Delete
      </MenuItem>
    </>
  );
}

function renderDropdown(handlers = { onCopy: vi.fn(), onDelete: vi.fn() }) {
  render(
    <Menu>
      <MenuTrigger aria-label="More options">...</MenuTrigger>
      <MenuContent>
        <RowMenuBody {...handlers} />
      </MenuContent>
    </Menu>,
  );
  return handlers;
}

async function openDropdown() {
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  await flush();
  return screen.getByRole("menu");
}

describe("Menu", () => {
  it("renders items with menuitem, menuitemcheckbox and menuitemradio roles", async () => {
    renderDropdown();
    await openDropdown();

    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual([
      "StatusActive",
      "Copy linkC",
      "DeleteD",
    ]);
    expect(
      screen
        .getAllByRole("menuitemcheckbox")
        .map((el) => [el.textContent, el.getAttribute("aria-checked")]),
    ).toEqual([["Show PR status", "true"]]);
    expect(screen.getByRole("menu").getAttribute("data-cds")).toBe("Menu");
    expect(screen.getAllByRole("separator")).toHaveLength(1);
  });

  it("sets aria-keyshortcuts from the accelerator letter", async () => {
    renderDropdown();
    await openDropdown();

    expect(
      screen.getAllByRole("menuitem").map((el) => el.getAttribute("aria-keyshortcuts")),
    ).toEqual([null, "c", "d"]);
  });

  it("marks danger items", async () => {
    renderDropdown();
    await openDropdown();

    expect(screen.getByRole("menuitem", { name: /Delete/ }).getAttribute("data-variant")).toBe(
      "danger",
    );
  });

  it("does not open a submenu on hover alone", async () => {
    renderDropdown();
    await openDropdown();
    const trigger = screen.getByRole("menuitem", { name: /Status/ });

    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(trigger);
    fireEvent.pointerMove(trigger, { pointerType: "mouse" });
    fireEvent.mouseMove(trigger);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });

    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a submenu with ArrowRight and shows radio items", async () => {
    renderDropdown();
    await openDropdown();
    const trigger = screen.getByRole("menuitem", { name: /Status/ });

    act(() => trigger.focus());
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    await flush();

    expect(screen.getAllByRole("menu")).toHaveLength(2);
    expect(
      screen
        .getAllByRole("menuitemradio")
        .map((el) => [el.textContent, el.getAttribute("aria-checked")]),
    ).toEqual([
      ["Active", "true"],
      ["All", "false"],
    ]);
  });

  it("activates the item for an accelerator letter and closes the menu", async () => {
    const handlers = renderDropdown();
    const menu = await openDropdown();

    fireEvent.keyDown(menu, { key: "c" });
    await flush();

    expect(handlers.onCopy).toHaveBeenCalledTimes(1);
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("ignores accelerator letters pressed with a modifier", async () => {
    const handlers = renderDropdown();
    const menu = await openDropdown();

    fireEvent.keyDown(menu, { key: "c", metaKey: true });
    await flush();

    expect(handlers.onCopy).not.toHaveBeenCalled();
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    renderDropdown();
    const menu = await openDropdown();

    fireEvent.keyDown(menu, { key: "Escape" });
    await flush();

    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "More options" }));
  });
});

describe("ContextMenu", () => {
  it("opens the same content on right-click", async () => {
    const onCopy = vi.fn();
    render(
      <ContextMenu>
        <ContextMenuTrigger>
          <div>Row title</div>
        </ContextMenuTrigger>
        <MenuContent>
          <RowMenuBody onCopy={onCopy} onDelete={vi.fn()} />
        </MenuContent>
      </ContextMenu>,
    );
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.contextMenu(screen.getByText("Row title"), { clientX: 40, clientY: 50 });
    await flush();

    const menu = screen.getByRole("menu");
    expect(menu.getAttribute("data-cds")).toBe("ContextMenu");
    fireEvent.keyDown(menu, { key: "c" });
    await flush();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
