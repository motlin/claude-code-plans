import {useQueries} from "@tanstack/react-query";
import {sessionIdentityQueryOptions} from "../lib/api/session-identity";

/** UUID routes stay synchronous; an unresolved or rejected alias is never a local session ID. */
export function useSessionIdentity(routeId: string | null): string | null {
	const alias = routeId?.startsWith("session_") ? routeId : null;
	const queries: ReturnType<typeof sessionIdentityQueryOptions>[] =
		alias === null ? [] : [sessionIdentityQueryOptions(alias)];
	const [identity] = useQueries({queries});
	if (alias === null) return routeId;
	return identity?.isSuccess ? identity.data.sessionId : null;
}
