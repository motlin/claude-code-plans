import type {MetaStatus, SessionMetaLine} from "../../lib/session-meta-line";
import {TOUCH_QUERY} from "../../lib/touch-reveal";
import {useMediaQuery} from "../../lib/use-phone-sheet";
import {Tooltip} from "../ui/tooltip";

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

/** Whether the slots box clips its items, the only case upstream's tooltip-mode line opens its tip. */
function slotsOverflow(anchor: HTMLElement): boolean
{
	const slots = anchor.firstElementChild;
	return slots !== null && slots.scrollWidth > slots.clientWidth;
}

/**
 * A described row's second line (upstream `gM`): the status word and message, then the place. With
 * `overflowTooltip` (upstream's `u`: a hover-capable device, and no awaiting row's card live over the row) the
 * list moves from the native title to a tooltip that opens only while the slots overflow.
 */
export function MetaLine({line, overflowTooltip = false}: {line: SessionMetaLine; overflowTooltip?: boolean})
{
	const {word, text, place} = line;
	const wordLabel = word === undefined ? undefined : STATUS_WORDS[word];
	const title = LIST_FORMAT.format([wordLabel, text, place?.text].filter((item) => item !== undefined));
	// Upstream hides the line when nothing in it would be spoken: a non-Idle word is in the row's sr text already.
	const silent = word !== "idle" && text === undefined && place?.spoken !== true;
	const touch = useMediaQuery(TOUCH_QUERY);
	const tooltipMode = overflowTooltip && !touch;
	const slots = (
		<span
			className="df-meta-slots flex min-w-0 flex-1 items-center gap-2 text-ink-muted"
			title={tooltipMode ? undefined : title}
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
	if (!tooltipMode) return slots;
	return (
		<Tooltip
			portal
			side="right"
			openWhen={slotsOverflow}
			className="flex min-w-0 flex-1"
			content={
				<span className="min-w-0 break-words">
					<span dir="auto" className="block">
						{title}
					</span>
				</span>
			}
		>
			{slots}
		</Tooltip>
	);
}
