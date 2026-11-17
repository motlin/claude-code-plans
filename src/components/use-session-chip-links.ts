import {useQueries, useQuery} from "@tanstack/react-query";
import {useMemo} from "react";

import {sessionIdentityQueryOptions} from "../lib/api/session-identity";
import {sessionsByIdsQueryOptions, type SessionListItem} from "../lib/api/sessions";
import {sessionLinkIds} from "../lib/client-markdown";
import {sessionLinkTarget, type SessionLinkTarget} from "../lib/session-link-href";
import {isBridgeSessionAlias} from "../lib/session-route-alias";

/** A local session UUID, as `parseSessionLinkHref` returns for a `/session/<uuid>` link. */
const LOCAL_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

export interface SessionChipLinks
{
	/** Indexed sessions keyed by the id a link names; undefined while the prose links to none. */
	sessionLinks: ReadonlyMap<string, SessionLinkTarget> | undefined;
	/** Their rows by local id, for the chips' menus. */
	sessionRows: ReadonlyMap<string, SessionListItem> | undefined;
}

/**
 * The local sessions the prose's session links name: a claude.ai `session_…` id resolves through its Remote
 * Control bridge alias, a local UUID names its session directly, and both then load their sidebar rows.
 * Nothing is fetched for prose without session links.
 */
export function useSessionChipLinks(markdown: string): SessionChipLinks
{
	const ids = useMemo(() => sessionLinkIds(markdown), [markdown]);
	const identities = useQueries(
		{
			queries: ids.filter((id) => isBridgeSessionAlias(id)).map((id) => sessionIdentityQueryOptions(id)),
		},
	);
	const owners = identities.map((query) => query.data?.sessionId ?? "").join(",");
	// Link id → local session id; unknown aliases and `ses_`/`cse_` ids (never bridged locally) drop out.
	const pairs = useMemo(() =>
	{
		const resolved = owners.split(",");
		const found: [string, string][] = [];
		let bridged = 0;
		for (const id of ids)
		{
			if (isBridgeSessionAlias(id))
			{
				const sessionId = resolved[bridged++] ?? "";
				if (sessionId !== "") found.push([id, sessionId]);
			}
			else if (LOCAL_SESSION_ID.test(id)) found.push([id, id]);
		}
		return found;
	}, [ids, owners]);
	const localIds = [...new Set(pairs.map(([, sessionId]) => sessionId))];
	const {data: rows} = useQuery(
		{
			...sessionsByIdsQueryOptions(localIds),
			enabled: localIds.length > 0,
		},
	);
	return useMemo(() =>
	{
		if (rows === undefined || rows.length === 0)
			return {
				sessionLinks: undefined,
				sessionRows: undefined,
			};
		const byId = new Map(rows.map((row) => [row.id, row] as const));
		const links = new Map<string, SessionLinkTarget>();
		for (const [id, sessionId] of pairs)
		{
			const row = byId.get(sessionId);
			if (row !== undefined) links.set(id, sessionLinkTarget(row));
		}
		return {
			sessionLinks: links,
			sessionRows: byId,
		};
	}, [rows, pairs]);
}
