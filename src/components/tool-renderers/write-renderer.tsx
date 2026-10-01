import {Link} from "@tanstack/react-router";
import {FileText} from "lucide-react";
import type {ToolRendererProps} from "./types";
import {InlineDiff} from "./inline-diff";
import {CopyButton, TOOL_OUTPUT_REGION, TruncatedFilePathHeader} from "./shared";
import {toMdSlug} from "../../lib/md-slug";

const PLAN_RE = /\.claude\/plans\/([^/]+\.md)$/;

export function WriteRenderer({toolCall}: ToolRendererProps) {
	const filePath = (toolCall.input["file_path"] as string) ?? "";
	const content = toolCall.input["content"] as string | undefined;
	const {result, isError} = toolCall;
	const planMatch = filePath.match(PLAN_RE);
	const copyText = content ?? result ?? filePath;

	if (!content) {
		return (
			<div className="px-p6 py-p5">
				<pre
					{...TOOL_OUTPUT_REGION}
					className={`max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all ${isError ? "text-danger-ink" : "text-secondary"}`}
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
						params={{filename: toMdSlug(planMatch[1]!)}}
						className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 hover:underline shrink-0"
					>
						<FileText size={12} />
						Plan
					</Link>
				)}
				<CopyButton text={copyText} />
			</div>

			{/* Body: unified diff view (all additions) */}
			<div {...TOOL_OUTPUT_REGION} className="max-h-[400px] overflow-y-auto text-code">
				<InlineDiff filePath={filePath} oldStr="" newStr={content} />
			</div>

			{/* Error result text (shown below diff when write failed) */}
			{isError && result && (
				<div className="px-p6 pb-p8">
					<pre
						{...TOOL_OUTPUT_REGION}
						className="max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all text-danger-ink"
					>
						{result}
					</pre>
				</div>
			)}
		</>
	);
}
