// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { ProjectCardCounts } from "../src/routes/projects";

const baseProject = {
  activeCount: 0,
  sessionCount: 1,
  planCount: 1,
  memoryCount: 1,
  taskCount: 1,
  lastActivity: "2026-08-05T00:00:00.000Z",
};

describe("ProjectCardCounts", () => {
  it("renders singular labels when every count is 1", () => {
    const view = render(<ProjectCardCounts project={{ ...baseProject, activeCount: 1 }} />);
    const text = view.container.textContent!;

    expect(text).toContain("1 active");
    expect(text).toContain("1 session");
    expect(text).toContain("1 plan");
    expect(text).toContain("1 memory");
    expect(text).toContain("1 task");

    expect(text).not.toContain("1 sessions");
    expect(text).not.toContain("1 plans");
    expect(text).not.toContain("1 memories");
    expect(text).not.toContain("1 tasks");
  });

  it("renders plural labels for counts above 1", () => {
    const view = render(
      <ProjectCardCounts
        project={{
          ...baseProject,
          activeCount: 2,
          sessionCount: 3,
          planCount: 4,
          memoryCount: 5,
          taskCount: 6,
        }}
      />,
    );
    const text = view.container.textContent!;

    expect(text).toContain("2 active");
    expect(text).toContain("3 sessions");
    expect(text).toContain("4 plans");
    expect(text).toContain("5 memories");
    expect(text).toContain("6 tasks");
  });

  it("omits zero counts except sessions", () => {
    const view = render(
      <ProjectCardCounts
        project={{ ...baseProject, sessionCount: 0, planCount: 0, memoryCount: 0, taskCount: 0 }}
      />,
    );
    const text = view.container.textContent!;

    expect(text).toContain("0 sessions");
    expect(text).not.toContain("active");
    expect(text).not.toContain("plan");
    expect(text).not.toContain("memor");
    expect(text).not.toContain("task");
  });
});
