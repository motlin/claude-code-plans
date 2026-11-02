// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {act, cleanup, renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

import {ToastContext, type ToastOptions} from "../src/components/toast-context";
import type {ClaudeCodeSettingsState} from "../src/lib/claude-code-settings-schema";

const api = vi.hoisted(() => (
{
	state:
	{
		mtimeMs: 1,
		values: {},
	} as ClaudeCodeSettingsState,
	post: vi.fn<
		(patch: {
			key: string;
			value: unknown;
			expectedMtimeMs: number | null;
		}) => Promise<ClaudeCodeSettingsState | null>
	>(),
}));

vi.mock("../src/lib/api/claude-code-settings", () => (
{
	claudeCodeSettingsQueryOptions:
	{
		queryKey: ["claude-code-settings"] as const,
		queryFn: async () => Promise.resolve(api.state),
		staleTime: 0,
	},
	postClaudeCodeSetting: api.post,
}));

const openSettings = vi.hoisted(() => vi.fn<(tab: string, row?: string) => void>());
vi.mock("../src/components/settings/open-settings", () => (
{
	useOpenSettings: () => openSettings,
}));

const {useRefusalOptOut, REFUSAL_OPT_OUT_FAILED} = await import("../src/hooks/use-refusal-opt-out");

let toasts: ToastOptions[] = [];
let queryClient = new QueryClient();

function pushToast(options: ToastOptions)
{
	toasts.push(options);
}

function wrapper({children}: {children: ReactNode})
{
	return (
		<QueryClientProvider client={queryClient}>
			<ToastContext.Provider value={pushToast}>{children}</ToastContext.Provider>
		</QueryClientProvider>
	);
}

beforeEach(() =>
{
	toasts = [];
	queryClient = new QueryClient(
		{
			defaultOptions:
			{
				queries:
				{
					retry: false,
				},
			},
		},
	);
	api.state =
	{
		mtimeMs: 1,
		values: {},
	};
	api.post.mockReset();
	openSettings.mockReset();
});

afterEach(() =>
{
	cleanup();
});

describe("useRefusalOptOut", () =>
{
	it("is hidden while the settings load, then offers the opt-out when the key is unset", async () =>
	{
		const {result} = renderHook(
			() => useRefusalOptOut("s1"),
			{
				wrapper,
			},
		);
		expect(result.current.view).toBe("hidden");
		await waitFor(() =>
		{
			expect(result.current.view).toBe("offer");
		});
		expect(result.current.pending).toBe(false);
	});

	it("is off at mount when settings.json already has switchModelsOnFlag false", async () =>
	{
		api.state =
		{
			mtimeMs: 1,
			values:
			{
				switchModelsOnFlag: false,
			},
		};
		const {result} = renderHook(
			() => useRefusalOptOut("s1"),
			{
				wrapper,
			},
		);
		await waitFor(() =>
		{
			expect(result.current.view).toBe("off");
		});
	});

	it("writes switchModelsOnFlag false, is pending until it lands, then turns off", async () =>
	{
		let resolve: (state: ClaudeCodeSettingsState | null) => void = () =>
		{
		};
		api.post.mockImplementation(
			async () =>
				new Promise((done) =>
				{
					resolve = done;
				}),
		);
		const {result} = renderHook(
			() => useRefusalOptOut("s1"),
			{
				wrapper,
			},
		);
		await waitFor(() =>
		{
			expect(result.current.view).toBe("offer");
		});
		act(() =>
		{
			result.current.optOut();
		});
		await waitFor(() =>
		{
			expect(api.post).toHaveBeenCalledTimes(1);
		});
		expect(api.post.mock.calls[0]?.[0]).toStrictEqual(
			{
				key: "switchModelsOnFlag",
				value: false,
				expectedMtimeMs: 1,
			},
		);
		expect(
			{
				view: result.current.view,
				pending: result.current.pending,
			},
		).toStrictEqual(
			{
				view: "offer",
				pending: true,
			},
		);
		await act(async () =>
		{
			resolve(
				{
					mtimeMs: 2,
					values:
					{
						switchModelsOnFlag: false,
					},
				},
			);
			await Promise.resolve();
		});
		await waitFor(() =>
		{
			expect(
				{
					view: result.current.view,
					pending: result.current.pending,
				},
			).toStrictEqual(
				{
					view: "off",
					pending: false,
				},
			);
		});
		expect(toasts).toStrictEqual([]);
	});

	it("toasts the exact error and goes back to the offer when the write is refused", async () =>
	{
		api.post.mockResolvedValue(null);
		const {result} = renderHook(
			() => useRefusalOptOut("s1"),
			{
				wrapper,
			},
		);
		await waitFor(() =>
		{
			expect(result.current.view).toBe("offer");
		});
		act(() =>
		{
			result.current.optOut();
		});
		await waitFor(() =>
		{
			expect(toasts).toStrictEqual([
				{
					kind: "error",
					message: REFUSAL_OPT_OUT_FAILED,
				},
			]);
		});
		expect(REFUSAL_OPT_OUT_FAILED).toBe("Couldn’t update the setting. Change it in Settings → Claude Code.");
		expect(
			{
				view: result.current.view,
				pending: result.current.pending,
			},
		).toStrictEqual(
			{
				view: "offer",
				pending: false,
			},
		);
	});

	it("opens Settings at the switch-models row", () =>
	{
		const {result} = renderHook(
			() => useRefusalOptOut("s1"),
			{
				wrapper,
			},
		);
		result.current.openSettings();
		expect(openSettings.mock.calls).toStrictEqual([["claude-code", "switch-models-local"]]);
	});
});
