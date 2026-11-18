// @vitest-environment jsdom

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, renderHook, waitFor} from "@testing-library/react";
import type {ReactNode} from "react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vite-plus/test";

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

const {useRefusalOptOut} = await import("../src/hooks/use-refusal-opt-out");

let queryClient = new QueryClient();

function wrapper({children}: {children: ReactNode})
{
	return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(() =>
{
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
	it("is hidden while the settings load, then offers the settings sentence when the key is unset", async () =>
	{
		const {result} = renderHook(
			() => useRefusalOptOut(),
			{
				wrapper,
			},
		);
		expect(result.current.view).toBe("hidden");
		await waitFor(() =>
		{
			expect(result.current.view).toBe("offer");
		});
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
			() => useRefusalOptOut(),
			{
				wrapper,
			},
		);
		await waitFor(() =>
		{
			expect(result.current.view).toBe("off");
		});
	});

	it("opens Settings at the claude-code tab only, like upstream gO (the def has no anchor)", () =>
	{
		const {result} = renderHook(
			() => useRefusalOptOut(),
			{
				wrapper,
			},
		);
		result.current.openSettings();
		expect(openSettings.mock.calls).toStrictEqual([["claude-code"]]);
	});
});
