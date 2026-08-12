import { type ReactNode, useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { renderMarkdownWithHighlighting } from "../../lib/client-markdown";
import {
  getHighlighterSync,
  getHighlighterVersion,
  subscribeHighlighter,
} from "../../hooks/use-shiki";
import markdownStyles from "../markdown-article.module.css";

// ANSI color code to CSS color mapping
const BASIC_COLORS: Record<number, string> = {
  30: "#000000", // black
  31: "#cc0000", // red
  32: "#00cc00", // green
  33: "#cccc00", // yellow
  34: "#0000ee", // blue
  35: "#cc00cc", // magenta
  36: "#00cccc", // cyan
  37: "#ffffff", // white
  90: "#666666", // bright black
  91: "#ff0000", // bright red
  92: "#00ff00", // bright green
  93: "#ffff00", // bright yellow
  94: "#5555ff", // bright blue
  95: "#ff00ff", // bright magenta
  96: "#00ffff", // bright cyan
  97: "#ffffff", // bright white
};

const BG_COLORS: Record<number, string> = {
  40: "#000000",
  41: "#cc0000",
  42: "#00cc00",
  43: "#cccc00",
  44: "#0000ee",
  45: "#cc00cc",
  46: "#00cccc",
  47: "#ffffff",
  100: "#666666",
  101: "#ff0000",
  102: "#00ff00",
  103: "#ffff00",
  104: "#5555ff",
  105: "#ff00ff",
  106: "#00ffff",
  107: "#ffffff",
};

interface StyledPart {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export function parseAnsiCodes(text: string): StyledPart[] {
  const parts: StyledPart[] = [];

  // Current style state
  let currentFg: string | undefined;
  let currentBg: string | undefined;
  let currentBold = false;
  let currentDim = false;
  let currentItalic = false;
  let currentUnderline = false;

  // Split by ANSI escape sequences (ESC = 0x1b)
  // eslint-disable-next-line no-control-regex -- ESC (0x1b) needed for ANSI codes
  const ansiRegex = /\u001b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape code
    if (match.index > lastIndex) {
      const textContent = text.slice(lastIndex, match.index);
      if (textContent) {
        const part: StyledPart = { text: textContent };
        if (currentFg) part.fg = currentFg;
        if (currentBg) part.bg = currentBg;
        if (currentBold) part.bold = true;
        if (currentDim) part.dim = true;
        if (currentItalic) part.italic = true;
        if (currentUnderline) part.underline = true;
        parts.push(part);
      }
    }

    // Parse the escape code
    const codeStr = match[1] ?? "";
    const codes = codeStr.split(";").map((c) => parseInt(c || "0", 10));

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i] ?? 0;
      if (code === 0) {
        // Reset all
        currentFg = undefined;
        currentBg = undefined;
        currentBold = false;
        currentDim = false;
        currentItalic = false;
        currentUnderline = false;
      } else if (code === 1) {
        currentBold = true;
      } else if (code === 2) {
        currentDim = true;
      } else if (code === 3) {
        currentItalic = true;
      } else if (code === 4) {
        currentUnderline = true;
      } else if (code === 22) {
        currentBold = false;
        currentDim = false;
      } else if (code === 23) {
        currentItalic = false;
      } else if (code === 24) {
        currentUnderline = false;
      } else if (code >= 30 && code <= 37) {
        currentFg = BASIC_COLORS[code];
      } else if (code >= 40 && code <= 47) {
        currentBg = BG_COLORS[code];
      } else if (code >= 90 && code <= 97) {
        currentFg = BASIC_COLORS[code];
      } else if (code >= 100 && code <= 107) {
        currentBg = BG_COLORS[code];
      } else if (code === 38) {
        // 256-color or RGB
        // Format: 38;5;N or 38;2;R;G;B
        const mode = codes[i + 1];
        if (mode === 5) {
          const colorIdx = codes[i + 2];
          if (colorIdx !== undefined) {
            if (colorIdx >= 0 && colorIdx <= 15) {
              currentFg = BASIC_COLORS[30 + (colorIdx % 8)] || "#ffffff";
            } else if (colorIdx >= 16 && colorIdx <= 231) {
              // Standard 216-color cube
              const idx = colorIdx - 16;
              const r = Math.floor(idx / 36) * 51;
              const g = Math.floor((idx % 36) / 6) * 51;
              const b = (idx % 6) * 51;
              currentFg = `rgb(${r},${g},${b})`;
            } else {
              // Grayscale
              const gray = 8 + (colorIdx - 232) * 10;
              currentFg = `rgb(${gray},${gray},${gray})`;
            }
            i += 2; // Skip the next two codes
          }
        } else if (mode === 2) {
          const r = codes[i + 2];
          const g = codes[i + 3];
          const b = codes[i + 4];
          if (r !== undefined && g !== undefined && b !== undefined) {
            currentFg = `rgb(${r},${g},${b})`;
            i += 4; // Skip the next four codes
          }
        }
      } else if (code === 48) {
        // Background 256-color or RGB
        const mode = codes[i + 1];
        if (mode === 5) {
          const colorIdx = codes[i + 2];
          if (colorIdx !== undefined) {
            if (colorIdx >= 0 && colorIdx <= 15) {
              currentBg = BG_COLORS[40 + (colorIdx % 8)] || "#000000";
            } else if (colorIdx >= 16 && colorIdx <= 231) {
              const idx = colorIdx - 16;
              const r = Math.floor(idx / 36) * 51;
              const g = Math.floor((idx % 36) / 6) * 51;
              const b = (idx % 6) * 51;
              currentBg = `rgb(${r},${g},${b})`;
            } else {
              const gray = 8 + (colorIdx - 232) * 10;
              currentBg = `rgb(${gray},${gray},${gray})`;
            }
            i += 2; // Skip the next two codes
          }
        } else if (mode === 2) {
          const r = codes[i + 2];
          const g = codes[i + 3];
          const b = codes[i + 4];
          if (r !== undefined && g !== undefined && b !== undefined) {
            currentBg = `rgb(${r},${g},${b})`;
            i += 4; // Skip the next four codes
          }
        }
      }
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const textContent = text.slice(lastIndex);
    if (textContent) {
      const part: StyledPart = { text: textContent };
      if (currentFg) part.fg = currentFg;
      if (currentBg) part.bg = currentBg;
      if (currentBold) part.bold = true;
      if (currentDim) part.dim = true;
      if (currentItalic) part.italic = true;
      if (currentUnderline) part.underline = true;
      parts.push(part);
    }
  }

  return parts;
}

export function AnsiText({ content }: { content: string }) {
  const parts = parseAnsiCodes(content);

  return (
    <>
      {parts.map((part, i) => (
        <span
          key={i}
          style={{
            color: part.fg,
            backgroundColor: part.bg,
            fontWeight: part.bold ? "bold" : undefined,
            opacity: part.dim ? 0.7 : undefined,
            fontStyle: part.italic ? "italic" : undefined,
            textDecoration: part.underline ? "underline" : undefined,
          }}
        >
          {part.text}
        </span>
      ))}
    </>
  );
}

export function FilePath({ path }: { path: string }) {
  return <code className="text-xs font-mono bg-bg-200 px-1.5 py-0.5 rounded truncate">{path}</code>;
}

export function DiffStats({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="inline-flex gap-1 font-mono text-xs shrink-0">
      {added > 0 && <span className="text-success-000">+{added}</span>}
      {removed > 0 && <span className="text-danger-000">-{removed}</span>}
    </span>
  );
}

export function ErrorBorder({
  isError,
  children,
}: {
  isError?: boolean | undefined;
  children: ReactNode;
}) {
  if (!isError) return <>{children}</>;
  return <div className="border-l-2 border-danger-100 pl-2">{children}</div>;
}

export function TerminalOutput({ content, maxLines = 20 }: { content: string; maxLines?: number }) {
  // Extract exit code if present at the start of the content
  const exitCodeMatch = content.match(/^Exit code (\d+)\n?/);
  const exitCode = exitCodeMatch?.[1] ? parseInt(exitCodeMatch[1], 10) : null;
  const contentWithoutExitCode = exitCodeMatch ? content.replace(/^Exit code \d+\n?/, "") : content;
  const lineCount = contentWithoutExitCode.split("\n").length;

  return (
    <div>
      {exitCode !== null && (
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 bg-danger-900 text-danger-000 px-2.5 py-1 rounded text-xs font-bold">
            Exit code <span className="font-mono">{exitCode}</span>
          </span>
        </div>
      )}
      <ExpandableBlock lineCount={lineCount} maxLines={maxLines}>
        <pre className="bg-bg-200 text-text-100 rounded text-xs leading-relaxed p-2 whitespace-pre-wrap break-all">
          <AnsiText content={contentWithoutExitCode} />
        </pre>
      </ExpandableBlock>
    </div>
  );
}

/**
 * Wraps tall content in a soft cap: shows up to `maxLines` worth of height,
 * with a gradient fade + "Show all N lines" button when overflow. Click to
 * reveal the rest inline — no inner scrollbar.
 */
export function ExpandableBlock({
  lineCount,
  maxLines = 20,
  gradientFromClass,
  children,
}: {
  lineCount: number;
  maxLines?: number;
  /** Override the gradient start color class (default: from-bg-000). */
  gradientFromClass?: string | undefined;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsCap = lineCount > maxLines;

  if (!needsCap || expanded) {
    return <div>{children}</div>;
  }

  // ~1.4rem per line of text-xs leading-relaxed. Keep this tight so the
  // fade/button appear just below the cutoff.
  const maxHeight = `${maxLines * 1.4}rem`;

  return (
    <div>
      <div className="relative overflow-hidden" style={{ maxHeight }}>
        {children}
        <div
          className={`absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t ${gradientFromClass ?? "from-bg-000"} to-transparent pointer-events-none`}
        />
      </div>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-1 text-xs text-text-500 hover:text-text-100 transition cursor-pointer"
      >
        Show all {lineCount} lines
      </button>
    </div>
  );
}

export function ChevronIcon({ expanded, size = 14 }: { expanded: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="shrink-0">
      <path
        d={
          expanded
            ? "M10.2249 6.22426C10.469 5.98056 10.8647 5.98045 11.1087 6.22426C11.3528 6.46833 11.3528 6.86494 11.1087 7.10902L8.9134 9.30434C8.40899 9.80852 7.5906 9.80863 7.08626 9.30434L4.89094 7.10902C4.64687 6.86494 4.64687 6.46833 4.89094 6.22426C5.13502 5.98018 5.53163 5.98018 5.77571 6.22426L7.97102 8.41957C7.98728 8.43578 8.01338 8.43581 8.02962 8.41957L10.2249 6.22426Z"
            : "M6.34364 4.80476C6.58772 4.56068 6.98433 4.56068 7.22841 4.80476L9.42372 7.00007C9.92802 7.50442 9.92791 8.32281 9.42372 8.82722L7.22841 11.0225C6.98433 11.2666 6.58772 11.2666 6.34364 11.0225C6.09984 10.7786 6.09994 10.3828 6.34364 10.1387L8.53895 7.94343C8.55519 7.92719 8.55516 7.9011 8.53895 7.88484L6.34364 5.68953C6.09956 5.44545 6.09956 5.04884 6.34364 4.80476Z"
        }
        fill="currentColor"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" fill="none" className="shrink-0">
      <path
        d="M7.42584 5.08148C7.42584 4.80533 7.20199 4.58148 6.92584 4.58148H2.67584C2.3997 4.58148 2.17584 4.80534 2.17584 5.08148V9.33148C2.17584 9.60763 2.39969 9.83148 2.67584 9.83148H6.92584C7.202 9.83148 7.42584 9.60764 7.42584 9.33148V5.08148ZM8.42584 7.83636H8.92584C9.202 7.83636 9.42584 7.61252 9.42584 7.33636V3.08148C9.42584 2.80533 9.20199 2.58148 8.92584 2.58148H4.67584C4.3997 2.58148 4.17584 2.80534 4.17584 3.08148V3.58148H6.92584C7.75429 3.58148 8.42584 4.25306 8.42584 5.08148V7.83636ZM10.4258 7.33636C10.4258 8.16481 9.75428 8.83636 8.92584 8.83636H8.42584V9.33148C8.42584 10.1599 7.75428 10.8315 6.92584 10.8315H2.67584C1.84742 10.8315 1.17584 10.1599 1.17584 9.33148V5.08148C1.17584 4.25305 1.84741 3.58148 2.67584 3.58148H3.17584V3.08148C3.17584 2.25305 3.84741 1.58148 4.67584 1.58148H8.92584C9.75429 1.58148 10.4258 2.25306 10.4258 3.08148V7.33636Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" fill="none" className="shrink-0">
      <path
        d="M10 3L4.5 8.5L2 6"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Hover-visible copy button matching upstream claude.ai/code.
 *
 * Requires a `group/body` ancestor for the hover reveal.
 * Copies the provided `text` to the clipboard on click.
 */
export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleClick = useCallback(() => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <div className="opacity-0 group-hover/body:opacity-100 focus-within:opacity-100 [transition:opacity_150ms_cubic-bezier(0.215,0.61,0.355,1)] motion-reduce:transition-none">
      <button
        type="button"
        aria-label="Copy"
        onClick={handleClick}
        className="inline-flex items-center justify-center aspect-square border-0 cursor-default select-none rounded-r4 px-p3 text-assistant-secondary hover:text-assistant-primary hover:bg-t2 transition-colors"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    </div>
  );
}

export function CollapsibleSection({
  label,
  defaultOpen = false,
  children,
}: {
  label: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-text-500 hover:text-text-100 cursor-pointer"
      >
        <ChevronIcon expanded={open} />
        {label}
      </button>
      <div className={`grid ${open ? "grid-rows-expand" : "grid-rows-collapse"}`}>
        <div className="overflow-hidden">
          <div className="mt-1">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Inline markdown renderer for KeyValueCard param values.
 * Memoizes the HTML output to avoid re-rendering on every parent render.
 */
function InlineMarkdown({ text }: { text: string }) {
  const highlighterVersion = useSyncExternalStore(
    subscribeHighlighter,
    getHighlighterVersion,
    () => 0,
  );
  const html = useMemo(() => {
    void highlighterVersion;
    return renderMarkdownWithHighlighting(text, getHighlighterSync());
  }, [text, highlighterVersion]);
  return <div className={markdownStyles["markdown"]} dangerouslySetInnerHTML={{ __html: html }} />;
}

export interface KeyValueParam {
  key: string;
  value: string;
  /** When true, render the value as markdown instead of plain text. */
  markdown?: boolean;
}

/**
 * Upstream-style key-value card used by Grep, Glob, Agent, WebFetch,
 * WebSearch, and most non-file tools.
 *
 * Layout:
 *   flex w-full
 *     flex-1 content (params + result)
 *     CopyButton (hover-visible)
 */
export function KeyValueCard({
  params,
  result,
  markdownResult,
  copyText,
  children,
}: {
  params: KeyValueParam[];
  result?: string | undefined;
  markdownResult?: boolean | undefined;
  /** Overrides the default params + result copy payload. */
  copyText?: string | undefined;
  children?: ReactNode;
}) {
  const derivedCopyText = [
    ...params.map((p) => `${p.key}: ${p.value}`),
    ...(result ? [result] : []),
  ].join("\n");

  return (
    <div className="flex w-full">
      <div className="flex-1 min-w-0 flex flex-col gap-g4 text-body text-assistant-secondary whitespace-pre-wrap break-words">
        {params.length > 0 && (
          <div className="text-assistant-secondary">
            {params.map((p) => (
              <div key={p.key}>
                {p.markdown ? (
                  <>
                    <span className="font-semibold">{p.key}:</span>
                    <InlineMarkdown text={p.value} />
                  </>
                ) : (
                  <>
                    {p.key}: {p.value}
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        {result && (markdownResult ? <InlineMarkdown text={result} /> : <div>{result}</div>)}
        {children}
      </div>
      <CopyButton text={copyText ?? derivedCopyText} />
    </div>
  );
}

export function ToolMeta({ children }: { children: ReactNode }) {
  return <span className="text-xs text-text-500">{children}</span>;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return "< 1s";
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function DurationBadge({ duration }: { duration: number }) {
  return <span className="text-xs text-text-500 ml-1.5">{formatDuration(duration)}</span>;
}
