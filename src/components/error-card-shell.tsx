import {Gauge, TriangleAlert, X} from "lucide-react";
import type {ReactNode} from "react";

import {assertNever} from "../lib/assert-never";
import {type Density, useScopeDensity} from "./ui/density-context";

type ErrorCardIcon = "warning" | "gauge";

interface ErrorCardShellProps {
	headline: string;
	hint: string;
	icon: ErrorCardIcon;
	/** Upstream's `announce:"alert"`: a screen-reader-only alert reading "{headline} {hint}". */
	announce?: "alert";
	/** Shows the header's Dismiss X; leaving it out draws no button. */
	onDismiss?: () => void;
	/** Data attributes for the card root, so callers can tag it. */
	data?: Record<`data-${string}`, string>;
	/** Appends upstream's " Learn more" link to the hint. */
	learnMoreUrl?: string;
	/** A screen-reader-only live status in the hint row, e.g. the hint a recovery press swapped in. */
	status?: string;
	/** Upstream's options row after the hint, e.g. choice buttons; an empty row is hidden. */
	options?: ReactNode;
	/** Upstream's footnote after the hint (and options). */
	note?: ReactNode;
	/** Sets `aria-busy` on the card while an action it started is in flight. */
	busy?: boolean;
	/** Rows after the hint row, e.g. the View details disclosure. */
	children?: ReactNode;
}

const ICON_CLASS = "size-4 shrink-0 text-danger-000";

/*
 * Upstream's density tokens on the card: header `gap-md px-lg py-md`, Dismiss slot
 * `-me-pad-xs`, hint row `gap-md px-lg pt-lg pb-md last:pb-lg`. Under fizzy-lake `panels`
 * every scope is comfortable, so these resolve to the comfortable values.
 */
const SHELL_DENSITY: Record<Density, {gap: string; header: string; dismiss: string; hint: string}> = {
	compact: {gap: "gap-3", header: "px-3 py-2", dismiss: "-me-1", hint: "gap-3 px-3 pt-3 pb-2 last:pb-3"},
	comfortable: {gap: "gap-4", header: "px-4 py-3", dismiss: "-me-1.5", hint: "gap-4 px-4 pt-4 pb-3 last:pb-4"},
};

/** Upstream's ghost icon-only X (cds `tw` ghost, iconOnly): 24px, muted, lifting to primary on hover. */
export const GHOST_DISMISS_CLASS =
	"inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-r5 p-0 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus";

function CardIcon({icon}: {icon: ErrorCardIcon}): ReactNode {
	switch (icon) {
		case "warning":
			return <TriangleAlert aria-hidden="true" className={ICON_CLASS} />;
		case "gauge":
			return <Gauge aria-hidden="true" className={ICON_CLASS} />;
		default:
			return assertNever(icon);
	}
}

/**
 * Upstream's shared session error card (cb1a6e506 `B`): a tinted header with
 * the danger icon, headline and an optional Dismiss X, each slot centred on the
 * first line (`h-[1lh]`), then the hint row with optional options and note. Both rows contain their inline size, so the card holds its 480px
 * minimum and the hint wraps inside it. The card has no tab stop; the Dismiss
 * press keeps focus where it was (upstream prevents the mouse-down focus steal).
 */
export function ErrorCardShell({
	headline,
	hint,
	icon,
	announce,
	onDismiss,
	data,
	learnMoreUrl,
	status,
	options,
	note,
	busy = false,
	children,
}: ErrorCardShellProps) {
	const sizing = SHELL_DENSITY[useScopeDensity()];
	return (
		<div
			{...data}
			{...(busy ? {"aria-busy": true} : {})}
			className="card-outline-layer flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-card select-text"
		>
			{announce === "alert" && (
				<span className="sr-only" role="alert">
					{`${headline} ${hint}`}
				</span>
			)}
			<div className={`flex items-start ${sizing.gap} bg-alpha-1 ${sizing.header} text-body contain-inline-size`}>
				<span className="flex h-[1lh] shrink-0 items-center">
					<CardIcon icon={icon} />
				</span>
				<span className="min-w-0 grow text-primary break-words">{headline}</span>
				{onDismiss !== undefined && (
					<span className={`${sizing.dismiss} flex h-[1lh] shrink-0 items-center`}>
						<button
							type="button"
							aria-label="Dismiss"
							className={GHOST_DISMISS_CLASS}
							onMouseDown={(event) => {
								event.preventDefault();
							}}
							onClick={onDismiss}
						>
							<X aria-hidden="true" className="size-4" />
						</button>
					</span>
				)}
			</div>
			<div className={`flex flex-col ${sizing.hint} empty:hidden contain-inline-size`}>
				<span className="text-body text-secondary whitespace-pre-line break-words">
					{hint}
					{learnMoreUrl !== undefined && (
						<>
							{" "}
							<a
								href={learnMoreUrl}
								target="_blank"
								rel="noreferrer"
								className="underline hover:text-primary"
							>
								Learn more
							</a>
						</>
					)}
				</span>
				{options !== undefined && (
					<div className="flex flex-wrap items-center gap-1 empty:hidden">{options}</div>
				)}
				{note !== undefined && <span className="text-footnote text-secondary">{note}</span>}
				{status !== undefined && (
					<span role="status" className="sr-only">
						{status}
					</span>
				)}
			</div>
			{children}
		</div>
	);
}
