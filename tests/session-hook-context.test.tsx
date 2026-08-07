// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { SessionHookContext } from "../src/components/session-hook-context";

describe("SessionHookContext", () => {
  it("renders turn settings and paused background work", () => {
    const { getByRole } = render(
      <SessionHookContext
        context={{
          sessionId: "session-test-100",
          promptId: "prompt-test-100",
          permissionMode: "auto",
          effortLevel: "high",
          backgroundTasks: [
            {
              id: "task-test-100",
              type: "agent",
              status: "running",
              description: "Inspect the example project",
            },
          ],
          sessionCrons: [
            {
              id: "cron-test-100",
              schedule: "0 * * * *",
              recurring: true,
              prompt: "Check the example service",
            },
          ],
        }}
      />,
    );

    expect(getByRole("region", { name: "Live hook context" }).textContent).toBe(
      "PermissionautoEfforthighPromptprompt-tPaused with 1 background taskrunningInspect the example projectPaused until 1 scheduled wakeup0 * * * *Check the example servicerecurring",
    );
  });
});
