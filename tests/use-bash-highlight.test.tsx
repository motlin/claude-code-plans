// @vitest-environment jsdom

import {renderHook, waitFor} from "@testing-library/react";
import {describe, expect, it} from "vite-plus/test";
import {useBashHighlight} from "../src/hooks/use-bash-highlight";

describe("useBashHighlight", () => {
	it("stays null while disabled", () => {
		const {result} = renderHook(() => useBashHighlight("ls -la", false));

		expect(result.current).toBeNull();
	});

	it("loads Shiki on demand and tokenizes the command as bash", async () => {
		const {result} = renderHook(() => useBashHighlight("ls -la", true));

		await waitFor(
			() => {
				expect(result.current).not.toBeNull();
			},
			{timeout: 10_000},
		);
		expect(result.current?.map((line) => line.map((token) => token.content).join(""))).toStrictEqual(["ls -la"]);
	});
});
