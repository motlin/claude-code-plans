import type {z} from "zod";
import {reportFindingsVerdictLabels} from "../../lib/schema-choices";
import {ReportFindingsInputSchema, type ReportedFindingSchema} from "../../lib/tool-input-schemas";
import {FindingCard, type FindingCardProps} from "../finding-card";
import {FallbackRenderer} from "./fallback-renderer";
import type {ToolRendererProps} from "./types";

type ReportedFinding = z.infer<typeof ReportedFindingSchema>;

const verdictSeverity = {
	CONFIRMED: "high",
	PLAUSIBLE: "medium",
} satisfies Record<keyof typeof reportFindingsVerdictLabels, FindingCardProps["severity"]>;

function cardProps(finding: ReportedFinding): FindingCardProps {
	const title = finding.short_summary ?? finding.summary;
	const body =
		finding.short_summary === undefined
			? finding.failure_scenario
			: `${finding.summary}\n\n${finding.failure_scenario}`;
	return {
		severity: finding.verdict === undefined ? "low" : verdictSeverity[finding.verdict],
		title,
		body,
		location: `${finding.file}:${finding.line}`,
		category: finding.category,
		verdict: finding.verdict === undefined ? undefined : reportFindingsVerdictLabels[finding.verdict],
	};
}

/** ReportFindings body: one finding card per reported finding. */
export function ReportFindingsRenderer({toolCall}: ToolRendererProps) {
	const parsed = ReportFindingsInputSchema.safeParse(toolCall.input);
	if (!parsed.success) return <FallbackRenderer toolCall={toolCall} />;

	const {findings} = parsed.data;
	return (
		<div className="flex w-full flex-col gap-g4 text-body">
			{toolCall.isError && toolCall.result && (
				<div className="text-extended-pink whitespace-pre-wrap break-words">{toolCall.result}</div>
			)}
			{findings.length === 0 && !toolCall.isError && toolCall.result && (
				<div className="text-secondary">{toolCall.result}</div>
			)}
			{findings.map((finding, index) => (
				<FindingCard key={`${finding.file}:${finding.line}:${index}`} {...cardProps(finding)} />
			))}
		</div>
	);
}
