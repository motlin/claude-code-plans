import {useEffect, useState} from "react";

/** Re-renders every second while mounted and `ticking`, like upstream's ticking `now` (`W$(!0)`). */
export function useNow(ticking = true): number
{
	const [now, setNow] = useState(() => Date.now());
	useEffect(() =>
	{
		if (!ticking) return undefined;
		setNow(Date.now());
		const timer = setInterval(() =>
		{
			setNow(Date.now());
		}, 1000);
		return () =>
		{
			clearInterval(timer);
		};
	}, [ticking]);
	return now;
}
