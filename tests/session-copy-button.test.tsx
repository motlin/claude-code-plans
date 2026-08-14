// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { CopyButton } from "../src/components/session-page";
import { writeClipboardText } from "../src/lib/clipboard";

vi.mock("../src/lib/clipboard", () => ({
  writeClipboardText: vi.fn(),
}));

vi.mock("../src/components/session-chat", () => ({
  SessionChat: () => null,
}));

describe("session CopyButton", () => {
  it("keeps the confirmation hidden when copying fails", async () => {
    const mockedWriteClipboardText = vi.mocked(writeClipboardText);
    mockedWriteClipboardText.mockResolvedValue(false);

    function TestIcon({ className }: { className?: string }) {
      return <svg className={className} />;
    }

    render(<CopyButton title="Copy example" text="example text" icon={TestIcon} />);

    fireEvent.click(screen.getByTitle("Copy example"));

    await waitFor(() => {
      expect(mockedWriteClipboardText.mock.calls).toStrictEqual([["example text"]]);
    });
    expect(screen.getByText("Copied!").className).toBe(
      "absolute -bottom-6 left-1/2 -translate-x-1/2 rounded bg-surface-0 px-1.5 py-0.5 text-[10px] text-secondary shadow-sm transition-opacity whitespace-nowrap opacity-0 pointer-events-none",
    );
  });
});
