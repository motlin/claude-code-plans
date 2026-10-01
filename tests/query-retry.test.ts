import {describe, expect, it} from "vite-plus/test";
import {ApiResponseError} from "../src/lib/api/client";
import {shouldRetryQuery} from "../src/lib/query-retry";
import {getRouter} from "../src/router";

function apiError(status: number): ApiResponseError {
	return new ApiResponseError("/api/count", new Response(null, {status}));
}

function retriesBeforeGivingUp(error: unknown): number {
	let failureCount = 0;
	while (shouldRetryQuery(failureCount, error)) failureCount++;
	return failureCount;
}

describe("shouldRetryQuery", () => {
	it("keeps retrying a 503 while the dev server restarts, and gives other failures the usual three retries", () => {
		expect({
			unavailable: retriesBeforeGivingUp(apiError(503)),
			serverError: retriesBeforeGivingUp(apiError(500)),
			networkError: retriesBeforeGivingUp(new TypeError("Failed to fetch")),
		}).toStrictEqual({unavailable: 10, serverError: 3, networkError: 3});
	});

	it("is the app query client's default retry policy", () => {
		const queryClient = getRouter().options.context.queryClient;

		expect(queryClient.getDefaultOptions().queries?.retry).toBe(shouldRetryQuery);
	});
});
