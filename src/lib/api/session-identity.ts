import {queryOptions, type Query, type QueryClient} from "@tanstack/react-query";
import {apiFetch, ApiResponseError} from "./client";
import {SessionIdentityResponse, sessionQueryKeys} from "./sessions";

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
