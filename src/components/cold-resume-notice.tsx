import {useCallback, useEffect, useId, useLayoutEffect, useRef, useState} from "react";

import {
	COLD_RESUME_COPY,
	coldResumeDetail,
	coldResumeRecord,
	decideColdResume,
	idleSince,
} from "../lib/cold-resume-notice";
import {ApprovalActionButton} from "./approval-card";
import {useComposerNotice} from "./composer-notice-context";
import {NoticeBanner} from "./notice-banner";
import {Icon} from "./ui/icon";
import {Tooltip} from "./ui/tooltip";

/** Upstream's minute check: a focused idle tab crosses the 2h boundary without any event. */
const CHECK_INTERVAL_MS = 60_000;

/**
 * Upstream `Wge`'s idle clock check `n()`: it reads the time only while the window has focus and the
 * tab is visible, at mount, on window focus, on visibilitychange to visible, on focusin/keydown inside
 * the session footer and every minute. Returns the time of the last check that ran, or null.
 */
function useIdleCheckTime(): number | null {
	const [checkedAt, setCheckedAt] = useState<number | null>(null);
	useEffect(() => {
		const check = () => {
			if (document.visibilityState === "hidden" || !document.hasFocus()) return;
			setCheckedAt(Date.now());
		};
		const inFooter = (event: Event) => {
			if (event.target instanceof Element && event.target.closest("[data-session-footer]") !== null) check();
		};
		check();
		window.addEventListener("focus", check);
		document.addEventListener("visibilitychange", check);
		document.addEventListener("focusin", inFooter);
		document.addEventListener("keydown", inFooter);
		const interval = setInterval(check, CHECK_INTERVAL_MS);
		return () => {
			window.removeEventListener("focus", check);
			document.removeEventListener("visibilitychange", check);
			document.removeEventListener("focusin", inFooter);
			document.removeEventListener("keydown", inFooter);
			clearInterval(interval);
		};
	}, []);
	return checkedAt;
}

function TippedAction({label, tip, onClick}: {label: string; tip: string; onClick: () => void}) {
	const tipId = useId();
	return (
		<>
			<Tooltip content={tip}>
				<ApprovalActionButton variant="secondary" aria-describedby={tipId} onClick={onClick}>
					{label}
				</ApprovalActionButton>
			</Tooltip>
			<span id={tipId} hidden>
				{tip}
			</span>
		</>
	);
}

/**
 * The cold-resume idle cost notice (upstream `Qge` → `Xge`, slot `eagerCookie`, cc43287c9 crawl
 * 2026-11-06): after two idle hours with enough context, a card estimating what resuming costs
 * against the five-hour window, offering Resume here, New session and Compact. Any answer, or a send
 * over it, retires the notice for that idle stretch.
 */
export function ColdResumeNotice({
	sessionId,
	lastRecordMs,
	lastActivityMs = null,
	running,
	heldInput,
	contextTokens,
	fiveHourPct,
	anyWindowSpent,
	onStay,
	onCompact,
	onNewSession,
	onHoldChange,
}: {
	sessionId: string;
	lastRecordMs: number | null;
	lastActivityMs?: number | null;
	running: boolean;
	heldInput: boolean;
	contextTokens: number | null;
	fiveHourPct: number | null;
	anyWindowSpent: boolean;
	onStay: () => void;
	onCompact?: (() => void) | undefined;
	onNewSession?: (() => void) | undefined;
	/** Upstream `coldResumeNoticeHolds`: whether the card is showing, so the stale-compact line yields. */
	onHoldChange?: ((holds: boolean) => void) | undefined;
}) {
	const checkedAt = useIdleCheckTime();
	const [, setVersion] = useState(0);
	const since = idleSince({lastRecordMs, lastActivityMs});
	const busy = running || heldInput;
	const busyRef = useRef(busy);
	busyRef.current = busy;
	const record = coldResumeRecord(sessionId);

	// Upstream `T.current = since`: a send over an idle stretch retires it for good.
	useLayoutEffect(() => {
		if (busy && since !== null && coldResumeRecord(sessionId).sentOverSince !== since) {
			coldResumeRecord(sessionId).sentOverSince = since;
			setVersion((version) => version + 1);
		}
	}, [busy, since, sessionId]);

	const decision =
		checkedAt === null
			? null
			: decideColdResume({
					nowMs: checkedAt,
					since,
					contextTokens,
					fiveHourPct,
					anyWindowSpent,
					running,
					heldInput,
					focused: true,
					visible: true,
					answeredSince: record.answeredSince,
					sentOverSince: record.sentOverSince,
				});

	const answer = useCallback(
		(answeredSince: number, then?: () => void) => {
			const current = coldResumeRecord(sessionId);
			if (current.answeredSince === answeredSince) return;
			current.answeredSince = answeredSince;
			setVersion((version) => version + 1);
			then?.();
		},
		[sessionId],
	);

	let notice = null;
	if (decision !== null) {
		const answeredSince = decision.since;
		notice = {
			id: `${sessionId}:${answeredSince}`,
			content: (
				<NoticeBanner
					icon={<Icon name="Info" size="auto" />}
					data-testid="cold-resume-card"
					onDismiss={() => {
						answer(answeredSince);
					}}
					action={
						<div className="flex min-w-0 flex-wrap items-center gap-xs">
							<ApprovalActionButton
								variant="secondary"
								onClick={() => {
									answer(answeredSince, onStay);
								}}
							>
								{COLD_RESUME_COPY.resume}
							</ApprovalActionButton>
							{onNewSession !== undefined && (
								<TippedAction
									label={COLD_RESUME_COPY.newSession}
									tip={COLD_RESUME_COPY.newSessionTip}
									onClick={() => {
										answer(answeredSince, onNewSession);
									}}
								/>
							)}
							{onCompact !== undefined && (
								<TippedAction
									label={COLD_RESUME_COPY.compact}
									tip={COLD_RESUME_COPY.compactTip}
									onClick={() => {
										if (busyRef.current) return;
										answer(answeredSince, onCompact);
									}}
								/>
							)}
						</div>
					}
				>
					<span aria-atomic="true" className="flex flex-col">
						{COLD_RESUME_COPY.heading}{" "}
						<span className="text-muted-as-secondary">{coldResumeDetail(decision)}</span>
					</span>
				</NoticeBanner>
			),
		};
	}
	const holds = decision !== null;
	useLayoutEffect(() => {
		onHoldChange?.(holds);
	}, [onHoldChange, holds]);
	useLayoutEffect(
		() => () => {
			onHoldChange?.(false);
		},
		[onHoldChange],
	);
	const claimed = useComposerNotice("eagerCookie", notice);
	return claimed ? null : (notice?.content ?? null);
}
