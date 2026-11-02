import type {MetaStatus, SessionMetaLine} from "../../lib/session-meta-line";

const ITEM_CLASS = "shrink-0 whitespace-nowrap";
const LIST_FORMAT = new Intl.ListFormat(
	"en",
	{
		type: "unit",
	},
);

/** Upstream's status words (`LH`/`kx`): an unread row reads "Done", a blocked one "Waiting". */
const STATUS_WORDS =
{
	idle: "Idle",
	unread: "Done",
	working: "Working",
	blocked: "Waiting",
	error: "Error",
} satisfies Record<MetaStatus, string>;

/** A described row's second line (upstream `gM`): the status word and message, then the place. */
export function MetaLine({line}: {line: SessionMetaLine})
{
	const {word, text, place} = line;
	const wordLabel = word === undefined ? undefined : STATUS_WORDS[word];
	const title = LIST_FORMAT.format([wordLabel, text, place?.text].filter((item) => item !== undefined));
	// Upstream hides the line when nothing in it would be spoken: a non-Idle word is in the row's sr text already.
	const silent = word !== "idle" && text === undefined && place?.spoken !== true;
	return (
		<span
			className="df-meta-slots flex min-w-0 flex-1 items-center gap-2 text-ink-muted"
			title={title}
			aria-hidden={silent ? "true" : undefined}
		>
			<span className="df-meta-line flex min-w-0 flex-1 items-center gap-2">
				{wordLabel !== undefined && (
					<span
						className={word === "blocked" ? `${ITEM_CLASS} text-upstream-warning` : ITEM_CLASS}
						aria-hidden={word === "idle" ? undefined : "true"}
					>
						{wordLabel}
					</span>
				)}
				{text !== undefined && <bdi className={ITEM_CLASS}>{text}</bdi>}
			</span>
			{place !== undefined && (
				<bdi
					className="df-meta-place shrink-0 whitespace-nowrap"
					aria-hidden={place.spoken ? undefined : "true"}
				>
					{place.text}
				</bdi>
			)}
		</span>
	);
}
