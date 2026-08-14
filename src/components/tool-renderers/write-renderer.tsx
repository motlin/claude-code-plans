import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";
import type { ToolRendererProps } from "./types";
import { CopyButton, TruncatedFilePathHeader } from "./shared";
import { useResolvedTheme } from "../theme-provider";
import { buildUnifiedHunk } from "../../lib/diff-utils";
import { resolveDiffLanguage, useShikiDiffHighlighter } from "../../lib/diff-highlighter";
import { toMdSlug } from "../../lib/md-slug";

const PLAN_RE = /\.claude\/plans\/([^/]+\.md)$/;

export function WriteRenderer({ toolCall }: ToolRendererProps) {
  const filePath = (toolCall.input["file_path"] as string) ?? "";
  const content = toolCall.input["content"] as string | undefined;
  const { result, isError } = toolCall;
  const planMatch = filePath.match(PLAN_RE);
  const copyText = content ?? result ?? filePath;
  const theme = useResolvedTheme();

  const diffData = useMemo(() => {
    if (content === undefined) return null;
    return {
      unifiedHunk: buildUnifiedHunk("", content, filePath),
      oldContent: "",
      newContent: content,
      filePath,
    };
  }, [content, filePath]);

  const viewData = useMemo(() => {
    if (!diffData?.unifiedHunk) return null;
    const lang = resolveDiffLanguage(diffData.filePath);
    return {
      oldFile: {
        fileName: filePath,
        fileLang: lang,
        content: diffData.oldContent,
      },
      newFile: {
        fileName: filePath,
        fileLang: lang,
        content: diffData.newContent,
      },
      hunks: [diffData.unifiedHunk],
    };
  }, [diffData, filePath]);
  const registerHighlighter = useShikiDiffHighlighter(viewData?.newFile.fileLang ?? "text");

  if (!content) {
    return (
      <div className="px-p6 py-p5">
        <pre
          className={`max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all ${isError ? "text-extended-pink" : "text-secondary"}`}
        >
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
        {planMatch && (
          <Link
            to="/plan/$filename"
            params={{ filename: toMdSlug(planMatch[1]!) }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 hover:underline shrink-0"
          >
            <FileText size={12} />
            Plan
          </Link>
        )}
        <CopyButton text={copyText} />
      </div>

      {/* Body: unified diff view (all additions) */}
      {viewData && (
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
      )}

      {/* Error result text (shown below diff when write failed) */}
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
