import { useMemo } from "react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";
import type { ToolRendererProps } from "./types";
import { CopyButton } from "./shared";
import { useResolvedTheme } from "../theme-provider";
import { computeDiffData, buildUnifiedHunk } from "../../lib/diff-utils";
import { resolveDiffLanguage, useShikiDiffHighlighter } from "../../lib/diff-highlighter";

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

export function EditRenderer({ toolCall }: ToolRendererProps) {
  const filePath = (toolCall.input["file_path"] as string) ?? "";
  const rawOldStr = toolCall.input["old_string"];
  const oldStr = (rawOldStr as string) ?? "";
  const newStr = (toolCall.input["new_string"] as string) ?? "";
  const { result, isError } = toolCall;
  const theme = useResolvedTheme();
  const { prefix, suffix } = splitPath(filePath);

  const diffData = useMemo(() => {
    if (rawOldStr === undefined) return null;
    const data = computeDiffData(oldStr, newStr);
    data.unifiedHunk = buildUnifiedHunk(oldStr, newStr, filePath);
    data.oldContent = oldStr;
    data.newContent = newStr;
    data.filePath = filePath;
    return data;
  }, [rawOldStr, oldStr, newStr, filePath]);

  const viewData = useMemo(() => {
    if (!diffData?.unifiedHunk) return null;
    const lang = resolveDiffLanguage(diffData.filePath ?? filePath);
    return {
      oldFile: {
        fileName: filePath,
        fileLang: lang,
        content: diffData.oldContent ?? "",
      },
      newFile: {
        fileName: filePath,
        fileLang: lang,
        content: diffData.newContent ?? "",
      },
      hunks: [diffData.unifiedHunk],
    };
  }, [diffData, filePath]);
  const registerHighlighter = useShikiDiffHighlighter(viewData?.newFile.fileLang ?? "text");

  if (!diffData) {
    return (
      <div className="px-p6 py-p5">
        <pre
          className={`text-code font-mono whitespace-pre-wrap break-all ${isError ? "text-extended-pink" : "text-assistant-secondary"}`}
        >
          {result}
        </pre>
      </div>
    );
  }

  const copyText = result ?? filePath;

  return (
    <>
      {/* Header: smart-truncated file path + hover copy button */}
      <div className="flex items-center gap-g3 px-p6 py-p5">
        <span className="flex flex-1 min-w-0 text-body text-assistant-secondary">
          <span className="contents" title={filePath}>
            <span className="truncate">{prefix}</span>
            <span className="shrink-0">{suffix}</span>
          </span>
        </span>
        <CopyButton text={copyText} />
      </div>

      {/* Body: unified diff view */}
      {viewData && (
        <div className="overflow-hidden text-code">
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
      )}

      {/* Error result text (shown below diff when edit failed) */}
      {isError && result && (
        <div className="px-p6 pb-p8">
          <pre className="text-code font-mono whitespace-pre-wrap break-all text-extended-pink">
            {result}
          </pre>
        </div>
      )}
    </>
  );
}
