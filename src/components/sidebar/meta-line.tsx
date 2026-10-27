import type {SessionMetaLine} from "../../lib/session-meta-line";

const ITEM_CLASS = "shrink-0 whitespace-nowrap";
const LIST_FORMAT = new Intl.ListFormat("en", {type: "unit"});

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
					<bdi className={ITEM_CLASS}>{first}</bdi>
				</span>
			)}
			{second !== undefined && <bdi className={ITEM_CLASS}>{second}</bdi>}
		</span>
	);
}
