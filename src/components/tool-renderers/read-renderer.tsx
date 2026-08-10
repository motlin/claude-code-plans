import type { ThemedToken } from "@shikijs/core";
import { extractLineNumbers, detectLanguage } from "../../lib/diff-utils";
import { useHighlightedLines } from "../../hooks/use-shiki";
import type { ToolRendererProps } from "./types";
import { CopyButton, ErrorBorder, ExpandableBlock } from "./shared";

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

/**
 * Split a file path into a truncatable prefix and a non-truncatable suffix.
 * The suffix always includes the filename and enough parent directories
 * to land near the midpoint of the full path on a `/` boundary.
 */
function splitPath(filePath: string): { prefix: string; suffix: string } {
  const lastSlash = filePath.lastIndexOf("/");
  if (lastSlash === -1) return { prefix: "", suffix: filePath };

  const midpoint = Math.floor(filePath.length / 2);
  let splitIndex = -1;

  for (let i = midpoint; i >= 0; i--) {
    if (filePath[i] === "/") {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex <= 0) {
    return { prefix: "", suffix: filePath };
  }

  return {
    prefix: filePath.slice(0, splitIndex + 1),
    suffix: filePath.slice(splitIndex + 1),
  };
}

export function ReadRenderer({ toolCall }: ToolRendererProps) {
  const filePath = (toolCall.input["file_path"] as string) ?? "";
  const { result, isError } = toolCall;
  const lineCount = result ? result.split("\n").length : 0;

  const parsedLines = result ? parseLineNumbers(result) : [];

  const { text: cleanCode } = result ? extractLineNumbers(result) : { text: "" };
  const language = detectLanguage(filePath);
  const tokens = useHighlightedLines(cleanCode, language, true);
  const { prefix, suffix } = splitPath(filePath);

  return (
    <ErrorBorder isError={isError}>
      {/* Header: smart-truncated file path + hover copy button */}
      <div className="flex items-center gap-g3 px-p6 py-p5">
        <span className="flex flex-1 min-w-0 text-body text-assistant-secondary">
          <span className="contents" title={filePath}>
            <span className="truncate">{prefix}</span>
            <span className="shrink-0">{suffix}</span>
          </span>
        </span>
        <CopyButton text={result ?? filePath} />
      </div>

      {/* Body: syntax-highlighted code with dark background */}
      {result && (
        <ExpandableBlock
          lineCount={lineCount}
          maxLines={20}
          gradientFromClass="from-[rgb(36,41,46)]"
        >
          <pre
            className="m-0 overflow-x-auto overflow-y-hidden font-mono text-code leading-code"
            style={{
              backgroundColor: "rgb(36, 41, 46)",
              color: "rgb(225, 228, 232)",
            }}
          >
            <code className="grid py-1" style={{ gridTemplateColumns: "auto 1fr" }}>
              <div data-gutter="" className="select-none">
                {parsedLines.map((line, index) => (
                  <div
                    key={index}
                    className="h-[var(--upstream-leading-code)] text-right"
                    style={{
                      padding: "0 0.6em 0 1.2em",
                      color: "rgb(153, 157, 161)",
                    }}
                  >
                    {line.lineNum || ""}
                  </div>
                ))}
              </div>
              <div data-content="">
                {parsedLines.map((line, index) => (
                  <div
                    key={index}
                    className="h-[var(--upstream-leading-code)] whitespace-pre"
                    style={{ padding: "0 0.6em" }}
                  >
                    {tokens?.[index] ? (
                      <HighlightedLine tokens={tokens[index]} />
                    ) : (
                      <PlainLine content={line.content} />
                    )}
                  </div>
                ))}
              </div>
            </code>
          </pre>
        </ExpandableBlock>
      )}
    </ErrorBorder>
  );
}
