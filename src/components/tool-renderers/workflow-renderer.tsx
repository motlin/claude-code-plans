import {inputString} from "../../lib/tool-utils";
import {FallbackRenderer} from "./fallback-renderer";
import {KeyValueCard} from "./shared";
import {LabelledSection} from "./tool-output-section";
import type {ToolRendererProps} from "./types";

/** The Workflow inputs upstream's failed step lists under Input, by their display labels. */
const INPUT_LABELS = [
	["scriptPath", "Script path"],
	["script", "Script"],
] as const;

/**
 * A Workflow call's body. Upstream's failed TurnStatusStep discloses the tool
 * error, then an Input section naming the script it was asked to run; any
 * other call (shown only in Verbose) keeps the generic key/value body.
 */
export function WorkflowRenderer({toolCall}: ToolRendererProps)
{
	if (toolCall.isError !== true) return <FallbackRenderer toolCall={toolCall} />;
	const rows = INPUT_LABELS.flatMap(([key, label]) =>
	{
		const value = inputString(toolCall.input, key);
		return value === undefined
			? []
			: [
					{
						label,
						value,
					},
				];
	});
	const result = toolCall.result ?? undefined;
	const copyText = [result, ...rows.map((row) => `${row.label}: ${row.value}`)]
		.filter((part) => part !== undefined)
		.join("\n");
	return (
		<KeyValueCard call={toolCall} isError params={[]} result={result} copyText={copyText}>
			{rows.length > 0 && (
				<LabelledSection label="Input">
					<div className="text-secondary flex flex-col gap-g2">
						{rows.map((row) => (
							<div key={row.label} className="flex flex-col">
								<span className="text-footnote text-muted-as-secondary">{row.label}</span>
								<span className="font-mono text-code break-all">{row.value}</span>
							</div>
						))}
					</div>
				</LabelledSection>
			)}
		</KeyValueCard>
	);
}
