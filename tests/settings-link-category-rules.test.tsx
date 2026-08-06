// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { SettingsProvider } from "../src/components/settings-provider";
import { LinkCategoryRulesSection } from "../src/routes/settings";
import { installLocalStorage } from "./fake-storage";

function renderEditor() {
  return render(
    <SettingsProvider>
      <LinkCategoryRulesSection />
    </SettingsProvider>,
  );
}

function ruleValues(): Array<{ label: string; hostPattern: string }> {
  return screen.queryAllByRole("group", { name: /^Link category rule / }).map((row) => ({
    label: (within(row).getByRole("textbox", { name: /^Label for rule / }) as HTMLInputElement)
      .value,
    hostPattern: (
      within(row).getByRole("textbox", { name: /^Host pattern for rule / }) as HTMLInputElement
    ).value,
  }));
}

describe("LinkCategoryRulesSection", () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it("adds, labels, and edits rules in declared order", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Label for rule 1" }), {
      target: { value: "Company" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Host pattern for rule 1" }), {
      target: { value: "*.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Label for rule 2" }), {
      target: { value: "Documentation" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Host pattern for rule 2" }), {
      target: { value: "docs.example.net" },
    });

    expect({
      rules: ruleValues(),
      stored: localStorage.getItem("ccp-link-category-rules"),
    }).toStrictEqual({
      rules: [
        { label: "Company", hostPattern: "*.example.com" },
        { label: "Documentation", hostPattern: "docs.example.net" },
      ],
      stored: JSON.stringify([
        { label: "Company", hostPattern: "*.example.com" },
        { label: "Documentation", hostPattern: "docs.example.net" },
      ]),
    });
  });

  it("reorders within deterministic bounds and deletes a rule", () => {
    localStorage.setItem(
      "ccp-link-category-rules",
      JSON.stringify([
        { label: "Company", hostPattern: "*.example.com" },
        { label: "Documentation", hostPattern: "docs.example.net" },
      ]),
    );
    renderEditor();

    const firstUp = screen.getByRole("button", { name: "Move rule 1 up" }) as HTMLButtonElement;
    const secondDown = screen.getByRole("button", {
      name: "Move rule 2 down",
    }) as HTMLButtonElement;
    expect({
      firstUpDisabled: firstUp.disabled,
      secondDownDisabled: secondDown.disabled,
    }).toStrictEqual({ firstUpDisabled: true, secondDownDisabled: true });

    fireEvent.click(screen.getByRole("button", { name: "Move rule 2 up" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete rule 2" }));

    expect({
      rules: ruleValues(),
      controls: screen.getAllByRole("button").map((button) => ({
        name: button.getAttribute("aria-label") ?? button.textContent?.trim(),
        disabled: (button as HTMLButtonElement).disabled,
      })),
    }).toStrictEqual({
      rules: [{ label: "Documentation", hostPattern: "docs.example.net" }],
      controls: [
        { name: "Move rule 1 up", disabled: true },
        { name: "Move rule 1 down", disabled: true },
        { name: "Delete rule 1", disabled: false },
        { name: "Add rule", disabled: false },
      ],
    });
  });

  it("restores persisted edits after remounting", () => {
    const firstRender = renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Label for rule 1" }), {
      target: { value: "Internal" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Host pattern for rule 1" }), {
      target: { value: "internal-wiki" },
    });

    firstRender.unmount();
    renderEditor();

    expect(ruleValues()).toStrictEqual([{ label: "Internal", hostPattern: "internal-wiki" }]);
  });
});
