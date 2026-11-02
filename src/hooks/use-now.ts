import {useEffect, useState} from "react";

/** Re-renders every second while mounted, like upstream's ticking `now` (`W$(!0)`). */
export function useNow(): number
{
	const [now, setNow] = useState(() => Date.now());
	useEffect(() =>
	{
		const timer = setInterval(() =>
		{
			setNow(Date.now());
		}, 1000);
		return () =>
		{
			clearInterval(timer);
		};
	}, []);
	return now;
}
