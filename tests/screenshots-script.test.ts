import {describe, expect, it} from "vite-plus/test";
import {diffRendererManifests, fixtureServerEnv} from "../scripts/screenshots";

describe("diffRendererManifests", () => {
	it("returns exact nested field paths for renderer drift", () => {
		const expected = {
			chromiumVersion: "100.0.0.0",
			viewport: {width: 1280, height: 718},
			fontResolution: {
				sans: {requested: ["Alice Sans", "sans-serif"], resolved: "Alice Sans"},
			},
			fontsMissing: [],
		};
		const actual = {
			chromiumVersion: "101.0.0.0",
			viewport: {width: 1280, height: 720},
			fontResolution: {
				sans: {requested: ["Alice Sans", "sans-serif"], resolved: "sans-serif"},
			},
			fontsMissing: ["Alice Sans"],
		};

		expect(diffRendererManifests(expected, actual)).toStrictEqual([
			"chromiumVersion",
			"fontResolution.sans.resolved",
			"fontsMissing",
			"viewport.height",
		]);
	});

	it("returns no fields for identical manifests", () => {
		const manifest = {
			playwrightVersion: "1.0.0",
			platform: {operatingSystem: "fixture", architecture: "alice"},
		};

		expect(diffRendererManifests(manifest, structuredClone(manifest))).toStrictEqual([]);
	});
});

describe("fixtureServerEnv", () => {
	it("drops every inherited HERDR_* variable and points the herdr socket into the fixture", () => {
		const env = fixtureServerEnv(
			{
				PATH: "/usr/bin",
				HOME: "/Users/alice",
				HERDR_SOCKET_PATH: "/Users/alice/.config/herdr/herdr.sock",
				HERDR_SESSION: "alice-session",
				HERDR_PANE_ID: "pane-100",
				HERDR_WORKSPACE_ID: "workspace-100",
			},
			{fixtureRoot: "/fixture", fixtureHome: "/fixture/home", port: 7538},
		);

		expect(env).toStrictEqual({
			PATH: "/usr/bin",
			HOME: "/fixture/home",
			XDG_CACHE_HOME: "/fixture/cache",
			XDG_CONFIG_HOME: "/fixture/config",
			HERDR_SOCKET_PATH: "/fixture/no-herdr.sock",
			PORT: "7538",
			NO_PROXY: "127.0.0.1,localhost",
		});
	});
});
