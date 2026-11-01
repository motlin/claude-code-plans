// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, renderHook} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, describe, expect, it, vi} from "vite-plus/test";
import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import {usePermissionAnswer} from "../src/components/use-permission-answer";
import {HerdrRequestError} from "../src/lib/api/herdr";
import type {PermissionDecision} from "../src/lib/permission-card";

afterEach(() => {
	cleanup();
});

function harness(send: (decision: PermissionDecision) => Promise<void>) {
	const queryClient = new QueryClient();
	const invalidate = vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
	const toasts: ToastOptions[] = [];
	const handlers = {
		toast: (options: ToastOptions) => {
			toasts.push(options);
		},
	};
	const wrapper = ({children}: {children: ReactNode}) => (
		<QueryClientProvider client={queryClient}>
			<ToastContext.Provider value={handlers.toast}>{children}</ToastContext.Provider>
		</QueryClientProvider>
	);
	const hook = renderHook(
		({permissionId}: {permissionId: string | null}) => usePermissionAnswer({permissionId, send}),
		{wrapper, initialProps: {permissionId: "toolu-test-100"}},
	);
	return {hook, invalidate, toasts};
}

describe("usePermissionAnswer", () => {
	it("drops the card, refetches what said it was pending, and notes why when the server holds no prompt", async () => {
		const send = vi.fn<(decision: PermissionDecision) => Promise<void>>();
		send.mockRejectedValue(new HerdrRequestError("No permission request is pending", 409, "not_pending"));
		const {hook, invalidate, toasts} = harness(send);

		await act(async () => hook.result.current.answer("allow"));

		expect({
			dropped: hook.result.current.dropped,
			sends: send.mock.calls,
			invalidated: invalidate.mock.calls,
			toasts,
		}).toStrictEqual({
			dropped: true,
			sends: [["allow"]],
			invalidated: [
				[{queryKey: ["notifications"]}],
				[{queryKey: ["sessions", "recent"]}],
				[{queryKey: ["sessions", "grouped"]}],
			],
			toasts: [{kind: "warning", message: "That permission request is no longer pending"}],
		});
	});

	it("shows a later prompt again: the drop holds only for the card it hit", async () => {
		const send = vi.fn<(decision: PermissionDecision) => Promise<void>>();
		send.mockRejectedValue(new HerdrRequestError("No permission request is pending", 409, "not_pending"));
		const {hook} = harness(send);

		await act(async () => hook.result.current.answer("deny"));
		hook.rerender({permissionId: "toolu-test-200"});

		expect(hook.result.current.dropped).toBe(false);
	});

	it("rethrows any other failure so the card comes back with its error", async () => {
		const send = vi.fn<(decision: PermissionDecision) => Promise<void>>();
		send.mockRejectedValue(new HerdrRequestError("herdr is unreachable", 502, undefined));
		const {hook, invalidate} = harness(send);

		const error: unknown = await act(async () =>
			hook.result.current.answer("allow").catch((caught: unknown) => caught),
		);

		expect({
			message: error instanceof Error ? error.message : null,
			dropped: hook.result.current.dropped,
			invalidated: invalidate.mock.calls,
		}).toStrictEqual({message: "herdr is unreachable", dropped: false, invalidated: []});
	});
});
