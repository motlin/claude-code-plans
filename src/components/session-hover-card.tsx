import {PreviewCard} from "@base-ui/react/preview-card";
import {
	createContext,
	lazy,
	Suspense,
	useContext,
	useId,
	type ComponentProps,
	type ReactElement,
	type ReactNode,
} from "react";

import {
	CLOSE_DELAY_MS,
	COLLISION_PADDING,
	POPUP_CLASS,
	SESSION_HOVER_CARD,
	type HoverCardKind,
} from "./session-hover-card-classes";
import {useDensity} from "./ui/density";
import {AwaitingBodySkeleton} from "./session-awaiting-skeleton";

type PositionerProps = ComponentProps<typeof PreviewCard.Positioner>;

// The awaiting card (its reads, question chips, reply box, markdown stripping) loads with the first Needs input card.
const AwaitingPopup = lazy(async () =>
	import("./session-awaiting-body").then((module) => ({default: module.AwaitingPopup})),
);

interface SessionHoverCardProps {
	sessionId: string;
	title: string;
	summary: string | null;
	/** The CLI's AI title, shown under a renamed title; null hides the line. */
	aiTitle?: string | null;
	/** Needs input: the card offers quick reply and approval controls. */
	blocked: boolean;
	/** The row element that triggers the card; `children` render inside it. */
	render: ReactElement<Record<string, unknown>>;
	side?: PositionerProps["side"];
	align?: PositionerProps["align"];
	children: ReactNode;
}

/**
 * Upstream's sidebar session hover card. After 400ms a Needs input row shows a
 * 440px card that answers what the session waits on, taking the pointer only
 * when it can answer in place; after 500ms any other row with a summary shows
 * a 340px card. Rows with nothing to show get no card.
 */
export function SessionHoverCard({
	sessionId,
	title,
	summary,
	aiTitle = null,
	blocked,
	render,
	side = "inline-end",
	align = "center",
	children,
}: Readonly<SessionHoverCardProps>) {
	const titleId = useId();
	const kind: HoverCardKind = blocked ? "blocked" : "other";
	const {delay, width} = SESSION_HOVER_CARD[kind];
	const showsCard = blocked || summary !== null || aiTitle !== null;
	const density = useDensity();
	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger render={render} data-hover-card-trigger="" delay={delay} closeDelay={CLOSE_DELAY_MS}>
				{children}
			</PreviewCard.Trigger>
			{showsCard && (
				<PreviewCard.Portal>
					<PreviewCard.Positioner
						side={side}
						align={align}
						collisionPadding={COLLISION_PADDING}
						data-density={density}
						className="z-[100]"
					>
						{blocked ? (
							<BlockedPopupContext.Provider value={titleId}>
								<Suspense
									fallback={
										<BlockedPopup interactive={false}>
											<AwaitingBodySkeleton title={title} titleId={titleId} />
										</BlockedPopup>
									}
								>
									<AwaitingPopup
										sessionId={sessionId}
										title={title}
										titleId={titleId}
										summary={summary}
										shell={BlockedPopup}
									/>
								</Suspense>
							</BlockedPopupContext.Provider>
						) : (
							<PreviewCard.Popup
								data-session-hover-card
								data-kind={kind}
								role="group"
								aria-labelledby={titleId}
								tabIndex={-1}
								className={`${POPUP_CLASS} ${width}`}
							>
								<SummaryBody title={title} titleId={titleId} aiTitle={aiTitle} summary={summary} />
							</PreviewCard.Popup>
						)}
					</PreviewCard.Positioner>
				</PreviewCard.Portal>
			)}
		</PreviewCard.Root>
	);
}

/** The Needs input card's title id, for the popup's `aria-labelledby`. */
const BlockedPopupContext = createContext("");

/** The 440px Needs input popup; the pointer passes through it unless it can answer in place. */
function BlockedPopup({interactive, children}: {interactive: boolean; children: ReactNode}) {
	const titleId = useContext(BlockedPopupContext);
	return (
		<PreviewCard.Popup
			data-session-hover-card
			data-kind="blocked"
			{...(interactive ? {"data-interactive": ""} : {})}
			role="group"
			aria-labelledby={titleId}
			tabIndex={-1}
			className={`${POPUP_CLASS} ${SESSION_HOVER_CARD.blocked.width} ${interactive ? "" : "pointer-events-none"}`}
		>
			{children}
		</PreviewCard.Popup>
	);
}

/** Upstream's summary card: the title, then the session's summary. */
function SummaryBody({
	title,
	titleId,
	aiTitle,
	summary,
}: {
	title: string;
	titleId: string;
	aiTitle: string | null;
	summary: string | null;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col">
				<span id={titleId} data-card-title className="line-clamp-2 text-[15px]/[20px] font-[580] text-primary">
					{title}
				</span>
				{aiTitle !== null && (
					<span data-card-ai-title className="line-clamp-2 text-ink-muted">
						{aiTitle}
					</span>
				)}
			</div>
			{summary !== null && (
				<div className="flex flex-col gap-1">
					<div data-card-summary className="break-words text-pretty text-primary">
						{summary}
					</div>
				</div>
			)}
		</div>
	);
}
