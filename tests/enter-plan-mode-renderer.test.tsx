// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { EnterPlanModeRenderer } from "../src/components/tool-renderers/enter-plan-mode-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

afterEach(cleanup);

const INSTRUCTION_RESULT =
  "Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.\n\nIn plan mode, you should:\n1. Thoroughly explore the codebase to understand existing patterns\n2. Identify similar features and architectural approaches\n\nRemember: DO NOT write or edit any files yet.";

function makeCall(overrides: Partial<ClientToolCall> = {}): ClientToolCall {
  return {
    id: "tool-epm-1",
    name: "EnterPlanMode",
    param: "",
    sourceUuid: "uuid-1",
    input: {},
    ...overrides,
  };
}

describe("EnterPlanModeRenderer", () => {
  it("renders nothing for the model-only plan mode instruction block", () => {
    const { container } = render(
      <EnterPlanModeRenderer toolCall={makeCall({ result: INSTRUCTION_RESULT })} />,
    );

    expect(container.innerHTML).toStrictEqual("");
  });

  it("renders nothing when the call has no result or a bare success", () => {
    const empty = render(<EnterPlanModeRenderer toolCall={makeCall()} />);
    const success = render(<EnterPlanModeRenderer toolCall={makeCall({ result: "success" })} />);

    expect({
      empty: empty.container.innerHTML,
      success: success.container.innerHTML,
    }).toStrictEqual({ empty: "", success: "" });
  });

  it("renders a genuine tool error verbatim", () => {
    const { container } = render(
      <EnterPlanModeRenderer
        toolCall={makeCall({ result: "You are already in plan mode.", isError: true })}
      />,
    );

    expect({
      text: container.textContent,
      errorClass: container.querySelector(".text-extended-pink")?.textContent,
    }).toStrictEqual({
      text: "You are already in plan mode.",
      errorClass: "You are already in plan mode.",
    });
  });

  it("keeps an unrecognized non-error result rather than swallowing it", () => {
    const { container } = render(
      <EnterPlanModeRenderer toolCall={makeCall({ result: "Plan mode is disabled by policy." })} />,
    );

    expect(container.textContent).toStrictEqual("Plan mode is disabled by policy.");
  });
});
