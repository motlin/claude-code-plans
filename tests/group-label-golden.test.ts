import specimens from "./fixtures/group-label-specimens.json";
import {summarizeToolCallStats, type BackgroundCompletionLike, type ToolCallLike} from "../src/lib/session-utils";

/**
 * Tool-only groups whose header text was read from live claude.ai/code DOM
 * (wave 60), with the calls behind each one pulled from the session JSONL.
 */
interface Specimen {
	session: string;
	line: number;
	upstream: string;
	calls: ToolCallLike[];
	completions?: BackgroundCompletionLike[];
	/** Agent messages folded into the group, before and after its tools. */
	received?: {leading: number; trailing: number};
	/** Why the local label cannot match yet. */
	skip?: string;
}

function label(specimen: Specimen): string {
	return summarizeToolCallStats(specimen.calls, specimen.completions, new Set(), specimen.received)
		.segments.map((segment) => (segment.rest ? `${segment.verb} ${segment.rest}` : segment.verb))
		.join(", ");
}

const all = specimens as Specimen[];

describe("group label golden specimens", () => {
	it.each(all.filter((specimen) => specimen.skip === undefined))("$session:$line reads $upstream", (specimen) => {
		expect(label(specimen)).toBe(specimen.upstream);
	});

	it.skip.each(all.filter((specimen) => specimen.skip !== undefined))("$session:$line ($skip)", (specimen) => {
		expect(label(specimen)).toBe(specimen.upstream);
	});
});
