import type { ThemedToken } from "@shikijs/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useHighlightedLines } from "../hooks/use-shiki";
import type { FileViewerData } from "../lib/api/file";
import { detectLanguage } from "../lib/diff-utils";

export function parseFileLineHash(hash: string): number | null {
  const match = /^#L([1-9]\d*)$/.exec(hash);
  if (!match) return null;
  const lineNumber = Number(match[1]);
  return Number.isSafeInteger(lineNumber) ? lineNumber : null;
}

export function fileViewerLanguage(path: string): string | null {
  return detectLanguage(path);
}

function HighlightedLine({ tokens }: { tokens: ThemedToken[] }) {
  return (
    <>
      {tokens.map((token, index) => (
        <span key={`${token.offset}-${index}`} style={{ color: token.color }}>
          {token.content}
        </span>
      ))}
    </>
  );
}

export function FileViewer({ file }: { file: FileViewerData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const lines = file.content.split("\n");
  const tokens = useHighlightedLines(file.content, fileViewerLanguage(file.path));

  const activateHash = useCallback((hash: string) => {
    const lineNumber = parseFileLineHash(hash);
    const line =
      lineNumber === null
        ? null
        : containerRef.current?.querySelector<HTMLElement>(`#L${lineNumber}`);
    if (!line || lineNumber === null) {
      setHighlightedLine(null);
      return;
    }

    setHighlightedLine(lineNumber);
    line.scrollIntoView({ block: "center" });
  }, []);

  useEffect(() => {
    const handleHashChange = () => activateHash(window.location.hash);
    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [activateHash, file.path]);

  const selectLine = (lineNumber: number) => {
    const hash = `#L${lineNumber}`;
    window.history.pushState(null, "", hash);
    activateHash(hash);
  };

  return (
    <div ref={containerRef} className="overflow-x-auto rounded-lg border border-border-300/20">
      <div className="min-w-max bg-bg-100 py-2 font-mono text-xs leading-5" role="table">
        {lines.map((line, index) => {
          const lineNumber = index + 1;
          const lineId = `L${lineNumber}`;
          const isHighlighted = highlightedLine === lineNumber;
          return (
            <div
              id={lineId}
              key={lineId}
              role="row"
              data-highlighted={isHighlighted ? "true" : undefined}
              className={`flex min-h-5 scroll-mt-16 ${isHighlighted ? "bg-accent-100/15" : ""}`}
            >
              <a
                href={`#${lineId}`}
                aria-current={isHighlighted ? "location" : undefined}
                aria-label={`Go to line ${lineNumber}`}
                className="w-14 shrink-0 select-none border-r border-border-300/20 pr-3 text-right text-text-500 hover:text-accent-100"
                onClick={(event) => {
                  event.preventDefault();
                  selectLine(lineNumber);
                }}
                role="cell"
              >
                {lineNumber}
              </a>
              <code className="block flex-1 whitespace-pre px-4 text-text-100" role="cell">
                {tokens?.[index] ? <HighlightedLine tokens={tokens[index]} /> : line}
              </code>
            </div>
          );
        })}
      </div>
    </div>
  );
}
