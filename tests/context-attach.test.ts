import { describe, expect, it } from "vite-plus/test";
import {
  formatAttachContext,
  formatReviewComment,
  formatReviewComments,
  prependReviewComments,
} from "../src/lib/context-attach";

describe("formatAttachContext", () => {
  it("formats a file, a line, a line range and a fenced selection", () => {
    expect({
      file: formatAttachContext({ path: "src/greet.ts" }),
      line: formatAttachContext({ path: "src/greet.ts", range: { start: 4, end: 4 } }),
      range: formatAttachContext({ path: "src/greet.ts", range: { start: 2, end: 5 } }),
      selection: formatAttachContext({
        path: "src/greet.ts",
        range: { start: 2, end: 3 },
        text: 'const greeting = "hello";\nreturn greeting;',
        language: "typescript",
      }),
    }).toStrictEqual({
      file: "@src/greet.ts",
      line: "@src/greet.ts#L4",
      range: "@src/greet.ts#L2-5",
      selection:
        '@src/greet.ts#L2-3\n```typescript\nconst greeting = "hello";\nreturn greeting;\n```',
    });
  });
});

describe("review comments", () => {
  it("formats a comment as a path:line block, with a line range when it spans lines", () => {
    expect({
      line: formatReviewComment({ path: "src/greet.ts", line: 3, text: "Use a constant" }),
      range: formatReviewComment({
        path: "src/greet.ts",
        line: 3,
        endLine: 5,
        text: "Extract this\ninto a helper",
      }),
    }).toStrictEqual({
      line: "src/greet.ts:3 — Use a constant",
      range: "src/greet.ts:3-5 — Extract this\ninto a helper",
    });
  });

  it("separates comment blocks with a blank line", () => {
    expect(
      formatReviewComments([
        { path: "src/greet.ts", line: 3, text: "Use a constant" },
        { path: "README.md", line: 1, endLine: 1, text: "Typo in the title" },
      ]),
    ).toBe("src/greet.ts:3 — Use a constant\n\nREADME.md:1 — Typo in the title");
  });

  it("prepends queued comments to the prompt, or sends them alone", () => {
    const comments = [{ path: "src/greet.ts", line: 3, text: "Use a constant" }];
    expect({
      withPrompt: prependReviewComments("Please address these", comments),
      alone: prependReviewComments("", comments),
      none: prependReviewComments("Just a prompt", []),
    }).toStrictEqual({
      withPrompt: "src/greet.ts:3 — Use a constant\n\nPlease address these",
      alone: "src/greet.ts:3 — Use a constant",
      none: "Just a prompt",
    });
  });
});
