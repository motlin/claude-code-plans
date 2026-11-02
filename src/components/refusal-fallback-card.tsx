import {PreviewCard} from "@base-ui/react/preview-card";
import {useState} from "react";

import {formatModelName} from "../lib/model-name";
import type {RefusalFallback} from "../lib/refusal-fallback";
import {type RefusalOptOutView, useRefusalOptOut} from "../hooks/use-refusal-opt-out";
import {ApprovalActionButton} from "./approval-card";
import {useComposerNotice} from "./composer-notice-context";
import {NoticeBanner} from "./notice-banner";
import {COLLISION_PADDING, POPUP_CLASS} from "./session-hover-card-classes";

/** Upstream `Tv.flagged`, the Why card's copy when the runtime catalog has no per-category entry. */
export const REFUSAL_FLAGGED_COPY =
	"This model's safeguards flagged this message. This sometimes happens with safe, normal conversations.";

/** What the card needs from `useRefusalOptOut`. */
export interface RefusalOptOutBinding
{
	view: RefusalOptOutView;
	pending: boolean;
	optOut: () => void;
	openSettings: () => void;
}

function modelName(model: string): string
{
	return formatModelName(model) ?? model;
}

/**
 * Upstream's Why card (cf74bc599 `CO`/`FO`): a cds PreviewCard opening 200ms after hover or focus,
 * above and start-aligned, with the "Switched to" title, the flagged copy and, when the API sent one,
 * the raw refusal category.
 */
function WhyCard({fallback}: {fallback: RefusalFallback})
{
	const raw = fallback.apiRefusalCategoryRaw;
	return (
		<PreviewCard.Root>
			<PreviewCard.Trigger
				delay={200}
				render={<button type="button" data-cds="TextLink" />}
				className="cds-reset text-link shrink-0 text-body cursor-pointer"
			>
				Why
			</PreviewCard.Trigger>
			<PreviewCard.Portal>
				<PreviewCard.Positioner
					side="top"
					align="start"
					sideOffset={6}
					collisionPadding={COLLISION_PADDING}
					className="z-[130]"
				>
					<PreviewCard.Popup data-refusal-why-card="" className={`epitaxy-root ${POPUP_CLASS}`}>
						<span className="text-footnote font-medium text-secondary pb-1.5 comfortable:pb-2">
							Switched to {modelName(fallback.fallbackModel)}
						</span>
						<span className="text-pretty text-body text-muted-as-secondary break-words">
							{REFUSAL_FLAGGED_COPY}
						</span>
						{raw !== null && raw.trim() !== "" && (
							<span className="block text-body text-muted-as-secondary pt-1.5 comfortable:pt-2">
								Details: <code className="font-mono-ui break-all">[{raw}]</code>
							</span>
						)}
					</PreviewCard.Popup>
				</PreviewCard.Positioner>
			</PreviewCard.Portal>
		</PreviewCard.Root>
	);
}

/**
 * Upstream's refusal band as a notice-region card (cf74bc599 `xO` → `wO`, slot `refusal`, id
 * `model-switched`): after a live safeguards refusal moved the turn to a fallback model, "Switched to
 * {fallback} Why", with "Automatic switching is off." once the opt-out is off. Actions: escalated
 * (strike 2+) "Start a new session" on the streak's original model, else "Rewind and retry" when the
 * session can rewind, then the opt-out's "Don’t switch
 * models automatically" (busy while writing) or "Open settings". The X hides it for that fallback.
 */
export function RefusalFallbackNotice({
	fallback,
	optOut,
	onNewSession,
	onDismiss,
	onEditRetry,
}: {
	fallback: RefusalFallback | null;
	optOut: RefusalOptOutBinding;
	/** Starts a new session on the given model; undefined when the session's folder is unknown. */
	onNewSession?: ((model: string) => void) | undefined;
	onDismiss?: () => void;
	/** Upstream's `onEditPromptRetry` (refusal-edit-retry-rewind); undefined when the session can't rewind now. */
	onEditRetry?: (() => boolean) | undefined;
})
{
	const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
	const shown = fallback !== null && !dismissed.has(fallback.uuid) ? fallback : null;
	let notice = null;
	if (shown !== null)
	{
		const escalated = shown.strike >= 2;
		const newSession = escalated && onNewSession !== undefined;
		const editRetry = escalated ? undefined : onEditRetry;
		const hasAction = newSession || editRetry !== undefined || optOut.view !== "hidden";
		notice =
		{
			id: "model-switched",
			content: (
				<NoticeBanner
					icon={null}
					data-testid="code-refusal-card"
					onDismiss={() =>
					{
						setDismissed((previous) => new Set([...previous, shown.uuid]));
						onDismiss?.();
					}}
					action={
						hasAction ? (
							<div className="flex min-w-0 flex-wrap items-center gap-xs">
								{newSession && (
									<ApprovalActionButton
										variant="secondary"
										onClick={() =>
										{
											onNewSession(shown.streakOriginalModel);
										}}
									>
										Start a new session
									</ApprovalActionButton>
								)}
								{editRetry !== undefined && (
									<ApprovalActionButton
										variant="secondary"
										onClick={() =>
										{
											editRetry();
										}}
									>
										Rewind and retry
									</ApprovalActionButton>
								)}
								{optOut.view === "offer" && (
									<ApprovalActionButton
										variant="secondary"
										busy={optOut.pending}
										onClick={optOut.optOut}
									>
										Don’t switch models automatically
									</ApprovalActionButton>
								)}
								{optOut.view === "off" && (
									<ApprovalActionButton variant="secondary" onClick={optOut.openSettings}>
										Open settings
									</ApprovalActionButton>
								)}
							</div>
						) : undefined
					}
				>
					<span aria-atomic="true" className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.75">
						<span className="min-w-0">
							Switched to {modelName(shown.fallbackModel)} <WhyCard fallback={shown} />
						</span>
						{optOut.view === "off" && (
							<span className="min-w-0 text-secondary">Automatic switching is off.</span>
						)}
					</span>
				</NoticeBanner>
			),
		};
	}
	const claimed = useComposerNotice("refusal", notice);
	return claimed ? null : (notice?.content ?? null);
}

interface BandProps
{
	sessionId: string;
	onNewSession?: ((model: string) => void) | undefined;
	onEditRetry?: (() => boolean) | undefined;
}

function BoundRefusalFallbackNotice({
	sessionId,
	fallback,
	onNewSession,
	onEditRetry,
}: BandProps &
{
	fallback: RefusalFallback;
})
{
	const optOut = useRefusalOptOut(sessionId);
	return (
		<RefusalFallbackNotice
			fallback={fallback}
			optOut={optOut}
			onNewSession={onNewSession}
			onEditRetry={onEditRetry}
		/>
	);
}

/**
 * The session page's refusal band: it reads the CLI's settings.json for the opt-out only while a live
 * fallback is showing, so opening a session costs no settings fetch.
 */
export function RefusalFallbackBand({
	sessionId,
	fallback,
	onNewSession,
	onEditRetry,
}: BandProps &
{
	fallback: RefusalFallback | null;
})
{
	return fallback === null ? null : (
		<BoundRefusalFallbackNotice
			sessionId={sessionId}
			fallback={fallback}
			onNewSession={onNewSession}
			onEditRetry={onEditRetry}
		/>
	);
}
