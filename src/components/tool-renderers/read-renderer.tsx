import { Fragment } from "react";
import type { ThemedToken } from "@shikijs/core";
import { extractLineNumbers, detectLanguage } from "../../lib/diff-utils";
import { useHighlightedLines } from "../../hooks/use-shiki";
import type { ToolRendererProps } from "./types";
import { CopyButton, TruncatedFilePathHeader } from "./shared";

interface ParsedLine {
  lineNum: string | null;
  content: string;
}

function parseLineNumbers(content: string): ParsedLine[] {
  const lines = content.split("\n");
  return lines.map((line) => {
    const match = line.match(/^\s*(\d+)[→\t](.*)/);
    if (match) {
      return {
        lineNum: match[1] ?? null,
        content: match[2] ?? "",
      };
    }
    return {
      lineNum: null,
      content: line,
    };
  });
}

function HighlightedLine({ tokens }: { tokens: ThemedToken[] }) {
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </>
  );
}

function PlainLine({ content }: { content: string }) {
  return <>{content}</>;
}

export function ReadRenderer({ toolCall }: ToolRendererProps) {
  const filePath = (toolCall.input["file_path"] as string) ?? "";
  const { result, isError } = toolCall;

  const code = result && !isError ? result : "";
  const parsedLines = code ? parseLineNumbers(code) : [];

  const { text: cleanCode } = code ? extractLineNumbers(code) : { text: "" };
  const language = detectLanguage(filePath);
  const tokens = useHighlightedLines(cleanCode, language);

  // A failed read has no file content to highlight -- upstream just prints the
  // failure message in the error color.
  if (isError) {
    return (
      <div className="px-p6 py-p5">
        <pre className="max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all text-extended-pink">
          {result}
        </pre>
      </div>
    );
  }

  return (
    <>
      {/* Header: smart-truncated file path + hover copy button */}
      <div className="flex items-center gap-g3 px-p6 py-p5">
        <TruncatedFilePathHeader filePath={filePath} />
        <CopyButton text={result ?? filePath} />
      </div>

      {/* Body: syntax-highlighted code on the card background, capped at 400px */}
      {result && (
        <pre className="m-0 max-h-[400px] overflow-y-auto font-mono text-code leading-code text-primary">
          <code className="grid py-1" style={{ gridTemplateColumns: "auto minmax(0, 1fr)" }}>
            {parsedLines.map((line, index) => (
              <Fragment key={index}>
                <div
                  data-gutter=""
                  className="min-h-[var(--upstream-leading-code)] select-none text-right text-secondary"
                  style={{ padding: "0 0.6em 0 1.2em" }}
                >
                  {line.lineNum || ""}
                </div>
                <div
                  data-content=""
                  className="min-h-[var(--upstream-leading-code)] min-w-0 whitespace-pre-wrap break-words"
                  style={{ padding: "0 0.6em" }}
                >
                  {tokens?.[index] ? (
                    <HighlightedLine tokens={tokens[index]} />
                  ) : (
                    <PlainLine content={line.content} />
                  )}
                </div>
              </Fragment>
            ))}
          </code>
        </pre>
      )}
    </>
  );
}
