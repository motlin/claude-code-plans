// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { StatusFooter } from "../src/components/status-footer";

function renderFooter(messageCount: number): string {
  const view = render(
    <StatusFooter
      data={{ cost: { total_duration_ms: 60_000 } }}
      gitBranch={null}
      gitSha={null}
      gitClean={null}
      messageCount={messageCount}
      pendingTaskCount={0}
    />,
  );
  return view.container.textContent ?? "";
}

describe("StatusFooter", () => {
  it("wraps status segments instead of scrolling them horizontally", () => {
    const view = render(
      <StatusFooter
        data={{ cost: { total_duration_ms: 60_000 } }}
        gitBranch={null}
        gitSha={null}
        gitClean={null}
        messageCount={0}
        pendingTaskCount={0}
      />,
    );

    expect(view.container.firstElementChild?.firstElementChild?.getAttribute("class")).toBe(
      "flex flex-wrap items-center gap-1.5 px-4 py-2",
    );
  });

  it("shows transcript messages next to the duration", () => {
    expect(renderFooter(2)).toBe("1m 0s · 2 msgs");
  });

  it("omits the message count when the session is empty", () => {
    expect(renderFooter(0)).toBe("1m 0s");
  });
});
