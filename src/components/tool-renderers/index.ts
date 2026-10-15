import {lazy, type ComponentType} from "react";
import type {ClientToolCall, ToolRendererProps} from "./types";
import {getMcpRenderer} from "./mcp-registry";
// Question cards are always visible, so they must not wait behind a blank lazy-loading fallback.
import {AskUserQuestionRenderer} from "./ask-user-question-renderer";

const EditRenderer = lazy(async () => import("./edit-renderer").then((m) => ({default: m.EditRenderer})));
const BashRenderer = lazy(async () => import("./bash-renderer").then((m) => ({default: m.BashRenderer})));
const ReadRenderer = lazy(async () => import("./read-renderer").then((m) => ({default: m.ReadRenderer})));
const WriteRenderer = lazy(async () => import("./write-renderer").then((m) => ({default: m.WriteRenderer})));
const GlobRenderer = lazy(async () => import("./glob-renderer").then((m) => ({default: m.GlobRenderer})));
const GrepRenderer = lazy(async () => import("./grep-renderer").then((m) => ({default: m.GrepRenderer})));
const AgentRenderer = lazy(async () => import("./agent-renderer").then((m) => ({default: m.AgentRenderer})));
const TaskChecklistRenderer = lazy(async () =>
	import("./task-checklist-renderer").then((m) => ({default: m.TaskChecklistRenderer})),
);
const ExitPlanModeRenderer = lazy(async () =>
	import("./exit-plan-mode-renderer").then((m) => ({
		default: m.ExitPlanModeRenderer,
	})),
);
const EnterPlanModeRenderer = lazy(async () =>
	import("./enter-plan-mode-renderer").then((m) => ({
		default: m.EnterPlanModeRenderer,
	})),
);
const WebSearchRenderer = lazy(async () =>
	import("./web-search-renderer").then((m) => ({
		default: m.WebSearchRenderer,
	})),
);
const SendMessageRenderer = lazy(async () =>
	import("./send-message-renderer").then((m) => ({
		default: m.SendMessageRenderer,
	})),
);
const CronCreateRenderer = lazy(async () =>
	import("./cron-create-renderer").then((m) => ({
		default: m.CronCreateRenderer,
	})),
);
const SkillRenderer = lazy(async () => import("./skill-renderer").then((m) => ({default: m.SkillRenderer})));
const WebFetchRenderer = lazy(async () => import("./webfetch-renderer").then((m) => ({default: m.WebFetchRenderer})));
const ToolSearchRenderer = lazy(async () =>
	import("./tool-search-renderer").then((m) => ({
		default: m.ToolSearchRenderer,
	})),
);
const ArtifactRenderer = lazy(async () => import("./artifact-renderer").then((m) => ({default: m.ArtifactRenderer})));
const ReportFindingsRenderer = lazy(async () =>
	import("./report-findings-renderer").then((m) => ({
		default: m.ReportFindingsRenderer,
	})),
);
const FallbackRenderer = lazy(async () => import("./fallback-renderer").then((m) => ({default: m.FallbackRenderer})));
const InvalidInputRenderer = lazy(async () =>
	import("./fallback-renderer").then((m) => ({default: m.InvalidInputRenderer})),
);

const registry: Record<string, ComponentType<ToolRendererProps>> = {
	Edit: EditRenderer,
	MultiEdit: EditRenderer,
	Bash: BashRenderer,
	Read: ReadRenderer,
	Write: WriteRenderer,
	Glob: GlobRenderer,
	Grep: GrepRenderer,
	AskUserQuestion: AskUserQuestionRenderer,
	Agent: AgentRenderer,
	TaskCreate: TaskChecklistRenderer,
	TaskUpdate: TaskChecklistRenderer,
	TaskGet: TaskChecklistRenderer,
	TaskList: TaskChecklistRenderer,
	ExitPlanMode: ExitPlanModeRenderer,
	EnterPlanMode: EnterPlanModeRenderer,
	TodoWrite: TaskChecklistRenderer,
	WebSearch: WebSearchRenderer,
	SendMessage: SendMessageRenderer,
	TaskStop: TaskChecklistRenderer,
	CronCreate: CronCreateRenderer,
	Skill: SkillRenderer,
	WebFetch: WebFetchRenderer,
	ToolSearch: ToolSearchRenderer,
	ReportFindings: ReportFindingsRenderer,
	Artifact: ArtifactRenderer,
	__fallback__: FallbackRenderer,
};

export function getToolRenderer(name: string): ComponentType<ToolRendererProps> {
	if (name.startsWith("mcp__")) {
		const server = name.slice(5).split("__")[0];
		if (server) return getMcpRenderer(server);
		return FallbackRenderer;
	}
	return registry[name] ?? FallbackRenderer;
}

/** The renderer for one call: its tool's own, or the raw input when the input failed the tool's schema. */
export function getCallRenderer(call: Pick<ClientToolCall, "name" | "invalidInput">): ComponentType<ToolRendererProps> {
	return call.invalidInput === true ? InvalidInputRenderer : getToolRenderer(call.name);
}

export type {ClientToolCall} from "./types";
