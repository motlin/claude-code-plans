import {Link} from "@tanstack/react-router";
import {ChevronRight, Folder, MessageSquare} from "lucide-react";
import {useState} from "react";

import type {PlanLink} from "../lib/api/plans";
import {nonEmpty} from "../lib/non-empty";
import {formatCount} from "../lib/pluralize";
import {formatNarrowRelativeTime} from "../lib/relative-time";
import {RAIL_CARD_CLASS, RAIL_ROW_ACTION_CLASS, RailRowContent} from "./session-rail/rail-row";

export type PlanContextLink = PlanLink;

/** More sessions than this fold behind an "N sessions" disclosure. */
const SESSIONS_SHOWN = 3;

interface ProjectGroup {
	project: string;
	label: string;
	sessions: PlanContextLink[];
}

function modifiedMs(link: PlanContextLink): number {
	return link.sessionModified === null ? Number.NEGATIVE_INFINITY : Date.parse(link.sessionModified);
}

/** Projects in order of their newest session, each with its sessions newest first. */
function groupByProject(links: readonly PlanContextLink[]): ProjectGroup[] {
	const groups = new Map<string, ProjectGroup>();
	for (const link of links.toSorted((a, b) => modifiedMs(b) - modifiedMs(a))) {
		let group = groups.get(link.project);
		if (group === undefined) {
			group = {
				project: link.project,
				label: link.projectDir ?? link.projectName,
				sessions: [],
			};
			groups.set(link.project, group);
		}
		group.sessions.push(link);
	}
	return [...groups.values()];
}

/**
 * The plan page's context: where the plan was written and by which sessions, in the session rail's
 * card and row idiom — a folder row per project directory, then a row per session with upstream's
 * relative time, folded to "N sessions" past three. Nothing renders when no session links the plan.
 */
export function PlanContextHeader({links, now}: {links: readonly PlanContextLink[]; now: number}) {
	if (links.length === 0) return null;
	return (
		<section data-testid="plan-context" aria-label="Plan context" className={RAIL_CARD_CLASS}>
			<div className="flex flex-col px-2">
				{groupByProject(links).map((group) => (
					<ProjectRows key={group.project} group={group} now={now} />
				))}
			</div>
		</section>
	);
}

function ProjectRows({group, now}: {group: ProjectGroup; now: number}) {
	const [expanded, setExpanded] = useState(false);
	const folded = group.sessions.length > SESSIONS_SHOWN;
	return (
		<>
			<Link
				to="/project/$id"
				params={{id: group.project}}
				title={group.label}
				className={`${RAIL_ROW_ACTION_CLASS} no-underline`}
			>
				<RailRowContent icon={<Folder aria-hidden />} label={group.label} />
			</Link>
			{folded && (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => {
						setExpanded((open) => !open);
					}}
					className={RAIL_ROW_ACTION_CLASS}
				>
					<RailRowContent
						icon={
							<ChevronRight
								aria-hidden
								className={`transition-transform ${expanded ? "rotate-90" : ""}`}
							/>
						}
						label={formatCount(group.sessions.length, "session")}
					/>
				</button>
			)}
			{(!folded || expanded) &&
				group.sessions.map((link) => (
					<Link
						key={link.sessionId}
						to="/session/$id"
						params={{id: link.sessionId}}
						className={`${RAIL_ROW_ACTION_CLASS} no-underline`}
					>
						<RailRowContent
							icon={<MessageSquare aria-hidden />}
							label={nonEmpty(link.sessionTitle) ?? "Untitled session"}
							{...(link.sessionModified === null
								? {}
								: {hint: formatNarrowRelativeTime(Date.parse(link.sessionModified), now)})}
						/>
					</Link>
				))}
		</>
	);
}
