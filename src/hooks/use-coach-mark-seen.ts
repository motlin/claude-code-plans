import {useState} from "react";

function readCoachMarkSeen(key: string): boolean
{
	try
	{
		return localStorage.getItem(key) === "true";
	}
	catch
	{
		return false;
	}
}

/**
 * A one-time coach mark's seen flag, persisted in localStorage under `key`.
 * `closed` hides it for this mount only (an outside click), without marking it seen.
 */
export function useCoachMarkSeen(key: string)
{
	const [seen, setSeen] = useState(() => readCoachMarkSeen(key));
	const [closed, setClosed] = useState(false);
	return {
		hidden: seen || closed,
		markSeen: () =>
		{
			setSeen(true);
			try
			{
				localStorage.setItem(key, "true");
			}
			catch
			{
				// Storage unavailable: the tip stays dismissed for this mount.
			}
		},
		close: () =>
		{
			setClosed(true);
		},
	};
}
