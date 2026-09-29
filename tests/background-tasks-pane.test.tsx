// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { BackgroundTasksList } from "../src/components/panes/background-tasks-pane";
import type { BackgroundTask, BackgroundTaskGroups } from "../src/lib/background-tasks";

afterEach(cleanup);

function task(overrides: Partial<BackgroundTask> & Pick<BackgroundTask, "id">): BackgroundTask {
  return {
    toolUseId: null,
    kind: "bash",
    description: "",
    command: null,
    status: "running",
    output: null,
    summary: null,
    ...overrides,
  };
}

const GROUPS: BackgroundTaskGroups = {
  running: [
    task({ id: "bfab1serve", description: "Serve the fabricated app", command: "pnpm dev" }),
    task({ id: "afab1review", kind: "agent", description: "Review the fabricated diff" }),
  ],
  finished: [
    task({
      id: "bfab1build",
      description: "Build the fabricated app",
      command: "pnpm build",
      status: "completed",
      output: "built in 1.2s",
    }),
  ],
};

function sections() {
  return screen.getAllByRole("heading").map((heading) => heading.textContent);
}

function cards() {
  return [...document.querySelectorAll("button[data-background-task]")].map(
    (button) => button.textContent,
  );
}

describe("BackgroundTasksList", () => {
  it("groups running and finished cards with kind and status meta", () => {
    render(<BackgroundTasksList groups={GROUPS} />);

    expect({ sections: sections(), cards: cards() }).toStrictEqual({
      sections: ["2 running", "Finished 1"],
      cards: [
        "Serve the fabricated appBash · Running",
        "Review the fabricated diffAgent · Running",
        "Build the fabricated appBash · Completed",
      ],
    });
  });

  it("expands a card inline to its command and output", () => {
    render(<BackgroundTasksList groups={GROUPS} />);
    const card = screen.getByRole("button", { name: /Build the fabricated app/ });

    fireEvent.click(card);

    const details = document.getElementById(card.getAttribute("aria-controls") ?? "");
    expect({
      expanded: card.getAttribute("aria-expanded"),
      command: details === null ? null : within(details).getByText("pnpm build").tagName,
      output: details?.querySelector("[data-task-output]")?.textContent,
    }).toStrictEqual({ expanded: "true", command: "CODE", output: "built in 1.2s" });
  });

  it("collapses the finished section", () => {
    render(<BackgroundTasksList groups={GROUPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Finished 1" }));

    expect({
      toggle: screen.getByRole("button", { name: "Finished 1" }).getAttribute("aria-expanded"),
      finishedCard: screen.queryByRole("button", { name: /Build the fabricated app/ }),
    }).toStrictEqual({ toggle: "false", finishedCard: null });
  });

  it("Clear finished hides only the finished cards", () => {
    render(<BackgroundTasksList groups={GROUPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear finished" }));

    expect({
      sections: sections(),
      cards: cards(),
      clear: screen.queryByRole("button", { name: "Clear finished" }),
    }).toStrictEqual({
      sections: ["2 running"],
      cards: [
        "Serve the fabricated appBash · Running",
        "Review the fabricated diffAgent · Running",
      ],
      clear: null,
    });
  });

  it("shows empty copy when there is no background work", () => {
    render(<BackgroundTasksList groups={{ running: [], finished: [] }} />);

    expect(screen.getByText("No background tasks in this session.").tagName).toBe("P");
  });
});
