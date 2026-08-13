import { describe, expect, it } from "vite-plus/test";
import { extractSessionLinks } from "../src/lib/session-links";
import type { SessionLine } from "../src/lib/transcript";

function userLine(text: string, lineIndex: number): SessionLine {
  return {
    type: "user",
    lineIndex,
    message: { role: "user", content: text },
  };
}

describe("extractSessionLinks", () => {
  it("extracts markdown before bare links, avoids double-counting, and keeps the first label", () => {
    const lines = [
      userLine(
        "First https://example.com/bare then [Example guide](https://example.com/guide).",
        100,
      ),
      userLine("[Later label](https://example.com/guide)", 200),
    ];

    expect(extractSessionLinks(lines, undefined, [])).toStrictEqual({
      groups: [
        {
          categoryId: "External",
          label: "External",
          entries: [
            {
              url: "https://example.com/guide",
              label: "Example guide",
              categoryId: "External",
              occurrences: [
                { source: "visible", anchorIndex: 100, role: "user" },
                { source: "visible", anchorIndex: 200, role: "user" },
              ],
            },
            {
              url: "https://example.com/bare",
              label: "example.com/bare",
              categoryId: "External",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
      ],
      totalCount: 2,
    });
  });

  it("stops tool-input URLs at JSON-escaped newlines", () => {
    const lines = [
      {
        type: "assistant",
        lineIndex: 100,
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tool-use-bash-example",
              name: "Bash",
              input: {
                command: "open https://example.com/first\nopen https://example.com/second",
              },
            },
          ],
        },
      },
    ] satisfies SessionLine[];

    expect(extractSessionLinks(lines, undefined, [])).toStrictEqual({
      groups: [
        {
          categoryId: "External",
          label: "External",
          entries: [
            {
              url: "https://example.com/first",
              label: "example.com/first",
              categoryId: "External",
              occurrences: [
                {
                  source: "tool",
                  anchorIndex: 100,
                  role: "assistant",
                  tool: "Bash",
                },
              ],
            },
            {
              url: "https://example.com/second",
              label: "example.com/second",
              categoryId: "External",
              occurrences: [
                {
                  source: "tool",
                  anchorIndex: 100,
                  role: "assistant",
                  tool: "Bash",
                },
              ],
            },
          ],
        },
      ],
      totalCount: 2,
    });
  });

  it("trims sentence punctuation and an unbalanced closing parenthesis", () => {
    const lines = [userLine("See (https://example.com/example).", 100)];

    expect(extractSessionLinks(lines, undefined, [])).toStrictEqual({
      groups: [
        {
          categoryId: "External",
          label: "External",
          entries: [
            {
              url: "https://example.com/example",
              label: "example.com/example",
              categoryId: "External",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
      ],
      totalCount: 1,
    });
  });

  it("preserves distinct query and fragment variants", () => {
    const lines = [
      userLine(
        "https://example.com/code?line=100#alice https://example.com/code?line=100#bob https://example.com/code?line=200#alice",
        100,
      ),
    ];

    expect(extractSessionLinks(lines, undefined, [])).toStrictEqual({
      groups: [
        {
          categoryId: "External",
          label: "External",
          entries: [
            {
              url: "https://example.com/code?line=100#alice",
              label: "example.com/code?line=100#alice",
              categoryId: "External",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
            {
              url: "https://example.com/code?line=100#bob",
              label: "example.com/code?line=100#bob",
              categoryId: "External",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
            {
              url: "https://example.com/code?line=200#alice",
              label: "example.com/code?line=200#alice",
              categoryId: "External",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
      ],
      totalCount: 3,
    });
  });

  it("strips tracking parameters before deduplication and appends every occurrence", () => {
    const lines = [
      userLine(
        "https://example.com/article?topic=fake&utm_source=alice#section https://example.com/article?topic=fake#section",
        100,
      ),
    ];

    expect(extractSessionLinks(lines, undefined, [])).toStrictEqual({
      groups: [
        {
          categoryId: "External",
          label: "External",
          entries: [
            {
              url: "https://example.com/article?topic=fake#section",
              label: "example.com/article?topic=fake#section",
              categoryId: "External",
              occurrences: [
                { source: "visible", anchorIndex: 100, role: "user" },
                { source: "visible", anchorIndex: 100, role: "user" },
              ],
            },
          ],
        },
      ],
      totalCount: 1,
    });
  });

  it("applies MyHost before built-ins and user rules in declared order", () => {
    const lines = [
      userLine(
        "https://internal.example.com/alice https://docs.example.com/bob https://outside.example.net/charlie",
        100,
      ),
    ];
    const userRules = [
      { label: "Company", hostPattern: "*.example.com" },
      { label: "Documentation", hostPattern: "docs.*" },
    ];

    expect(extractSessionLinks(lines, "internal.example.com", userRules)).toStrictEqual({
      groups: [
        {
          categoryId: "MyHost",
          label: "My Host",
          entries: [
            {
              url: "https://internal.example.com/alice",
              label: "internal.example.com/alice",
              categoryId: "MyHost",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
        {
          categoryId: "Company",
          label: "Company",
          entries: [
            {
              url: "https://docs.example.com/bob",
              label: "docs.example.com/bob",
              categoryId: "Company",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
        {
          categoryId: "External",
          label: "External",
          entries: [
            {
              url: "https://outside.example.net/charlie",
              label: "outside.example.net/charlie",
              categoryId: "External",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
      ],
      totalCount: 3,
    });
  });

  it("groups built-in services and selects compact issue and GitHub labels", () => {
    const lines = [
      userLine(
        [
          "https://github.com/alice/example/pull/100",
          "https://jira.example.com/browse/FAKE-200",
          "https://docs.google.com/document/d/fake-document",
          "https://docs.google.com/spreadsheets/d/fake-sheet",
          "https://docs.google.com/presentation/d/fake-slides",
        ].join(" "),
        100,
      ),
    ];

    expect(
      extractSessionLinks(lines, undefined, [{ label: "Catch All", hostPattern: "*" }]),
    ).toStrictEqual({
      groups: [
        {
          categoryId: "GitHub",
          label: "GitHub",
          entries: [
            {
              url: "https://github.com/alice/example/pull/100",
              label: "alice/example#100",
              categoryId: "GitHub",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
        {
          categoryId: "IssueTracker",
          label: "Issue Tracker",
          entries: [
            {
              url: "https://jira.example.com/browse/FAKE-200",
              label: "FAKE-200",
              categoryId: "IssueTracker",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
        {
          categoryId: "GoogleDocs",
          label: "Google Docs",
          entries: [
            {
              url: "https://docs.google.com/document/d/fake-document",
              label: "docs.google.com/document/d/fake-document",
              categoryId: "GoogleDocs",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
        {
          categoryId: "GoogleSheets",
          label: "Google Sheets",
          entries: [
            {
              url: "https://docs.google.com/spreadsheets/d/fake-sheet",
              label: "docs.google.com/spreadsheets/d/fake-sheet",
              categoryId: "GoogleSheets",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
        {
          categoryId: "GoogleSlides",
          label: "Google Slides",
          entries: [
            {
              url: "https://docs.google.com/presentation/d/fake-slides",
              label: "docs.google.com/presentation/d/fake-slides",
              categoryId: "GoogleSlides",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
      ],
      totalCount: 5,
    });
  });

  it("falls malformed parsed URLs through to External", () => {
    const lines = [userLine("[Malformed example](https://%)", 100)];

    expect(extractSessionLinks(lines, undefined, [])).toStrictEqual({
      groups: [
        {
          categoryId: "External",
          label: "External",
          entries: [
            {
              url: "https://%",
              label: "Malformed example",
              categoryId: "External",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
      ],
      totalCount: 1,
    });
  });

  it("ignores schemeless hosts, mail addresses, and relative paths", () => {
    const lines = [
      userLine("example.com mailto:alice@example.com /example/path https://example.com/kept", 100),
    ];

    expect(extractSessionLinks(lines, undefined, [])).toStrictEqual({
      groups: [
        {
          categoryId: "External",
          label: "External",
          entries: [
            {
              url: "https://example.com/kept",
              label: "example.com/kept",
              categoryId: "External",
              occurrences: [{ source: "visible", anchorIndex: 100, role: "user" }],
            },
          ],
        },
      ],
      totalCount: 1,
    });
  });
});
