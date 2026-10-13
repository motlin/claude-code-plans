import {getHookContexts} from "./hook-context-store";
import {DOMAIN_EVENTS} from "./hook-events";
import {getLiveSubagentNodes} from "./live-subagent-store";
import type {SnapshotEvent} from "./shared-event-source";

/** The events a stream sends as soon as it connects, which a tab following another tab's stream fetches instead. */
export function connectEvents(): SnapshotEvent[] {
	return [
		{type: DOMAIN_EVENTS.SUBAGENTS_SNAPSHOT, data: JSON.stringify({subagents: getLiveSubagentNodes()})},
		...[...getHookContexts().values()].map((context) => ({
			type: DOMAIN_EVENTS.SESSION_HOOK_CONTEXT_CHANGED,
			data: JSON.stringify(context),
		})),
	];
}
