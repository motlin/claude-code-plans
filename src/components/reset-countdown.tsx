import {useEffect, useState} from "react";
import {formatPaceBannerReset} from "../lib/usage";

const RESETTING = "Resetting…";

/**
 * The exceeded band's reset (upstream `Tn`): the absolute reset time until it passes, then
 * "Resetting…". Ticks once a minute (so the same-day vs dated form stays right) plus once at
 * the reset instant. In a notice card the visible text is aria-hidden and an sr-only absolute
 * reset follows it; outside one, "Resetting…" sits in an `aria-live="off"` span.
 */
export function ResetCountdown({resetsAt, inNoticeCard = false}: {resetsAt: number; inNoticeCard?: boolean})
{
	const [nowMs, setNowMs] = useState(() => Date.now());
	const resetMs = resetsAt * 1000;
	const resetting = resetMs <= nowMs;
	useEffect(() =>
	{
		const tick = () =>
		{
			setNowMs(Date.now());
		};
		const id = setInterval(tick, 60_000);
		const atReset = resetting ? undefined : setTimeout(tick, resetMs - Date.now());
		return () =>
		{
			clearInterval(id);
			if (atReset !== undefined) clearTimeout(atReset);
		};
	}, [resetMs, resetting]);
	const absolute = formatPaceBannerReset(resetsAt, nowMs);
	const visible = resetting ? RESETTING : absolute;
	if (inNoticeCard)
	{
		return (
			<span data-testid="reset-countdown">
				<span aria-hidden="true">{visible}</span>
				<span className="sr-only">{absolute}</span>
			</span>
		);
	}
	return <span data-testid="reset-countdown">{resetting ? <span aria-live="off">{RESETTING}</span> : visible}</span>;
}
