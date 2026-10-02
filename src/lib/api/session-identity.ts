import {queryOptions, type Query, type QueryClient} from "@tanstack/react-query";
import {apiFetch, ApiResponseError} from "./client";
import {SessionIdentityResponse, sessionQueryKeys} from "./sessions";

/** Shared page and tab wording for a terminal alias lookup failure. */
export function sessionIdentityFailure(error: Error | null | undefined) {
	const status = error instanceof ApiResponseError ? error.status : null;
	if (status === 404) return {title: "Session Not Found", message: "Session Not Found"};
	if (status === 409)
		return {title: "Ambiguous session link", message: "This session link has more than one local session."};
	if (status === 503)
		return {title: "Indexing sessions…", message: "Sessions are still being indexed. Try again shortly."};
	return {title: "Failed to load session", message: "Couldn't resolve this session link."};
}

/** Event callbacks share resolved identities without starting a request or accepting stale failed data. */
export function getCachedSessionIdentity(queryClient: QueryClient, routeId: string | null): string | null {
	if (routeId === null || !routeId.startsWith("session_")) return routeId;
	const identity = queryClient.getQueryState<{sessionId: string}>(sessionQueryKeys.identity(routeId));
	return identity?.status === "success" ? (identity.data?.sessionId ?? null) : null;
}

export const sessionIdentityQueryOptions = (routeId: string) =>
	queryOptions({
		queryKey: sessionQueryKeys.identity(routeId),
		queryFn: ({signal}) =>
			apiFetch(`/api/sessions/${encodeURIComponent(routeId)}/identity`, SessionIdentityResponse, {signal}),
		staleTime: Infinity,
		gcTime: Infinity,
		retry: (failureCount, error) => error instanceof ApiResponseError && error.status === 503 && failureCount < 2,
		retryDelay: 3000,
	});

/** A new owner can make any cached alias ambiguous, including one belonging to another session. */
export async function invalidateSessionIdentities(
	queryClient: QueryClient,
	predicate?: (query: Query) => boolean,
): Promise<void> {
	const filters = {queryKey: sessionQueryKeys.identities(), ...(predicate ? {predicate} : {})};
	// Cancel even a first lookup, so its pre-index response cannot overwrite the new identity.
	await queryClient.cancelQueries(filters);
	await queryClient.invalidateQueries(filters);
}
