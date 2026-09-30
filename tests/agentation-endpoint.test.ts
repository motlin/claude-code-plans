import {describe, expect, it} from "vite-plus/test";
import {AGENTATION_ENDPOINT, AGENTATION_SERVER} from "../src/lib/agentation-endpoint";

describe("Agentation endpoint", () => {
	it("resolves to the page's own origin on localhost and on a remote https host", () => {
		const resolved = ["http://localhost:7526", "https://plans.m4.notlin.com"].map(
			(origin) => new URL(`${AGENTATION_ENDPOINT}/health`, origin).href,
		);

		expect(resolved).toEqual([
			"http://localhost:7526/__agentation/health",
			"https://plans.m4.notlin.com/__agentation/health",
		]);
	});

	it("is proxied by the dev server to the local Agentation server", async () => {
		const {default: config} = await import("../vite.config");
		const proxy = config.server?.proxy?.[AGENTATION_ENDPOINT];
		if (proxy === undefined || typeof proxy === "string") {
			throw new Error("expected an object proxy entry for the Agentation endpoint");
		}

		expect({
			target: proxy.target,
			changeOrigin: proxy.changeOrigin,
			rewritten: proxy.rewrite?.("/__agentation/sessions/abc/events"),
		}).toEqual({
			target: AGENTATION_SERVER,
			changeOrigin: true,
			rewritten: "/sessions/abc/events",
		});
	});
});
