// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { SessionReviewedToggle } from "../src/components/session-reviewed-toggle";

function ReviewedToggleHarness() {
  const [reviewed, setReviewed] = useState(false);

  return (
    <SessionReviewedToggle
      reviewed={reviewed}
      onToggle={async () => setReviewed((current) => !current)}
    />
  );
}

describe("SessionReviewedToggle", () => {
  it("toggles between reviewed and unreviewed", async () => {
    render(<ReviewedToggleHarness />);

    fireEvent.click(screen.getByTitle("Mark reviewed"));
    await waitFor(() => expect(screen.getByTitle("Mark unreviewed").title).toBe("Mark unreviewed"));

    fireEvent.click(screen.getByTitle("Mark unreviewed"));
    await waitFor(() => expect(screen.getByTitle("Mark reviewed").title).toBe("Mark reviewed"));
  });

  it("shows visible feedback without an unhandled rejection when toggling fails", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandledRejections.push(reason);
    const onToggle = vi.fn(async () => undefined);
    onToggle.mockRejectedValueOnce(new Error("fabricated toggle failure"));
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      render(<SessionReviewedToggle reviewed={false} onToggle={onToggle} />);

      fireEvent.click(screen.getByTitle("Mark reviewed"));
      await waitFor(() =>
        expect(screen.getByTitle("Failed to mark reviewed").className).toBe(
          "shrink-0 cursor-pointer text-danger-000 transition-colors hover:text-primary",
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));

      fireEvent.click(screen.getByTitle("Failed to mark reviewed"));
      await waitFor(() => expect(screen.getByTitle("Mark reviewed").title).toBe("Mark reviewed"));

      expect({ unhandledRejections, toggleCalls: onToggle.mock.calls }).toStrictEqual({
        unhandledRejections: [],
        toggleCalls: [[], []],
      });
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }
  });
});
