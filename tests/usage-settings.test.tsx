// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { UsagePanel } from "../src/components/settings/usage-settings";

const NOW_MS = Date.UTC(2026, 8, 28, 12, 0);
const NOW_SECONDS = NOW_MS / 1000;

afterEach(cleanup);

describe("UsagePanel", () => {
  it("renders the header, pace headline, meters and last-updated line", () => {
    const onRefresh = vi.fn();
    render(
      <UsagePanel
        usage={{
          fiveHour: { usedPct: 16.4, resetsAt: Date.UTC(2026, 8, 28, 15, 40) / 1000 },
          sevenDay: { usedPct: 66, resetsAt: NOW_SECONDS + 21 * 3_600 },
          updatedAt: new Date(NOW_MS - 5_000).toISOString(),
        }}
        planDetail="Max (20x)"
        nowMs={NOW_MS}
        timeZone="UTC"
        refreshing={false}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByRole("heading", { name: "Your usage" }).textContent).toBe("Your usage");
    expect(screen.getByText("Max (20x)").textContent).toBe("Max (20x)");
    expect(screen.getByTestId("usage-page-pace").textContent).toContain(
      "On track. You should reach tomorrow’s reset with room to spare.",
    );

    const meters = screen.getAllByRole("meter");
    expect(
      meters.map((meter) => ({
        name: meter.getAttribute("aria-labelledby")
          ? document.getElementById(meter.getAttribute("aria-labelledby") ?? "")?.textContent
          : null,
        min: meter.getAttribute("aria-valuemin"),
        max: meter.getAttribute("aria-valuemax"),
        now: meter.getAttribute("aria-valuenow"),
        text: meter.getAttribute("aria-valuetext"),
      })),
    ).toStrictEqual([
      { name: "Current session", min: "0", max: "100", now: "16", text: "16% used" },
      { name: "This week", min: "0", max: "100", now: "66", text: "66% used" },
    ]);
    expect(screen.getByText("Resets at 3:40 PM").textContent).toBe("Resets at 3:40 PM");
    expect(screen.getByText("Resets Tue 9:00 AM").textContent).toBe("Resets Tue 9:00 AM");
    expect(screen.getAllByText(/% used$/).map((node) => node.textContent)).toStrictEqual([
      "16% used",
      "66% used",
    ]);
    expect(screen.getByText("Last updated: just now").textContent).toBe("Last updated: just now");

    fireEvent.click(screen.getByRole("button", { name: "Refresh usage" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("clamps the meter to 0-100", () => {
    render(
      <UsagePanel
        usage={{
          fiveHour: { usedPct: 140, resetsAt: NOW_SECONDS + 60 },
          sevenDay: null,
          updatedAt: new Date(NOW_MS).toISOString(),
        }}
        nowMs={NOW_MS}
        timeZone="UTC"
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    const meter = screen.getByRole("meter");
    expect([
      meter.getAttribute("aria-valuenow"),
      meter.getAttribute("aria-valuetext"),
    ]).toStrictEqual(["100", "100% used"]);
  });

  it("shows the empty state when no session has reported rate limits", () => {
    render(
      <UsagePanel
        usage={{ fiveHour: null, sevenDay: null, updatedAt: null }}
        nowMs={NOW_MS}
        timeZone="UTC"
        refreshing={false}
        onRefresh={() => {}}
      />,
    );

    expect(screen.queryAllByRole("meter")).toStrictEqual([]);
    expect(
      screen.getByText("Usage appears after a Claude Code session reports its status line")
        .textContent,
    ).toBe("Usage appears after a Claude Code session reports its status line");
  });
});
