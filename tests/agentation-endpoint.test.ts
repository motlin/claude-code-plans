import {describe, expect, it} from "vite-plus/test";
import {AGENTATION_ENDPOINT, AGENTATION_SERVER, agentationEndpoint} from "../src/lib/agentation-endpoint";

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

	it("connects straight to the local server from a loopback page and through the proxy from anywhere else", () => {
		// Its event stream is long-lived: through the proxy it would take a second of the six HTTP/1.1
		// connections Chrome allows the app's origin per tab, so three tabs left none for the app's fetches.
		const endpoints = [
			"http://localhost:7526/session/abc",
			"http://127.0.0.1:7539/",
			"http://[::1]:7526/",
			"https://localhost:7526/",
			"https://plans.m4.notlin.com/",
			"http://192.168.1.20:7526/",
		].map((href) => agentationEndpoint(new URL(href)));

		expect(endpoints).toEqual([
			AGENTATION_SERVER,
			AGENTATION_SERVER,
			AGENTATION_SERVER,
			AGENTATION_ENDPOINT,
			AGENTATION_ENDPOINT,
			AGENTATION_ENDPOINT,
		]);
	});
});
