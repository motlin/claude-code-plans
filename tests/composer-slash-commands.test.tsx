// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Composer } from "../src/components/composer";
import type { SlashCommand } from "../src/lib/slash-commands";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const COMMANDS: SlashCommand[] = [
  {
    name: "model",
    description: "Set the model for this session",
    source: "builtin",
    argumentHint: "[model]",
  },
  { name: "plan", description: "Switch to plan mode", source: "builtin" },
  { name: "standup", description: "Write my standup", source: "personal-command" },
];

function setup(onSend = vi.fn<(prompt: string) => void>()) {
  render(
    <Composer
      variant="session"
      draftKey="session-alice"
      onSend={onSend}
      slashCommands={COMMANDS}
    />,
  );
  const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Prompt" });
  return { textarea, onSend };
}

function rows(): { name: string; highlighted: boolean }[] {
  return screen.getAllByRole("menuitem").map((row) => ({
    name: row.textContent ?? "",
    highlighted: row.hasAttribute("data-highlighted"),
  }));
}

describe("Composer slash commands", () => {
  it("opens the built-in list with the first row highlighted when the text starts with /", () => {
    const { textarea } = setup();
    const closed = screen.queryByRole("menu", { name: "Slash commands" });

    fireEvent.change(textarea, { target: { value: "/" } });

    expect({ closed, rows: rows() }).toStrictEqual({
      closed: null,
      rows: [
        { name: "model", highlighted: true },
        { name: "plan", highlighted: false },
      ],
    });
  });

  it("filters over name and description with bold match spans and tags custom commands", () => {
    const { textarea } = setup();

    fireEvent.change(textarea, { target: { value: "/st" } });
    const menu = screen.getByRole("menu", { name: "Slash commands" });
    const bold = [...menu.querySelectorAll(".font-semibold")].map((el) => el.textContent);

    expect({ rows: rows(), bold }).toStrictEqual({
      rows: [{ name: "standupCustom command", highlighted: true }],
      bold: ["st"],
    });
  });

  it("shows the highlighted row's description as a tooltip with its matches in bold", () => {
    const { textarea } = setup();

    fireEvent.change(textarea, { target: { value: "/mode" } });
    const tooltip = screen.getByRole("tooltip");

    expect({
      rows: rows(),
      tooltip: tooltip.textContent,
      bold: [...tooltip.querySelectorAll(".font-semibold")].map((el) => el.textContent),
    }).toStrictEqual({
      rows: [
        { name: "model", highlighted: true },
        { name: "plan", highlighted: false },
      ],
      tooltip: "Set the model for this session",
      bold: ["mode"],
    });
  });

  it("moves the highlight with arrow keys, wrapping at the ends", () => {
    const { textarea } = setup();
    fireEvent.change(textarea, { target: { value: "/" } });

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    const down = rows();
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    const wrapped = rows();
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect({ down, wrapped, up: rows() }).toStrictEqual({
      down: [
        { name: "model", highlighted: false },
        { name: "plan", highlighted: true },
      ],
      wrapped: [
        { name: "model", highlighted: true },
        { name: "plan", highlighted: false },
      ],
      up: [
        { name: "model", highlighted: false },
        { name: "plan", highlighted: true },
      ],
    });
  });

  it("accepts with Enter, inserting the name and showing the argument hint without sending", () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: "/mo" } });

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect({
      value: textarea.value,
      menu: screen.queryByRole("menu", { name: "Slash commands" }),
      hint: screen.getByTestId("slash-argument-hint").textContent,
      sent: onSend.mock.calls,
    }).toStrictEqual({ value: "/model ", menu: null, hint: "[model]", sent: [] });
  });

  it("accepts the highlighted row with Tab and hides the hint once arguments are typed", () => {
    const { textarea } = setup();
    fireEvent.change(textarea, { target: { value: "/" } });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    fireEvent.keyDown(textarea, { key: "Tab" });
    const accepted = textarea.value;
    fireEvent.change(textarea, { target: { value: "/model opus" } });

    expect({ accepted, hint: screen.queryByTestId("slash-argument-hint") }).toStrictEqual({
      accepted: "/plan ",
      hint: null,
    });
  });

  it("accepts a row on click", () => {
    const { textarea } = setup();
    fireEvent.change(textarea, { target: { value: "/" } });

    const menu = screen.getByRole("menu", { name: "Slash commands" });
    fireEvent.mouseDown(within(menu).getByRole("menuitem", { name: /plan/ }));

    expect(textarea.value).toBe("/plan ");
  });

  it("closes on Escape until the text changes, and Enter then sends", () => {
    const { textarea, onSend } = setup();
    fireEvent.change(textarea, { target: { value: "/mo" } });

    fireEvent.keyDown(textarea, { key: "Escape" });
    const afterEscape = screen.queryByRole("menu", { name: "Slash commands" });
    fireEvent.keyDown(textarea, { key: "Enter" });
    const sent = [...onSend.mock.calls];
    fireEvent.change(textarea, { target: { value: "/pl" } });

    expect({
      afterEscape,
      sent,
      reopened: rows(),
    }).toStrictEqual({
      afterEscape: null,
      sent: [["/mo", {}]],
      reopened: [{ name: "plan", highlighted: true }],
    });
  });
});
