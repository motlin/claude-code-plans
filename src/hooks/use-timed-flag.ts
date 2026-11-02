import {useCallback, useEffect, useRef, useState} from "react";

/**
 * A flag that `raise` turns on for `ms`, like a copy button's "Copied" check. Raising again restarts the window, and
 * unmounting clears the pending reset so the timer never outlives the component. A raise after unmount (a clipboard
 * write that resolves late) does nothing.
 */
export function useTimedFlag(ms: number): [boolean, () => void]
{
	const [on, setOn] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const mounted = useRef(false);
	useEffect(() =>
	{
		mounted.current = true;
		return () =>
		{
			mounted.current = false;
			clearTimeout(timer.current);
		};
	}, []);
	const raise = useCallback(() =>
	{
		if (!mounted.current) return;
		setOn(true);
		clearTimeout(timer.current);
		timer.current = setTimeout(() =>
		{
			setOn(false);
		}, ms);
	}, [ms]);
	return [on, raise];
}
