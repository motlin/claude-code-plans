import {ApiResponseError} from "./api/client";

const DEFAULT_RETRIES = 3;
// With react-query's doubling delay capped at 30s, ten retries span about three minutes.
const UNAVAILABLE_RETRIES = 10;

/**
 * The app's react-query retry policy: react-query's usual three retries, except that a 503 (the dev server
 * restarting) keeps retrying with backoff so an open tab recovers by itself instead of showing an error.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
	const limit = error instanceof ApiResponseError && error.status === 503 ? UNAVAILABLE_RETRIES : DEFAULT_RETRIES;
	return failureCount < limit;
}
