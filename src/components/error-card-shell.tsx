import {Gauge, TriangleAlert, X} from "lucide-react";
import type {ReactNode} from "react";

import {assertNever} from "../lib/assert-never";

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
	/** Rows after the hint row, e.g. the View details disclosure. */
	children?: ReactNode;
}

const ICON_CLASS = "size-4 shrink-0 text-danger-000";

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
 * Upstream's shared session error card (cb1a6e506 export `t`): a tinted
 * header with the danger icon, headline and an optional Dismiss X, then the
 * hint row. Both rows contain their inline size, so the card holds its 480px
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
	children,
}: ErrorCardShellProps) {
	return (
		<div
			{...data}
			className="card-outline-layer flex w-fit min-w-[min(480px,100%)] max-w-full flex-col overflow-clip rounded-card select-text"
		>
			{announce === "alert" && (
				<span className="sr-only" role="alert">
					{`${headline} ${hint}`}
				</span>
			)}
			<div className="flex items-center gap-3 bg-alpha-1 px-3 py-2 contain-inline-size">
				<CardIcon icon={icon} />
				<span className="min-w-0 grow text-body text-primary break-words">{headline}</span>
				{onDismiss !== undefined && (
					<span className="-my-1 -me-1 flex shrink-0">
						<button
							type="button"
							aria-label="Dismiss"
							className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-r5 p-0 text-ink-muted transition-colors hover:bg-fill-ghost-hover hover:text-primary hide-focus-ring focus-visible:outline-hidden focus-visible:shadow-focus"
							onMouseDown={(event) => {
								event.preventDefault();
							}}
							onClick={onDismiss}
						>
							<X aria-hidden="true" className="size-5" />
						</button>
					</span>
				)}
			</div>
			<div className="flex flex-col gap-3 px-3 pt-3 pb-2 last:pb-3 empty:hidden contain-inline-size">
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
