// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { Composer } from "../src/components/composer";

afterEach(() => {
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
      afterEnter: { calls: [["Continue Bob's test"]], value: "" },
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
});
