import { useMemo } from "react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";
import type { ToolRendererProps } from "./types";
import { CopyButton, TruncatedFilePathHeader } from "./shared";
import { useResolvedTheme } from "../theme-provider";
import { buildUnifiedHunk } from "../../lib/diff-utils";
import { resolveDiffLanguage, useShikiDiffHighlighter } from "../../lib/diff-highlighter";
import { editDiffEntries } from "../../lib/session-utils";

/**
 * One replacement: a smart-truncated file-path header with a hover copy button
 * above its unified diff. Upstream gives every `MultiEdit` replacement its own
 * such card, so a call with N edits stacks N of these.
 */
function EditDiffCard({
  filePath,
  oldStr,
  newStr,
  copyText,
  separated,
}: {
  filePath: string;
  oldStr: string;
  newStr: string;
  copyText: string;
  separated: boolean;
}) {
  const theme = useResolvedTheme();

  const viewData = useMemo(() => {
    const lang = resolveDiffLanguage(filePath);
    return {
      oldFile: { fileName: filePath, fileLang: lang, content: oldStr },
      newFile: { fileName: filePath, fileLang: lang, content: newStr },
      hunks: [buildUnifiedHunk(oldStr, newStr, filePath)],
    };
  }, [filePath, oldStr, newStr]);
  const registerHighlighter = useShikiDiffHighlighter(viewData.newFile.fileLang);

  return (
    <div className={separated ? "border-t border-[var(--card-outline)]" : undefined}>
      <div className="flex items-center gap-g3 px-p6 py-p5">
        <TruncatedFilePathHeader filePath={filePath} />
        <CopyButton text={copyText} />
      </div>

      <div className="max-h-[400px] overflow-y-auto text-code">
        <DiffView
          data={viewData}
          diffViewMode={DiffModeEnum.Unified}
          diffViewTheme={theme}
          diffViewHighlight
          diffViewWrap
          diffViewFontSize={13}
          registerHighlighter={registerHighlighter}
        />
      </div>
    </div>
  );
}

export function EditRenderer({ toolCall }: ToolRendererProps) {
  const { input, result, isError } = toolCall;
  const filePath = (input["file_path"] as string) ?? "";
  const entries = useMemo(() => editDiffEntries(input), [input]);

  if (entries.length === 0) {
    return (
      <div className="px-p6 py-p5">
        <pre
          className={`max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all ${isError ? "text-extended-pink" : "text-assistant-secondary"}`}
        >
          {result}
        </pre>
      </div>
    );
  }

  const copyText = result ?? filePath;

  return (
    <>
      {entries.map((entry, index) => (
        <EditDiffCard
          key={index}
          filePath={filePath}
          oldStr={entry.oldStr}
          newStr={entry.newStr}
          copyText={copyText}
          separated={index > 0}
        />
      ))}

      {/* Error result text (shown below the diffs when the edit failed) */}
      {isError && result && (
        <div className="px-p6 pb-p8">
          <pre className="max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all text-extended-pink">
            {result}
          </pre>
        </div>
      )}
    </>
  );
}
