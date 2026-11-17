import {useEffect, useMemo, useState} from "react";

import type {MemoryDialogLoad} from "../components/memory-dialog";

/** Upstream `Fe`: with no breakdown and no turn running, the list gives up after this long. */
const MEMORY_LOAD_TIMEOUT_MS = 20_000;

/**
 * Upstream's Memory dialog list states: ready once a breakdown lists the files, unavailable when it failed to load
 * or nothing arrived within 20 s while idle, waiting while a turn runs (the CLI answers between turns), else loading.
 */
export function useMemoryDialogLoad({
	open,
	hasBreakdown,
	failed,
	turnActive,
}: {
	open: boolean;
	hasBreakdown: boolean;
	failed: boolean;
	turnActive: boolean;
}): MemoryDialogLoad
{
	// A fresh token per wait, so an expiry only counts for the wait that set it.
	const wait = useMemo(() => (open && !hasBreakdown && !turnActive ? {} : null), [open, hasBreakdown, turnActive]);
	const [expired, setExpired] = useState<object | null>(null);
	useEffect(() =>
	{
		if (wait === null) return undefined;
		const timer = setTimeout(() =>
		{
			setExpired(wait);
		}, MEMORY_LOAD_TIMEOUT_MS);
		return () =>
		{
			clearTimeout(timer);
		};
	}, [wait]);
	if (hasBreakdown) return "ready";
	if (failed || (wait !== null && expired === wait)) return "unavailable";
	return turnActive ? "waiting" : "loading";
}
