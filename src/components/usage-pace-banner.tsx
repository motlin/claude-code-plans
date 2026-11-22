import {useQuery} from "@tanstack/react-query";
import {Gauge, X} from "lucide-react";
import {usageQueryOptions} from "../lib/api/usage";
import type {MouseEvent, ReactElement, ReactNode} from "react";
import {useNow} from "../hooks/use-now";
import {heldCountText, parkedNoticeMessage, parkedResetDetail} from "../lib/parked-prompts";
import {formatPaceBannerReset, limitReached, meterPercent, usageBand} from "../lib/usage";
import {NoticeBanner} from "./notice-banner";
import {cdsButtonClass} from "./ui/cds-button";
import {Icon} from "./ui/icon";
import {Spinner} from "./ui/spinner";
import {ResetCountdown} from "./reset-countdown";
import {useComposerNotice, useInNoticeRegion} from "./composer-notice-context";
import {useUsageBandDismissals, writeUsageBandDismissal} from "../lib/usage-pace-dismissal";

/**
 * Upstream's band shell (`uc`): an icon slot, a wrapping body whose words put the headline and
 * detail on one baseline 10px apart (the detail wrapping under it on a narrow dock), and an
 * optional Dismiss slot. Live region `polite`, centred on the first line via `1lh`. The exceeded
 * band inks its icon and headline `danger`; the detail is always muted. Under a notice region the
 * band draws as a cds Banner card instead: a cds UsageGauge glyph (Middle approaching, High reached) and
 * a `text-muted-as-secondary` detail.
 */
function UsageBandShell({
	headline,
	detail,
	danger = false,
	actions,
	onDismiss,
}: {
	headline: string;
	detail: ReactNode;
	danger?: boolean;
	actions?: ReactNode;
	onDismiss?: () => void;
})
{
	// Inside the notice region the band is a cds Banner card (upstream `vr` → `tF` → `ah`): its
	// list is the live region and its item reveals in, and the card inks nothing danger. Upstream `ir`
	// test ids: the reached card, else the approaching one.
	if (useInNoticeRegion())
	{
		return (
			<NoticeBanner
				icon={
					<Icon
						name={danger ? "UsageGaugeHigh" : "UsageGaugeMiddle"}
						size="auto"
						data-testid="usage-limit-card-gauge"
					/>
				}
				data-testid={danger ? "usage-limit-reached-card" : "usage-limit-approaching-card"}
				{...(actions === undefined
					? {}
					:
						{
							action: actions,
						})}
				{...(onDismiss
					?
						{
							onDismiss,
						}
					: {})}
			>
				<span aria-atomic="true" className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.75">
					<span className="min-w-0">{headline}</span>
					<span className="min-w-0 text-muted-as-secondary">{detail}</span>
				</span>
			</NoticeBanner>
		);
	}
	return (
		<BandShell
			icon={<Gauge className={`size-4 ${danger ? "text-danger-000" : "text-ink-muted"}`} aria-hidden="true" />}
			{...(actions === undefined
				? {}
				:
					{
						actions,
					})}
			{...(onDismiss
				?
					{
						onDismiss,
					}
				: {})}
		>
			<span className={`min-w-0 ${danger ? "text-danger-000" : "text-primary"}`}>{headline}</span>
			<span className="min-w-0 text-ink-muted">{detail}</span>
		</BandShell>
	);
}

const BAND_SHELL_CLASS =
	"flex gap-[5px] w-full min-h-[40px] p-[8px] rounded-r7 bg-alpha-1 items-start py-[calc((40px-1lh)/2)] text-body usage-band-enter";

/**
 * Upstream's composer band shell (`ar` → `Kd`) drawn inline: an icon slot (none for a notice band with no icon), a
 * wrapping body whose words share one baseline, an optional actions group that wraps under the words on a narrow
 * dock, and an optional Dismiss slot.
 */
export function BandShell({
	icon,
	children,
	actions,
	onDismiss,
	className,
}: {
	icon: ReactNode | null;
	children: ReactNode;
	actions?: ReactNode;
	onDismiss?: () => void;
	className?: string;
})
{
	return (
		<div
			role="status"
			aria-live="polite"
			className={className === undefined ? BAND_SHELL_CLASS : `${BAND_SHELL_CLASS} ${className}`}
		>
			{icon !== null && <span className="flex h-[1lh] shrink-0 items-center">{icon}</span>}
			<div className="flex min-w-0 flex-1 flex-wrap gap-x-[8px] gap-y-[8px] items-start">
				<div className="min-w-0 max-w-full flex-auto">
					<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.75">{children}</div>
				</div>
				{actions !== undefined && (
					<div className="flex min-w-0 max-w-full shrink-0 flex-wrap items-start gap-x-[8px] gap-y-[8px]">
						{actions}
					</div>
				)}
			</div>
			{onDismiss !== undefined && (
				<span className="ms-1.25 flex h-[1lh] shrink-0 items-center">
					<button
						type="button"
						aria-label="Dismiss"
						onClick={onDismiss}
						className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-alpha-1 hover:text-primary cursor-pointer"
					>
						<X className="size-3.5" aria-hidden="true" />
					</button>
				</span>
			)}
		</div>
	);
}

export interface ParkedNoticeBandProps
{
	willAutoSend: boolean;
	/** The window's reset, epoch seconds; the detail shows only while it is ahead. */
	resetsAt: number | undefined;
	archived: boolean;
	/** A flush is running: Send anyway is busy. */
	flushing: boolean;
	onSendAnyway: () => void;
	className?: string;
	/** Test seam for the reset's time zone. */
	timeZone?: string;
}

/** Upstream's `qt`: a mouse press on a band action leaves focus in the composer. */
function keepComposerFocus(event: MouseEvent)
{
	event.preventDefault();
}

/**
 * Upstream's parked notice band (`Kn` → `ar` with `kind:"notice"`): "You hit your usage limit. …", the reset while it
 * is ahead, and a secondary small Send anyway. No icon and no Dismiss. The dock bar squares it off over its list; with
 * the list in the transcript and no exceeded band it stands alone.
 */
export function ParkedNoticeBand({
	willAutoSend,
	resetsAt,
	archived,
	flushing,
	onSendAnyway,
	className,
	timeZone,
}: ParkedNoticeBandProps)
{
	// Upstream `Fr`: a ticking clock while a reset exists, so the detail drops once it passes.
	const now = useNow(resetsAt !== undefined);
	const detail = archived || resetsAt === undefined ? undefined : parkedResetDetail(resetsAt, now, timeZone);
	return (
		<BandShell
			icon={null}
			{...(className === undefined
				? {}
				:
					{
						className,
					})}
			actions={
				<button
					type="button"
					aria-label="Send anyway"
					aria-busy={flushing ? true : undefined}
					disabled={flushing || archived}
					className={`${cdsButtonClass("secondary", "sm")} shrink-0`}
					onMouseDown={keepComposerFocus}
					onClick={() =>
					{
						onSendAnyway();
					}}
				>
					<span className={flushing ? "opacity-0" : undefined}>Send anyway</span>
					{flushing && (
						<span className="absolute inset-0 grid place-items-center leading-[0]">
							<Spinner size="sm" />
						</span>
					)}
				</button>
			}
		>
			<span className="min-w-0 text-primary">
				{parkedNoticeMessage(
					{
						archived,
						willAutoSend,
					},
				)}
			</span>
			{detail !== undefined && <span className="min-w-0 text-ink-muted">{detail}</span>}
		</BandShell>
	);
}

/* Upstream `pn` on its text Link: a body-sized link padded to the control height without growing the band. */
const BAND_TEXT_LINK_CLASS =
	"shrink-0 cursor-pointer text-body text-primary underline underline-offset-[3px] py-[calc((var(--cds-h-control)-var(--upstream-leading-body))/2)] -my-[calc((var(--cds-h-control)-var(--upstream-leading-body))/2)] disabled:cursor-default disabled:opacity-50";

/** Upstream `Yn`: the exceeded band's secondary CTA while messages are held, a Send anyway text link. */
function SendAnywayLink({
	flushing,
	archived,
	onSendAnyway,
}: {
	flushing: boolean;
	archived: boolean;
	onSendAnyway: () => void;
})
{
	return (
		<button
			type="button"
			disabled={flushing || archived}
			aria-busy={flushing ? true : undefined}
			onMouseDown={keepComposerFocus}
			onClick={onSendAnyway}
			className={BAND_TEXT_LINK_CLASS}
		>
			Send anyway
		</button>
	);
}

/**
 * claude.ai/code's dismissible usage band between the dock card and the composer: the headline
 * ("On pace to hit your weekly limit early", "Approaching weekly usage limit", …), the used
 * percent (on-pace only) and reset time, and a Dismiss ×.
 */
export function UsagePaceBand({
	headline = "On pace to hit your weekly limit early",
	usedPct,
	resetText,
	onDismiss,
}: {
	headline?: string;
	usedPct?: number;
	resetText: string;
	onDismiss: () => void;
})
{
	return (
		<UsageBandShell
			headline={headline}
			detail={usedPct === undefined ? resetText : `${meterPercent(usedPct)}% used · ${resetText}`}
			onDismiss={onDismiss}
		/>
	);
}

/** Upstream's `onHeldNotice` payload: the parked messages the usage-limit band reports when they list in the transcript. */
export interface HeldNotice
{
	count: number;
	willAutoSend: boolean;
	/** The parked window's reset, epoch seconds. */
	resetsAt: number | undefined;
	archived: boolean;
	flushing: boolean;
	sendAnyway: () => void;
}

/**
 * Upstream's composer band once a limit is reached: the limit in danger ink and its reset
 * countdown. It cannot be dismissed. Upstream's "Get more usage to keep working" prefix is billing
 * copy (admins with extra usage off) and has no local meaning. With held messages (upstream `Jn`)
 * the detail gains " · N held messages will send automatically", or the archived copy replaces it,
 * and a Send anyway link follows.
 */
export function UsageLimitBand({
	headline,
	resetsAt,
	held,
}: {
	headline: string;
	resetsAt: number;
	held?: HeldNotice | undefined;
})
{
	const inNoticeCard = useInNoticeRegion();
	const countdown = <ResetCountdown resetsAt={resetsAt} inNoticeCard={inNoticeCard} />;
	let detail: ReactNode = countdown;
	if (held !== undefined)
	{
		detail = held.archived ? (
			parkedNoticeMessage(
				{
					archived: true,
					willAutoSend: held.willAutoSend,
				},
			)
		) : (
			<>
				{countdown}
				{" · "}
				{heldCountText(held.count, held.willAutoSend)}
			</>
		);
	}
	return (
		<UsageBandShell
			headline={headline}
			detail={detail}
			danger
			{...(held === undefined
				? {}
				:
					{
						actions: (
							<SendAnywayLink
								flushing={held.flushing}
								archived={held.archived}
								onSendAnyway={held.sendAnyway}
							/>
						),
					})}
		/>
	);
}

/** Upstream's standalone held band (`nr` with `Kn` props): held messages listed in the transcript with no exceeded band. */
export function UsageHeldBand({held}: {held: HeldNotice})
{
	return (
		<ParkedNoticeBand
			willAutoSend={held.willAutoSend}
			resetsAt={held.resetsAt}
			archived={held.archived}
			flushing={held.flushing}
			onSendAnyway={held.sendAnyway}
		/>
	);
}

/**
 * The band: the limit-reached band while the statusline reports a window spent before its reset,
 * else the approaching or on-pace band unless dismissed for its window's threshold and reset. Under
 * a composer notice region it registers as the `limit` slot instead of rendering inline.
 */
export function UsagePaceBanner({
	held,
}:
{
	held?: HeldNotice | undefined;
} = {})
{
	const band = useUsageBandElement(held);
	const claimed = useComposerNotice(
		"limit",
		band === null
			? null
			:
				{
					id: "code_usage_limit",
					content: band,
				},
	);
	return claimed ? null : band;
}

function useUsageBandElement(held: HeldNotice | undefined): ReactElement | null
{
	const {data: usage, dataUpdatedAt} = useQuery(usageQueryOptions);
	const dismissals = useUsageBandDismissals();
	const reached = usage === undefined ? null : limitReached(usage, dataUpdatedAt);
	if (reached !== null)
	{
		return <UsageLimitBand headline={reached.headline} resetsAt={reached.resetsAt} held={held} />;
	}
	if (held !== undefined) return <UsageHeldBand held={held} />;
	if (usage === undefined) return null;
	const band = usageBand(usage, dataUpdatedAt, dismissals);
	if (band === null) return null;
	const {window, resetsAt, threshold} = band;
	return (
		<UsagePaceBand
			headline={band.headline}
			{...(band.kind === "pace"
				?
					{
						usedPct: band.usedPct,
					}
				: {})}
			resetText={formatPaceBannerReset(resetsAt, Date.now())}
			onDismiss={() =>
			{
				writeUsageBandDismissal(
					window,
					{
						validUntil: resetsAt,
						threshold,
					},
				);
			}}
		/>
	);
}
