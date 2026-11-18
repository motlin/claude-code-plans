import {useEffect, useState} from "react";

import {createCappedStorageMap} from "./capped-storage-map";

/** Upstream `gP`'s key: whether each session last had no connectors. */
export const RAIL_NO_CONNECTORS_KEY = "epitaxy.railNoConnectors.v1";

/** Upstream's org-wide fallback is `last:<org uuid>`; the local app has no organisation, as upstream's undefined org. */
const RAIL_NO_CONNECTORS_LAST_KEY = "last:";

interface RailNoConnectorsEntry
{
	none: boolean;
	at: number;
}

const memory = createCappedStorageMap<RailNoConnectorsEntry>(
	{
		key: RAIL_NO_CONNECTORS_KEY,
		cap: 200,
		valid: (value): value is RailNoConnectorsEntry =>
			typeof value === "object" && value !== null && "none" in value && typeof value.none === "boolean",
	},
);

/** Upstream `_P`: records a known count; a zero count only once the list is trusted. */
function writeIfKnown(key: string, count: number | null, trusted: boolean): void
{
	if (count === null) return;
	const none = count === 0;
	if (none && !trusted) return;
	memory.write(
		key,
		{
			none,
		},
	);
}

/**
 * Upstream `vP`: whether the session (or, unseen, the last session) had no
 * connectors. Read once at mount so the rail can skip the Connectors loading
 * card; every known count updates both the session's entry and the `last:` one.
 */
export function useRailNoConnectors(sessionId: string, count: number | null, trusted: boolean): boolean
{
	const [rememberedNone] = useState(
		() => (memory.read(sessionId) ?? memory.read(RAIL_NO_CONNECTORS_LAST_KEY))?.none === true,
	);
	useEffect(() =>
	{
		writeIfKnown(sessionId, count, trusted);
	}, [sessionId, count, trusted]);
	useEffect(() =>
	{
		writeIfKnown(RAIL_NO_CONNECTORS_LAST_KEY, count, trusted);
	}, [count, trusted]);
	return rememberedNone;
}
