import {accessSync, constants, mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vite-plus/test";
import {diffRendererManifests, fixtureServerEnv, seedFixtureHome} from "../scripts/screenshots";

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
	it("drops every inherited HERDR_* variable, points the herdr socket into the fixture and puts the fixture's bin first on PATH", () => {
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
			PATH: "/fixture/bin:/usr/bin",
			HOME: "/fixture/home",
			XDG_CACHE_HOME: "/fixture/cache",
			XDG_CONFIG_HOME: "/fixture/config",
			HERDR_SOCKET_PATH: "/fixture/no-herdr.sock",
			PORT: "7538",
			NO_PROXY: "127.0.0.1,localhost",
		});
	});
});

describe("seedFixtureHome", () => {
	it("installs an executable claude stub in the fixture's bin, so the server never depends on the machine's claude", () => {
		const root = mkdtempSync(join(tmpdir(), "screenshots-script-"));
		try {
			seedFixtureHome(root);
			const stub = join(root, "bin", "claude");

			expect(() => accessSync(stub, constants.X_OK)).not.toThrow();
			expect(readFileSync(stub, "utf-8")).toBe(
				'#!/bin/sh\necho "claude is stubbed out on fixture servers" >&2\nexit 1\n',
			);
		} finally {
			rmSync(root, {recursive: true, force: true});
		}
	});
});
