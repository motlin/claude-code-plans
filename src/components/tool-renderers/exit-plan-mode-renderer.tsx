import {inputString} from "../../lib/tool-utils";
import {Link} from "@tanstack/react-router";
import {CircleCheck} from "lucide-react";
import type {ToolRendererProps} from "./types";
import {toMdSlug} from "../../lib/md-slug";
import {
	describeExitPlanModeResult,
	EXIT_PLAN_MODE_STATE_LABEL,
	exitPlanModeState,
	parseAllowedPrompts,
	PLAN_FILE_ACTION_LABEL,
	type ExitPlanModeStatusTone,
} from "../../lib/exit-plan-mode";

const PLAN_FILE_RE = /\.claude\/plans\/([^/\s]+\.md)/;

/** Upstream's plan block: the plan text as typed, set off by a 2px start border. */
const PLAN_BLOCK_CLASS = "text-body text-secondary whitespace-pre-wrap break-words ps-2 border-s-2";

/** Upstream's quiet footnote-sized secondary action, like the plan card's "Open plan". */
const PLAN_FILE_ACTION_CLASS = "shrink-0 text-footnote text-secondary hover:text-primary hover:underline";

const TONE_CLASS: Record<ExitPlanModeStatusTone, string> = {
	approved: "text-success-000",
	rejected: "text-danger-000",
	error: "text-danger-000",
	info: "text-secondary",
};

/**
 * Upstream's ExitPlanMode body: while it runs or awaits approval, the plan in a
 * left-bordered block; once done, "Plan approved" above that block (omitted on
 * an error). A local "Open plan file" link to the saved plan sits where upstream's
 * plan card puts its "Open plan" action, trailing the state row. The allowed
 * prompts and a rejection or error status show only in Verbose.
 */
export function ExitPlanModeRenderer({toolCall, verbose}: ToolRendererProps) {
	const {result} = toolCall;
	const planFilePath = inputString(toolCall.input, "planFilePath") ?? "";
	const planFile = (planFilePath.match(PLAN_FILE_RE) ?? result?.match(PLAN_FILE_RE))?.[1];
	const plan = typeof toolCall.input["plan"] === "string" ? toolCall.input["plan"] : "";
	const allowedPrompts = verbose === true ? parseAllowedPrompts(toolCall.input["allowedPrompts"]) : [];
	const status = describeExitPlanModeResult(result, toolCall.isError);
	const done = exitPlanModeState(result, toolCall.isError) === "approved";
	const planFileAction = planFile !== undefined && (
		<Link to="/plan/$filename" params={{filename: toMdSlug(planFile)}} className={PLAN_FILE_ACTION_CLASS}>
			{PLAN_FILE_ACTION_LABEL}
		</Link>
	);
	const verboseStatus = verbose === true && status !== null && status.tone !== "approved" ? status : null;

	return (
		<div className="flex w-full flex-col gap-1">
			{done ? (
				<div data-plan-done="" className="flex flex-col gap-1 py-1.5">
					<div className="flex items-center justify-between gap-2">
						<div className="flex items-center gap-1 text-body text-success-000">
							<CircleCheck aria-hidden="true" className="size-4 shrink-0" />
							{EXIT_PLAN_MODE_STATE_LABEL.approved}
						</div>
						{planFileAction}
					</div>
					{plan && (
						<div data-plan-block="" className={PLAN_BLOCK_CLASS}>
							{plan}
						</div>
					)}
				</div>
			) : (
				<>
					{planFileAction && <div className="flex items-center justify-end gap-2">{planFileAction}</div>}
					{plan && (
						<div data-plan-block="" className={`${PLAN_BLOCK_CLASS} py-1.5`}>
							{plan}
						</div>
					)}
				</>
			)}
			{allowedPrompts.length > 0 && (
				<div className="flex flex-col text-body text-secondary">
					{allowedPrompts.map((allowed, index) => (
						<div key={`${allowed.tool}-${index}`} data-allowed-prompt>
							<span className="text-primary">{allowed.tool}</span> — {allowed.prompt}
						</div>
					))}
				</div>
			)}
			{verboseStatus && (
				<div className={`text-body ${TONE_CLASS[verboseStatus.tone]}`}>
					<div>{verboseStatus.text}</div>
					{verboseStatus.detail && <div className="text-secondary">{verboseStatus.detail}</div>}
				</div>
			)}
		</div>
	);
}
