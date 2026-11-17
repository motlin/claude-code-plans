import type {BackgroundTask} from "./background-tasks";
import {asRecord} from "./narrow";

/**
 * How many running background tasks the CLI's kill-agents chord (`chat:killAgents`, ctrl+x ctrl+k twice)
 * would stop: the local stand-in for upstream's running nested sessions (`Swe`). The CLI stops async
 * subagents and workflow agents; Bash, Monitor and other tasks keep running, so they don't count. A
 * workflow counts once, like one nested session, however many agents it runs.
 */
export function nestedStopCount(running: readonly Pick<BackgroundTask, "kind" | "status">[]): number
{
	return running.filter((task) => task.status === "running" && (task.kind === "agent" || task.kind === "workflow"))
		.length;
}

export interface NestedStopLabels
{
	/** The face's accessible name and tooltip (upstream `stopNested`). */
	label: string;
	/** The busy face's accessible name (upstream `stoppingNested`). */
	stoppingLabel: string;
	/** The info toast after a stop (upstream `nestedStopped`). */
	stopped: string;
	/** The error toast when some keep running (upstream `nestedNotStopped`). */
	notStopped: string;
	/** The error toast when the request fails (upstream `stopNestedFailed`). */
	failed: string;
}

/**
 * Upstream's nested-stop strings, in the CLI's own words: its hint reads "stop background agents", and
 * locally "nested sessions" already means forks in the sidebar.
 */
export function nestedStopLabels(count: number): NestedStopLabels
{
	const agents = count === 1 ? "1 background agent" : `${count} background agents`;
	return {
		label: `Stop ${agents}`,
		stoppingLabel: "Stopping background agents…",
		stopped: `Stopped ${agents}.`,
		notStopped: `${agents} couldn’t be stopped. Try again.`,
		failed: "Background agents couldn’t be stopped. Try again.",
	};
}

/**
 * The id of the transcript's newest `agents_killed` record (the CLI's "All background agents stopped"),
 * or null when there is none: a new id after a stop is the CLI confirming it.
 */
export function latestAgentsKilledId(records: readonly unknown[]): string | null
{
	for (let index = records.length - 1; index >= 0; index--)
	{
		const record = asRecord(records[index]);
		if (record?.["type"] !== "system" || record["subtype"] !== "agents_killed") continue;
		const uuid = record["uuid"];
		return typeof uuid === "string" ? uuid : `index:${index}`;
	}
	return null;
}
