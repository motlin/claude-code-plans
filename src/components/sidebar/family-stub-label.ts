import type {SessionBucket} from "../../lib/session-state";

export interface FamilyStubTally
{
	count: number;
	waiting: number;
	failed: number;
	unread: number;
	working: number;
}

interface TallyRow
{
	bucket: SessionBucket;
	session:
	{
		unseen: boolean;
		unseenError?: true | undefined;
	};
}

/**
 * Upstream `KI`: each hidden row counts once, as failed, else waiting (upstream `d4`: a Blocked row
 * without an unseen error), else unread, else working.
 */
export function familyStubTally(rows: readonly TallyRow[]): FamilyStubTally
{
	const tally: FamilyStubTally =
	{
		count: rows.length,
		waiting: 0,
		failed: 0,
		unread: 0,
		working: 0,
	};
	for (const row of rows)
	{
		if (row.session.unseenError === true) tally.failed += 1;
		else if (row.bucket === "blocked") tally.waiting += 1;
		else if (row.session.unseen) tally.unread += 1;
		else if (row.bucket === "working") tally.working += 1;
	}
	return tally;
}

export interface FamilyStubLabel
{
	/** Upstream `hiddenCountShort` / `hiddenMoreCountShort`: the visible count. */
	label: string;
	/** Upstream `aP` long count words, kept for the aria label. */
	sessions: string;
	segments:
	{
		waiting: string | undefined;
		failed: string | undefined;
		unread: string | undefined;
		working: string | undefined;
	};
	ariaLabel: string;
}

const NEWS_FORMAT = new Intl.ListFormat(
	"en",
	{
		type: "unit",
	},
);

function segment(count: number, word: string): string | undefined
{
	return count > 0 ? `${count} ${word}` : undefined;
}

/** Upstream `bD` count words, `Xf` segments and `qY` aria label, in upstream `hN` segment order. */
export function familyStubLabel(tally: FamilyStubTally, someListed: boolean): FamilyStubLabel
{
	const label = `${tally.count} ${someListed ? "more " : ""}nested`;
	const sessions = `${tally.count} ${someListed ? "more " : ""}nested session${tally.count === 1 ? "" : "s"}`;
	const segments =
	{
		waiting: segment(tally.waiting, tally.waiting === 1 ? "needs input" : "need input"),
		failed: segment(tally.failed, "failed"),
		unread: segment(tally.unread, "unread"),
		working: segment(tally.working, "working"),
	};
	const news = [segments.waiting, segments.failed, segments.unread, segments.working].filter(
		(text) => text !== undefined,
	);
	return {
		label,
		sessions,
		segments,
		ariaLabel: news.length === 0 ? `Show ${sessions}` : `Show ${sessions}, ${NEWS_FORMAT.format(news)}`,
	};
}
