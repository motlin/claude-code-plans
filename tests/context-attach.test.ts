import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  attachContext,
  composePrompt,
  ContextAttachmentKindSchema,
  contextChipLabel,
  formatAttachContext,
  formatContextAttachment,
  getContextChips,
  registerComposer,
  removeContextChip,
  takeContextChips,
  formatReviewComment,
  formatReviewComments,
} from "../src/lib/context-attach";
import { schemaChoiceRegistry } from "../src/lib/schema-choices";

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
      withPrompt: composePrompt("Please address these", [], comments),
      alone: composePrompt("", [], comments),
      none: composePrompt("Just a prompt", [], []),
    }).toStrictEqual({
      withPrompt: "src/greet.ts:3 — Use a constant\n\nPlease address these",
      alone: "src/greet.ts:3 — Use a constant",
      none: "Just a prompt",
    });
  });
});

describe("context attachments", () => {
  it("formats each kind as a mention, a fenced excerpt, or both", () => {
    expect({
      file: formatContextAttachment({ kind: "file", path: "src/greet.ts" }),
      folder: formatContextAttachment({ kind: "file", path: "src/" }),
      selection: formatContextAttachment({
        kind: "selection",
        path: "src/greet.ts",
        range: { start: 2, end: 3 },
        text: "const alice = 1;\nconst bob = 2;",
        language: "typescript",
      }),
      unnumbered: formatContextAttachment({
        kind: "selection",
        path: "README.md",
        text: "Hello",
        language: null,
      }),
      terminal: formatContextAttachment({ kind: "terminal", text: "$ echo ```\n```" }),
    }).toStrictEqual({
      file: "@src/greet.ts",
      folder: "@src/",
      selection: "@src/greet.ts#L2-3\n```typescript\nconst alice = 1;\nconst bob = 2;\n```",
      unnumbered: "@README.md\n```\nHello\n```",
      terminal: "````\n$ echo ```\n```\n````",
    });
  });

  it("labels each chip by file name, line range, or terminal", () => {
    expect([
      contextChipLabel({ kind: "file", path: "src/greet.ts" }),
      contextChipLabel({ kind: "file", path: "src/lib/" }),
      contextChipLabel({ kind: "selection", path: "src/greet.ts", range: { start: 4, end: 4 } }),
      contextChipLabel({ kind: "selection", path: "src/greet.ts", range: { start: 2, end: 5 } }),
      contextChipLabel({ kind: "selection", path: "README.md", text: "Hello" }),
      contextChipLabel({ kind: "terminal", text: "$ ls" }),
    ]).toStrictEqual([
      "greet.ts",
      "lib/",
      "greet.ts:4",
      "greet.ts:2-5",
      "README.md",
      "Terminal output",
    ]);
  });

  it("serializes context, then review comments, then the prompt", () => {
    const context = [
      { kind: "file", path: "src/alice.ts" },
      { kind: "terminal", text: "bob" },
    ] as const;
    const comments = [{ path: "src/greet.ts", line: 3, text: "Use a constant" }];
    expect({
      all: composePrompt("Please look", context, comments),
      contextOnly: composePrompt("", context, []),
      none: composePrompt("Just a prompt", [], []),
    }).toStrictEqual({
      all: "@src/alice.ts\n\n```\nbob\n```\n\nsrc/greet.ts:3 — Use a constant\n\nPlease look",
      contextOnly: "@src/alice.ts\n\n```\nbob\n```",
      none: "Just a prompt",
    });
  });
});

describe("attachContext", () => {
  const SESSION = "carol-session";
  afterEach(() => {
    takeContextChips(SESSION);
  });

  it("adds nothing when no composer is mounted for the session", () => {
    expect({
      delivered: attachContext(SESSION, { kind: "file", path: "a.ts" }),
      chips: getContextChips(SESSION),
    }).toStrictEqual({ delivered: false, chips: [] });
  });

  it("queues chips in attach order, removes one, and empties on take", () => {
    const focused: string[] = [];
    const stop = registerComposer(SESSION, {
      insertText: () => {},
      focus: () => focused.push("focus"),
    });
    const delivered = [
      attachContext(SESSION, { kind: "file", path: "alice.ts" }),
      attachContext(SESSION, { kind: "terminal", text: "bob" }),
      attachContext(SESSION, { kind: "file", path: "carol.ts" }),
    ];
    const [, middle] = getContextChips(SESSION);
    if (middle === undefined) throw new Error("no chip");
    removeContextChip(SESSION, middle.id);
    const afterRemove = getContextChips(SESSION).map(({ id: _id, ...rest }) => rest);
    const taken = takeContextChips(SESSION).map(({ id: _id, ...rest }) => rest);
    stop();

    expect({
      delivered,
      focused,
      afterRemove,
      taken,
      after: getContextChips(SESSION),
    }).toStrictEqual({
      delivered: [true, true, true],
      focused: ["focus", "focus", "focus"],
      afterRemove: [
        { kind: "file", path: "alice.ts" },
        { kind: "file", path: "carol.ts" },
      ],
      taken: [
        { kind: "file", path: "alice.ts" },
        { kind: "file", path: "carol.ts" },
      ],
      after: [],
    });
  });

  it("registers every kind in the schema choice registry", () => {
    expect({
      options: ContextAttachmentKindSchema.options,
      registry: schemaChoiceRegistry["ContextAttachmentKindSchema"],
    }).toStrictEqual({
      options: ["file", "selection", "terminal"],
      registry: { file: "File", selection: "Selection", terminal: "Terminal output" },
    });
  });
});
