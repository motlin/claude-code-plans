// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { ExitPlanModeRenderer } from "../src/components/tool-renderers/exit-plan-mode-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

afterEach(cleanup);

const APPROVED_RESULT =
  "User has approved your plan. You can now start coding. Start with updating your todo list if applicable\n\nYour plan has been saved to: /Users/craig/.claude/plans/switch-git-pager.md\nYou can refer back to it if needed during implementation.";

const REJECTED_RESULT =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nalso plan on working in a new worktree";

function makeToolCall(overrides: Partial<ClientToolCall>): ClientToolCall {
  return {
    id: "tool-epm-1",
    name: "ExitPlanMode",
    param: "",
    sourceUuid: "uuid-1",
    input: {},
    ...overrides,
  };
}

async function renderRenderer(toolCall: ClientToolCall) {
  const rootRoute = createRootRoute({
    component: () => <ExitPlanModeRenderer toolCall={toolCall} />,
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}

describe("ExitPlanModeRenderer", () => {
  it("renders the plan body as markdown instead of the model-directed result text", async () => {
    const view = await renderRenderer(
      makeToolCall({
        input: {
          plan: "# Switch git pager\n\n## Context\n\nUse hunk instead of delta.",
          planFilePath: "/Users/craig/.claude/plans/switch-git-pager.md",
        },
        result: APPROVED_RESULT,
      }),
    );

    expect({
      heading: view.container.querySelector("h1")?.textContent,
      subheading: view.container.querySelector("h2")?.textContent,
      body: view.container.querySelector("p")?.textContent,
      showsBoilerplate: view.container.textContent?.includes("You can now start coding") ?? false,
    }).toStrictEqual({
      heading: "Switch git pager",
      subheading: "Context",
      body: "Use hunk instead of delta.",
      showsBoilerplate: false,
    });
  });

  it("lists allowed prompts as tool/prompt lines", async () => {
    const view = await renderRenderer(
      makeToolCall({
        input: {
          plan: "Do the thing.",
          allowedPrompts: [
            { tool: "Bash", prompt: "stage and commit git changes" },
            { tool: "Bash", prompt: "run just precommit" },
          ],
        },
        result: APPROVED_RESULT,
      }),
    );

    const lines = [...view.container.querySelectorAll("[data-allowed-prompt]")].map(
      (el) => el.textContent,
    );
    expect(lines).toStrictEqual([
      "Bash — stage and commit git changes",
      "Bash — run just precommit",
    ]);
  });

  it("shows a one-line approved status", async () => {
    await renderRenderer(makeToolCall({ input: { plan: "Do it." }, result: APPROVED_RESULT }));
    expect(screen.getByText("Plan approved").textContent).toStrictEqual("Plan approved");
  });

  it("shows a rejected status plus the user's own words", async () => {
    const view = await renderRenderer(
      makeToolCall({ input: { plan: "Do it." }, result: REJECTED_RESULT, isError: true }),
    );

    expect({
      status: screen.getByText("Plan rejected").textContent,
      detail: screen.getByText("also plan on working in a new worktree").textContent,
      showsBoilerplate: view.container.textContent?.includes("STOP what you are doing") ?? false,
    }).toStrictEqual({
      status: "Plan rejected",
      detail: "also plan on working in a new worktree",
      showsBoilerplate: false,
    });
  });

  it("links to the saved plan file", async () => {
    await renderRenderer(
      makeToolCall({
        input: {
          plan: "Do it.",
          planFilePath: "/Users/craig/.claude/plans/switch-git-pager.md",
        },
        result: APPROVED_RESULT,
      }),
    );

    expect(screen.getByRole("link").getAttribute("href")).toStrictEqual("/plan/switch-git-pager");
  });

  it("renders a genuine tool error verbatim", async () => {
    await renderRenderer(
      makeToolCall({
        input: { plan: "Do it." },
        result: "You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first.",
        isError: true,
      }),
    );

    expect(
      screen.getByText(
        "You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first.",
      ).textContent,
    ).toStrictEqual(
      "You are not in plan mode. To enter plan mode, call the EnterPlanMode tool first.",
    );
  });
});
