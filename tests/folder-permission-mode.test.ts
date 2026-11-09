import {beforeEach, describe, expect, it} from "vite-plus/test";
import {
	carryPickToFolder,
	clampToAvailable,
	FOLDER_PERMISSION_MODE_STORAGE_KEY,
	folderChoice,
	folderModeKey,
	readFolderModes,
	resolveDraftBaseMode,
	restoreFolderMode,
	shouldRememberPick,
	writeFolderMode,
} from "../src/lib/folder-permission-mode";
import {installLocalStorage} from "./fake-storage";

describe("folder permission mode memory", () => {
	beforeEach(() => {
		installLocalStorage();
	});

	it("keys a worktree by its repo and a missing cwd by null", () => {
		expect([
			folderModeKey("/Users/a/app/.claude/worktrees/feat"),
			folderModeKey("/Users/a/app"),
			folderModeKey(undefined),
		]).toStrictEqual(["/Users/a/app", "/Users/a/app", null]);
	});

	it("reads only known modes from storage", () => {
		localStorage.setItem(FOLDER_PERMISSION_MODE_STORAGE_KEY, JSON.stringify({"/w": "acceptEdits", "/x": "bogus"}));
		expect(readFolderModes()).toStrictEqual({"/w": "acceptEdits"});
	});

	it("reads an empty map from non-object JSON or throwing storage", () => {
		localStorage.setItem(FOLDER_PERMISSION_MODE_STORAGE_KEY, JSON.stringify(["acceptEdits"]));
		const fromArray = readFolderModes();
		Object.defineProperty(globalThis, "localStorage", {
			configurable: true,
			get() {
				throw new Error("SecurityError");
			},
		});
		expect({fromArray, throwing: readFolderModes()}).toStrictEqual({fromArray: {}, throwing: {}});
	});

	it("remembers every pick except Plan and approval-card switches", () => {
		expect([
			shouldRememberPick({mode: "plan", method: "mode_dropdown"}),
			shouldRememberPick({mode: "auto", method: "approval_card"}),
			shouldRememberPick({mode: "bypassPermissions", method: "mode_dropdown"}),
			shouldRememberPick({mode: "acceptEdits", method: "keyboard_shortcut"}),
		]).toStrictEqual([false, false, true, true]);
	});

	it("never restores a remembered Plan", () => {
		expect([
			folderChoice({"/w": "plan", "/x": "acceptEdits"}, "/w"),
			folderChoice({"/w": "plan", "/x": "acceptEdits"}, "/x"),
			folderChoice({"/w": "plan"}, null),
		]).toStrictEqual([undefined, "acceptEdits", undefined]);
	});

	it("lets the user-scope default beat the folder memory", () => {
		expect(
			resolveDraftBaseMode({
				userChoice: null,
				userSettingsDefault: "auto",
				folderChoice: "acceptEdits",
				repoSettingsDefault: undefined,
				fallback: "default",
			}),
		).toStrictEqual({mode: "auto", source: "settings_default_mode", hasExplicitChoice: false});
	});

	it("lets the folder memory beat the repo default", () => {
		expect(
			resolveDraftBaseMode({
				userChoice: null,
				userSettingsDefault: undefined,
				folderChoice: "acceptEdits",
				repoSettingsDefault: "default",
				fallback: "default",
			}),
		).toStrictEqual({mode: "acceptEdits", source: "folder_pick", hasExplicitChoice: true});
	});

	it("falls through the in-session pick, repo default and fallback", () => {
		expect([
			resolveDraftBaseMode({
				userChoice: "plan",
				userSettingsDefault: "auto",
				folderChoice: "acceptEdits",
				repoSettingsDefault: undefined,
				fallback: "default",
			}),
			resolveDraftBaseMode({
				userChoice: null,
				userSettingsDefault: undefined,
				folderChoice: undefined,
				repoSettingsDefault: "plan",
				fallback: "default",
			}),
			resolveDraftBaseMode({
				userChoice: null,
				userSettingsDefault: undefined,
				folderChoice: undefined,
				repoSettingsDefault: undefined,
				fallback: "default",
			}),
		]).toStrictEqual([
			{mode: "plan", source: "in_session_pick", hasExplicitChoice: true},
			{mode: "plan", source: "repo_settings_default_mode", hasExplicitChoice: false},
			{mode: "default", source: "fallback", hasExplicitChoice: false},
		]);
	});

	it("clamps a mode to the modes available now", () => {
		expect([
			clampToAvailable("bypassPermissions", ["auto", "default", "acceptEdits", "plan"]),
			clampToAvailable("acceptEdits", ["auto", "default", "acceptEdits", "plan"]),
			clampToAvailable("auto", ["default", "acceptEdits"]),
			clampToAvailable("auto", []),
			clampToAvailable("bypassPermissions", ["auto"]),
		]).toStrictEqual(["default", "acceptEdits", "acceptEdits", "acceptEdits", "auto"]);
	});

	it("carries only picks that need no consent to another folder", () => {
		expect(
			(["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const).map((pick) =>
				carryPickToFolder({pick}),
			),
		).toStrictEqual([true, true, true, false, false]);
	});

	it("rolls a failed pick back unless another pick replaced it", () => {
		writeFolderMode("/w", "default");
		writeFolderMode("/w", "bypassPermissions");
		restoreFolderMode("/w", "default", "bypassPermissions");
		const restored = readFolderModes();
		writeFolderMode("/w", "plan");
		restoreFolderMode("/w", undefined, "acceptEdits");
		const kept = readFolderModes();
		restoreFolderMode("/w", undefined, "plan");
		expect({restored, kept, deleted: readFolderModes()}).toStrictEqual({
			restored: {"/w": "default"},
			kept: {"/w": "plan"},
			deleted: {},
		});
	});
});
