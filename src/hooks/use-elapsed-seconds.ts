import {useEffect, useState} from "react";

/** Whole seconds since `startedAt`, ticking once a second; null without a start time. */
export function useElapsedSeconds(startedAt: string | undefined): number | null {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (startedAt === undefined) return undefined;
		const timer = setInterval(() => {
			setNow(Date.now());
		}, 1000);
		return () => {
			clearInterval(timer);
		};
	}, [startedAt]);
	if (startedAt === undefined) return null;
	const started = Date.parse(startedAt);
	return Number.isNaN(started) ? null : Math.max(0, Math.floor((now - started) / 1000));
}
