import type {SessionBucket} from "../../lib/session-state";

export interface FamilyStubTally
{
	count: number;
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

/** Upstream `$w`: each hidden row counts once, as failed, else unread, else working. */
export function familyStubTally(rows: readonly TallyRow[]): FamilyStubTally
{
	const tally: FamilyStubTally =
	{
		count: rows.length,
		failed: 0,
		unread: 0,
		working: 0,
	};
	for (const row of rows)
	{
		if (row.session.unseenError === true) tally.failed += 1;
		else if (row.session.unseen) tally.unread += 1;
		else if (row.bucket === "working") tally.working += 1;
	}
	return tally;
}

export interface FamilyStubLabel
{
	sessions: string;
	segments:
	{
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

/** Upstream `bD` count words, `h4` segments and `WX` aria label. */
export function familyStubLabel(tally: FamilyStubTally, someListed: boolean): FamilyStubLabel
{
	const sessions = `${tally.count} ${someListed ? "more " : ""}nested session${tally.count === 1 ? "" : "s"}`;
	const segments =
	{
		failed: segment(tally.failed, "failed"),
		unread: segment(tally.unread, "unread"),
		working: segment(tally.working, "working"),
	};
	const news = [segments.failed, segments.unread, segments.working].filter((text) => text !== undefined);
	return {
		sessions,
		segments,
		ariaLabel: news.length === 0 ? `Show ${sessions}` : `Show ${sessions}, ${NEWS_FORMAT.format(news)}`,
	};
}
