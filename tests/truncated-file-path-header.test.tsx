// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ReadRenderer } from "../src/components/tool-renderers/read-renderer";
import { WriteRenderer } from "../src/components/tool-renderers/write-renderer";
import { EditRenderer } from "../src/components/tool-renderers/edit-renderer";
import { TruncatedFilePathHeader } from "../src/components/tool-renderers/shared";
import type { ClientToolCall } from "../src/components/tool-renderers/types";

vi.mock("@git-diff-view/react", () => ({
  DiffModeEnum: { Unified: 4 },
  DiffView: () => <div data-testid="diff-view" />,
}));

vi.mock("../src/lib/diff-highlighter", () => ({
  resolveDiffLanguage: () => "typescript",
  useShikiDiffHighlighter: () => undefined,
}));

vi.mock("../src/hooks/use-shiki", () => ({ useHighlightedLines: () => null }));

afterEach(cleanup);

const FILE_PATH =
  "/Users/craig/projects/claude-code-plans/src/components/tool-renderers/shared.tsx";

interface HeaderMarkup {
  wrapperClass: string;
  prefixClass: string;
  prefixText: string;
  suffixClass: string;
  suffixText: string;
}

function headerMarkup(container: HTMLElement): HeaderMarkup {
  const wrapper = container.querySelector<HTMLElement>(`[title="${FILE_PATH}"]`);
  if (!wrapper) throw new Error("no file-path header found");
  const [prefix, suffix] = [...wrapper.children] as HTMLElement[];
  if (!prefix || !suffix) throw new Error("header is not a prefix/suffix pair");
  return {
    wrapperClass: wrapper.className,
    prefixClass: prefix.className,
    prefixText: prefix.textContent ?? "",
    suffixClass: suffix.className,
    suffixText: suffix.textContent ?? "",
  };
}

const EXPECTED: HeaderMarkup = {
  wrapperClass: "flex flex-1 min-w-0 overflow-hidden whitespace-nowrap text-body text-secondary",
  prefixClass: "min-w-0 truncate",
  prefixText: "/Users/craig/projects/claude-code-plans/",
  suffixClass: "max-w-full shrink-0 truncate",
  suffixText: "src/components/tool-renderers/shared.tsx",
};

describe("TruncatedFilePathHeader", () => {
  it("makes both halves truncatable so a long final segment ellipsizes", () => {
    const { container } = render(<TruncatedFilePathHeader filePath={FILE_PATH} />);

    expect(headerMarkup(container)).toStrictEqual(EXPECTED);
  });

  it("keeps a slashless path whole in the truncatable suffix", () => {
    const { container } = render(<TruncatedFilePathHeader filePath="shared.tsx" />);
    const wrapper = container.querySelector<HTMLElement>('[title="shared.tsx"]');
    const [prefix, suffix] = [...(wrapper?.children ?? [])] as HTMLElement[];

    expect({ prefix: prefix?.textContent, suffix: suffix?.textContent }).toStrictEqual({
      prefix: "",
      suffix: "shared.tsx",
    });
  });
});

describe("file-path card headers", () => {
  it("Read uses the truncatable header", () => {
    const toolCall: ClientToolCall = {
      id: "tool-read-1",
      name: "Read",
      input: { file_path: FILE_PATH },
      param: FILE_PATH,
      result: "1→export function shared() {}",
      sourceUuid: "uuid-read-1",
    };

    expect(headerMarkup(render(<ReadRenderer toolCall={toolCall} />).container)).toStrictEqual(
      EXPECTED,
    );
  });

  it("Write uses the truncatable header", () => {
    const toolCall: ClientToolCall = {
      id: "tool-write-1",
      name: "Write",
      input: { file_path: FILE_PATH, content: "export function shared() {}\n" },
      param: FILE_PATH,
      result: "File created successfully",
      sourceUuid: "uuid-write-1",
    };

    expect(headerMarkup(render(<WriteRenderer toolCall={toolCall} />).container)).toStrictEqual(
      EXPECTED,
    );
  });

  it("Edit uses the truncatable header", () => {
    const toolCall: ClientToolCall = {
      id: "tool-edit-1",
      name: "Edit",
      input: { file_path: FILE_PATH, old_string: "const a = 1;", new_string: "const a = 2;" },
      param: FILE_PATH,
      result: "Applied 1 edit",
      sourceUuid: "uuid-edit-1",
    };

    expect(headerMarkup(render(<EditRenderer toolCall={toolCall} />).container)).toStrictEqual(
      EXPECTED,
    );
  });
});
