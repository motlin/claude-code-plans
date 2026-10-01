import {useMemo} from "react";
import type {ToolRendererProps} from "./types";
import {InlineDiff} from "./inline-diff";
import {CopyButton, TruncatedFilePathHeader} from "./shared";
import {editDiffEntries} from "../../lib/session-utils";

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
	return (
		<div className={separated ? "border-t border-[var(--card-outline)]" : undefined}>
			<div className="flex items-center gap-g3 px-p6 py-p5">
				<TruncatedFilePathHeader filePath={filePath} />
				<CopyButton text={copyText} />
			</div>

			<div className="max-h-[400px] overflow-y-auto text-code">
				<InlineDiff filePath={filePath} oldStr={oldStr} newStr={newStr} />
			</div>
		</div>
	);
}

export function EditRenderer({toolCall}: ToolRendererProps) {
	const {input, result, isError} = toolCall;
	const filePath = (input["file_path"] as string) ?? "";
	const entries = useMemo(() => editDiffEntries(input), [input]);

	if (entries.length === 0) {
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
					<pre className="max-h-[400px] overflow-y-auto text-code font-mono whitespace-pre-wrap break-all text-danger-ink">
						{result}
					</pre>
				</div>
			)}
		</>
	);
}
