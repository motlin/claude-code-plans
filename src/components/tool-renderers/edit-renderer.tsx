import {inputString} from "../../lib/tool-utils";
import {useMemo} from "react";
import type {ToolRendererProps} from "./types";
import {InlineDiff} from "./inline-diff";
import {CopyButton, PolicyDenialReason, TruncatedFilePathHeader} from "./shared";
import {editDiffEntries} from "../../lib/session-utils";

export function EditRenderer({toolCall}: ToolRendererProps)
{
	const {input, result, isError} = toolCall;
	const filePath = inputString(input, "file_path") ?? "";
	const entries = useMemo(() => editDiffEntries(input), [input]);
	// Upstream's `b`: a MultiEdit is ONE diff, its edits' sides joined by a "…" line.
	const joined = useMemo(
		() => (
		{
			oldStr: entries.map((entry) => entry.oldStr).join("\n…\n"),
			newStr: entries.map((entry) => entry.newStr).join("\n…\n"),
		}),
		[entries],
	);

	if (toolCall.blocked === true && entries.length === 0)
	{
		return (
			<div className="px-p6 py-p5">
				<PolicyDenialReason call={toolCall} />
			</div>
		);
	}
	if (entries.length === 0 || (joined.oldStr === "" && joined.newStr === ""))
	{
		return (
			<div className="px-p6 py-p5">
				<pre
					className={`max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all ${isError ? "text-danger-ink" : "text-secondary"}`}
				>
					{result}
				</pre>
			</div>
		);
	}

	return (
		<>
			<div className="flex items-center gap-g3 px-p6 py-p5">
				<TruncatedFilePathHeader filePath={filePath} />
				<CopyButton text={joined.newStr || joined.oldStr} />
			</div>

			<div className="max-h-[400px] overflow-y-auto text-code">
				<InlineDiff
					filePath={filePath}
					oldStr={joined.oldStr}
					newStr={joined.newStr}
					patch={toolCall.resultMeta?.patch}
				/>
			</div>

			{toolCall.blocked === true && (
				<div className="px-p6 pb-p8">
					<PolicyDenialReason call={toolCall} />
				</div>
			)}
			{/* Error result text (shown below the diffs when the edit failed) */}
			{isError && result && toolCall.blocked !== true && (
				<div className="px-p6 pb-p8">
					<pre className="max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all text-danger-ink">
						{result}
					</pre>
				</div>
			)}
		</>
	);
}
