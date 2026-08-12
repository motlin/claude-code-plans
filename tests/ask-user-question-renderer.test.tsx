// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { AskUserQuestionRenderer } from "../src/components/tool-renderers/ask-user-question-renderer";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

afterEach(cleanup);

const REJECTION_RESULT =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

const REJECTION_WITH_FEEDBACK_RESULT =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nJust pick one and keep going.";

const TIMEOUT_RESULT =
  "No response after 60s — the user may be away from keyboard. Proceed using your best judgment based on the context so far; you can re-ask this question later if it's still relevant.";

const ANSWERED_RESULT =
  'Your questions have been answered: "Which test runner?"="Vitest". You can now continue with these answers in mind.';

function makeCall(overrides: Partial<ClientToolCall> = {}): ClientToolCall {
  return {
    id: "tool-auq-1",
    name: "AskUserQuestion",
    param: "",
    sourceUuid: "uuid-1",
    input: {
      question: "Which test runner?",
      options: [
        { label: "Vitest", description: "Vite-native" },
        { label: "Jest", description: "Widely adopted" },
      ],
    },
    ...overrides,
  };
}

describe("AskUserQuestionRenderer", () => {
  it("draws exactly one card shell, using upstream's list-in-card idiom", () => {
    const { container } = render(<AskUserQuestionRenderer toolCall={makeCall()} />);

    const shells = container.querySelectorAll(".card-outline");
    const shell = shells[0]!;

    expect({
      shellCount: shells.length,
      isRoot: shell === container.firstElementChild,
      radius: shell.classList.contains("rounded-r6"),
      clips: shell.classList.contains("overflow-clip"),
      divided: shell.classList.contains("divide-y") && shell.classList.contains("divide-t3"),
      rowPadding:
        shell.classList.contains("[&>*]:px-p7") && shell.classList.contains("[&>*]:py-p6"),
    }).toStrictEqual({
      shellCount: 1,
      isRoot: true,
      radius: true,
      clips: true,
      divided: true,
      rowPadding: true,
    });
  });

  it("gives the option rows content height instead of a fixed 3.5rem", () => {
    const { container } = render(<AskUserQuestionRenderer toolCall={makeCall()} />);

    expect(container.querySelectorAll(".h-\\[3\\.5rem\\]").length).toStrictEqual(0);
  });

  it("renders the answered option list as direct children of the card", () => {
    const { container } = render(
      <AskUserQuestionRenderer toolCall={makeCall({ result: ANSWERED_RESULT })} />,
    );

    const shell = container.firstElementChild!;
    const labels = [...shell.children].map((child) => child.textContent?.trim());

    expect(labels).toStrictEqual([
      "Which test runner?",
      "1VitestVite-native",
      "2JestWidely adopted",
    ]);
  });

  it("shows a pink status line when the user dismissed the question", () => {
    const { container } = render(
      <AskUserQuestionRenderer toolCall={makeCall({ result: REJECTION_RESULT, isError: true })} />,
    );

    expect({
      status: container.querySelector(".text-extended-pink")?.textContent,
      rawBoilerplate: container.textContent?.includes("STOP what you are doing"),
    }).toStrictEqual({ status: "Question dismissed", rawBoilerplate: false });
  });

  it("keeps the user's own words when they dismissed the question with feedback", () => {
    const { container } = render(
      <AskUserQuestionRenderer
        toolCall={makeCall({ result: REJECTION_WITH_FEEDBACK_RESULT, isError: true })}
      />,
    );

    expect(container.querySelector(".text-extended-pink")?.textContent).toStrictEqual(
      "Question dismissedJust pick one and keep going.",
    );
  });

  it("shows a pink status line for the 60s no-response timeout", () => {
    const { container } = render(
      <AskUserQuestionRenderer toolCall={makeCall({ result: TIMEOUT_RESULT })} />,
    );

    expect({
      status: container.querySelector(".text-extended-pink")?.textContent,
      rawBoilerplate: container.textContent?.includes("best judgment"),
    }).toStrictEqual({ status: "No response after 60s", rawBoilerplate: false });
  });

  it("still falls back to the raw result for an unrecognized envelope", () => {
    const { container } = render(
      <AskUserQuestionRenderer toolCall={makeCall({ result: "Something else entirely." })} />,
    );

    expect({
      pink: container.querySelector(".text-extended-pink"),
      text: container.textContent?.includes("Something else entirely."),
    }).toStrictEqual({ pink: null, text: true });
  });
});
