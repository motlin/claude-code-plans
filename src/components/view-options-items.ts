import type {LucideIcon} from "lucide-react";
import type {ShortcutId} from "../lib/shortcuts/registry";
import {AppWindow, GitFork, Info, Link2, ListChecks, SquareTerminal} from "lucide-react";
import type {PaneKind} from "../lib/pane-layout";

/**
 * The View options items after any folded toggles: a registered pane shows
 * when it applies to the session or is already open, like upstream.
 */
export function viewOptionsItems({
	registered,
	isOpen,
	facts,
}: {
	registered: ReadonlySet<PaneKind>;
	isOpen: (kind: PaneKind) => boolean;
	facts: ViewOptionsFacts;
}): ViewOptionsItem[] {
	return candidates(facts)
		.filter((item) => registered.has(item.kind) && (item.applies || isOpen(item.kind)))
		.map(({applies: _applies, ...item}) => item);
}

/** What the session offers, deciding which View options items apply. */
export interface ViewOptionsFacts {
	artifactCount?: number;
	/** The session has a plan for the Plan pane: a linked plan file, plan text, a plan-file edit or todos. */
	hasPlan?: boolean;
	backgroundTasks?: {total: number; running: number};
	subagentCount?: number;
}

export interface ViewOptionsItem extends PaneMenuEntry {
	/** Running-count badge (Background tasks). */
	badge?: number;
}

function candidates(facts: ViewOptionsFacts): ViewOptionsCandidate[] {
	const running = facts.backgroundTasks?.running ?? 0;
	return [
		{kind: "terminal", label: "Terminal", icon: SquareTerminal, shortcut: "toggle_terminal", applies: true},
		{
			kind: "artifacts",
			label: "Artifacts",
			icon: AppWindow,
			applies: (facts.artifactCount ?? 0) > 0,
		},
		{kind: "links", label: "Links", icon: Link2, applies: true},
		{
			kind: "background-tasks",
			label: "Background tasks",
			icon: ListChecks,
			applies: (facts.backgroundTasks?.total ?? 0) > 0,
			...(running > 0 ? {badge: running} : {}),
		},
		{kind: "plan", label: "Plan", icon: ListChecks, applies: facts.hasPlan === true},
		{
			kind: "subagents",
			label: "Subagents",
			icon: GitFork,
			applies: (facts.subagentCount ?? 0) > 0,
		},
		{kind: "session-details", label: "Session details", icon: Info, applies: true},
	];
}

export interface PaneMenuEntry {
	kind: PaneKind;
	label: string;
	icon: LucideIcon;
	shortcut?: ShortcutId;
}

interface ViewOptionsCandidate extends ViewOptionsItem {
	applies: boolean;
}
