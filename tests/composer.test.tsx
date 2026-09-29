// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Composer } from "../src/components/composer";
import type { ComposerState } from "../src/lib/composer-state";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});

describe("Composer", () => {
  it("uses the upstream placeholder for each variant", () => {
    const { unmount } = render(
      <Composer variant="session" draftKey="session-alice" onSend={() => {}} />,
    );
    const session = screen.getByRole("textbox", { name: "Prompt" }).getAttribute("placeholder");
    unmount();
    render(<Composer variant="home" draftKey="home" onSend={() => {}} />);
    const home = screen.getByRole("textbox", { name: "Prompt" }).getAttribute("placeholder");

    expect({ session, home }).toStrictEqual({
      session: "Type / for commands",
      home: "Describe a task or ask a question",
    });
  });

  it("disables Send while the prompt is blank and enables it once text is typed", () => {
    render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
    const send = screen.getByRole<HTMLButtonElement>("button", { name: "Send" });
    const before = send.disabled;

    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "   " },
    });
    const whitespace = send.disabled;
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Continue Alice's test" },
    });

    expect({ before, whitespace, after: send.disabled }).toStrictEqual({
      before: true,
      whitespace: true,
      after: false,
    });
  });

  it("sends the trimmed prompt on Enter and keeps Shift+Enter for newlines", () => {
    const onSend = vi.fn<(prompt: string) => void>();
    render(<Composer variant="session" draftKey="session-alice" onSend={onSend} />);
    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Prompt" });

    fireEvent.change(textarea, { target: { value: "  Continue Bob's test  " } });
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    const afterShiftEnter = { calls: [...onSend.mock.calls], value: textarea.value };
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect({
      afterShiftEnter,
      afterEnter: { calls: onSend.mock.calls, value: textarea.value },
    }).toStrictEqual({
      afterShiftEnter: { calls: [], value: "  Continue Bob's test  " },
      afterEnter: { calls: [["Continue Bob's test", {}]], value: "" },
    });
  });

  it("does not send while disabled", () => {
    const onSend = vi.fn<(prompt: string) => void>();
    render(<Composer variant="session" draftKey="session-alice" onSend={onSend} disabled />);
    const textarea = screen.getByRole("textbox", { name: "Prompt" });

    fireEvent.change(textarea, { target: { value: "Continue Alice's test" } });
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(onSend.mock.calls).toStrictEqual([]);
  });

  it("grows with content up to the upstream max height", () => {
    render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
    const textarea = screen.getByRole("textbox", { name: "Prompt" });

    expect({
      maxHeight: textarea.style.maxHeight,
      minHeight: textarea.style.minHeight,
      rows: textarea.getAttribute("rows"),
    }).toStrictEqual({
      maxHeight: "min(24rem, 40svh)",
      minHeight: "24px",
      rows: "1",
    });
  });

  it("exposes the delivery hint as the Send button description", () => {
    render(
      <Composer
        variant="session"
        draftKey="session-alice"
        onSend={() => {}}
        deliveryHint="Sends to the live terminal"
      />,
    );
    const send = screen.getByRole("button", { name: "Send" });
    const describedBy = send.getAttribute("aria-describedby") ?? "";

    expect({
      description: describedBy
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    }).toStrictEqual({ description: "Sends to the live terminal" });
  });

  it("shows the Send ⏎ tooltip alongside the delivery hint", () => {
    vi.useFakeTimers();
    render(
      <Composer
        variant="session"
        draftKey="session-alice"
        onSend={() => {}}
        deliveryHint="Starts a forked session"
      />,
    );
    const send = screen.getByRole("button", { name: "Send" });

    fireEvent.pointerEnter(send);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const describedBy = send.getAttribute("aria-describedby") ?? "";

    expect({
      tooltip: screen.getByRole("tooltip").textContent,
      descriptionCount: describedBy.split(" ").length,
      hintKept: describedBy
        .split(" ")
        .some((id) => document.getElementById(id)?.textContent === "Starts a forked session"),
    }).toStrictEqual({ tooltip: "Send⏎", descriptionCount: 2, hintKept: true });
  });

  it("uses a 16px font on coarse pointers to avoid iOS zoom", () => {
    render(<Composer variant="home" draftKey="home" onSend={() => {}} />);

    expect(
      screen
        .getByRole("textbox", { name: "Prompt" })
        .className.split(" ")
        .filter((token) => token.startsWith("pointer-coarse:")),
    ).toStrictEqual(["pointer-coarse:text-[16px]"]);
  });

  it("swaps Send for Stop response while streaming", () => {
    const onCancel = vi.fn<() => void>();
    render(
      <Composer
        variant="session"
        draftKey="session-alice"
        onSend={() => {}}
        onCancel={onCancel}
        isStreaming
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop response" }));

    expect({
      cancels: onCancel.mock.calls.length,
      send: screen.queryByRole("button", { name: "Send" }),
    }).toStrictEqual({ cancels: 1, send: null });
  });

  describe("chin readouts", () => {
    const NOW_MS = Date.UTC(2026, 8, 29, 12, 0, 0);
    const CHIN: ComposerState = {
      mode: { id: "acceptEdits", label: "Accept edits" },
      model: "Opus 5.5",
      effort: { id: "xhigh", label: "Extra-high" },
      usage: {
        contextTokens: 190_200,
        contextWindowSize: 1_000_000,
        contextPercent: 19,
        fiveHour: { usedPercentage: 10, resetsAt: NOW_MS / 1000 + 4 * 3600 + 11 * 60 },
        weekly: { usedPercentage: 65, resetsAt: NOW_MS / 1000 + 14 * 3600 + 31 * 60 },
        updatedAt: new Date(NOW_MS - 3 * 3600 * 1000).toISOString(),
      },
    };

    it("shows +, mode, then model, effort and the usage ring left to right", () => {
      vi.useFakeTimers({ now: NOW_MS, toFake: ["Date"] });
      render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);
      const chin = document.querySelector('[data-cds="ChatComposerChin"]');
      const labels = Array.from(chin?.querySelectorAll("[aria-label], [data-chin-mode]") ?? []).map(
        (element) => element.getAttribute("aria-label") ?? element.textContent,
      );

      expect(labels).toStrictEqual([
        "Add",
        "Accept edits",
        "Model: Opus 5.5",
        "Effort: Extra-high",
        "Usage: Context 190.2k / 1M (19%), Weekly · all models: 65%, Resets in 14 hr 31 min",
      ]);
    });

    it("draws the ring arc from the context percentage", () => {
      render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);
      const arc = document.querySelector("[data-usage-ring-arc]");

      expect({
        dasharray: arc?.getAttribute("stroke-dasharray"),
        dashoffset: Number(arc?.getAttribute("stroke-dashoffset")).toFixed(4),
      }).toStrictEqual({ dasharray: "31.4159", dashoffset: (0.81 * 31.4159).toFixed(4) });
    });

    it("opens the usage popover with context, limits and the last update", async () => {
      vi.useFakeTimers({ now: NOW_MS, toFake: ["Date"] });
      render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);

      fireEvent.click(screen.getByRole("button", { name: /^Usage:/ }));
      const dialog = await screen.findByRole("dialog");
      const rows = Array.from(dialog.querySelectorAll("[data-usage-row]")).map((row) =>
        Array.from(row.children, (cell) => cell.textContent).join(" | "),
      );

      expect({
        context: dialog.querySelector("[data-usage-context]")?.textContent,
        updated: dialog.querySelector("[data-usage-updated]")?.textContent,
        rows,
        bars: Array.from(dialog.querySelectorAll('[role="progressbar"]')).map((bar) =>
          bar.getAttribute("aria-valuenow"),
        ),
      }).toStrictEqual({
        context: "Context window190.2k / 1M (19%)",
        updated: "Last updated 3 hours ago. Send a message to refresh.",
        rows: [
          "5-hour limit | Resets in 4 hr 11 min | 10%",
          "Weekly · all models | Resets in 14 hr 31 min | 65%",
        ],
        bars: ["19", "10", "65"],
      });
    });

    it("inserts a slash from the Add menu", async () => {
      render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} chin={CHIN} />);

      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: "Slash commands" }));

      expect(screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Prompt" }).value).toBe("/");
    });

    it("renders an empty chin without chin state", () => {
      render(<Composer variant="session" draftKey="session-alice" onSend={() => {}} />);
      expect(document.querySelector('[data-cds="ChatComposerChin"]')?.childElementCount).toBe(0);
    });
  });
});
