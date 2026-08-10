// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { HerdrStatusIndicator } from "../src/components/herdr-status-indicator";

afterEach(cleanup);

describe("HerdrStatusIndicator", () => {
  it("renders Herdr's canonical status labels and colors with an unknown fallback", () => {
    render(
      <div>
        {["blocked", "working", "done", "idle", "future-test-status"].map((status) => (
          <HerdrStatusIndicator key={status} status={status} />
        ))}
      </div>,
    );

    expect(
      screen.getAllByLabelText(/^Herdr agent status:/).map((indicator) => ({
        colorClassName: indicator.firstElementChild?.className,
        label: indicator.textContent,
        screenReaderLabel: indicator.getAttribute("aria-label"),
      })),
    ).toStrictEqual([
      {
        colorClassName: "h-2.5 w-2.5 rounded-full bg-red-500",
        label: "blocked",
        screenReaderLabel: "Herdr agent status: blocked",
      },
      {
        colorClassName: "h-2.5 w-2.5 rounded-full bg-yellow-500",
        label: "working",
        screenReaderLabel: "Herdr agent status: working",
      },
      {
        colorClassName: "h-2.5 w-2.5 rounded-full bg-blue-500",
        label: "done",
        screenReaderLabel: "Herdr agent status: done",
      },
      {
        colorClassName: "h-2.5 w-2.5 rounded-full bg-green-500",
        label: "idle",
        screenReaderLabel: "Herdr agent status: idle",
      },
      {
        colorClassName: "h-2.5 w-2.5 rounded-full bg-gray-500",
        label: "unknown",
        screenReaderLabel: "Herdr agent status: unknown",
      },
    ]);
  });
});
