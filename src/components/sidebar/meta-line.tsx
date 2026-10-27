import {GitBranch} from "lucide-react";
import type {SessionMetaLine} from "../../lib/session-meta-line";
import {PrTailGlyph} from "../status-dot";

const ITEM_CLASS = "shrink-0 whitespace-nowrap";
const LIST_FORMAT = new Intl.ListFormat("en", {type: "unit"});

/** The glyph leading a place line: the PR state when there is one, else a branch mark when there's a branch. */
function PlaceGlyph({line}: {line: Extract<SessionMetaLine, {kind: "place"}>}) {
	if (line.pr !== undefined) return <PrTailGlyph state={line.pr} place="line" />;
	if (line.branch === undefined) return null;
	return <GitBranch aria-hidden="true" data-branch-glyph="" className="size-3 shrink-0 text-ink-muted" />;
}

/** A described row's second line (upstream `gM`): the blocked word and reason, or branch then folder. */
export function MetaLine({line}: {line: SessionMetaLine}) {
	const items = (
		line.kind === "blocked" ? [line.word ? "Blocked" : undefined, line.reason] : [line.branch, line.folder]
	).filter((item) => item !== undefined);
	const [first, second] = items;
	return (
		<span
			className="df-meta-line flex min-w-0 flex-1 items-center gap-2 text-ink-muted"
			title={LIST_FORMAT.format(items)}
		>
			{line.kind === "blocked" && line.word ? (
				<span aria-hidden="true" className={`${ITEM_CLASS} text-upstream-warning`}>
					{first}
				</span>
			) : (
				<span className="flex shrink-0 items-center gap-1">
					{line.kind === "place" && <PlaceGlyph line={line} />}
					<bdi className={ITEM_CLASS}>{first}</bdi>
				</span>
			)}
			{second !== undefined && <bdi className={ITEM_CLASS}>{second}</bdi>}
		</span>
	);
}
