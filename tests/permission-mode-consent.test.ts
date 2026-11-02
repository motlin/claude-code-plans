import {describe, expect, it} from "vite-plus/test";
import
{
	consentCopy,
	consentWorkspaceKey,
	isAcked,
	needsConsent,
	PERMISSION_SECURITY_GUIDE_URL,
	recordAck,
} from "../src/lib/permission-mode-consent";

const BYPASS_DESCRIPTION =
	"Claude will read, edit, and execute files without asking — including potentially destructive commands. Only use this in isolated or disposable environments.";
const AUTO_DESCRIPTION =
	"Claude will decide which actions are safe to run without asking. Longer tasks run uninterrupted, with extra safeguards against prompt injection.";

describe("needsConsent (upstream Lm)", () =>
{
	it("asks for Bypass always and for Auto only when auto isn't the default", () =>
	{
		const modes = ["default", "acceptEdits", "plan", "auto", "bypassPermissions"] as const;
		expect(
			{
				notDefault: modes.map((mode) =>
					needsConsent(
						mode,
						{
							autoIsDefault: false,
						},
					),
				),
				isDefault: modes.map((mode) =>
					needsConsent(
						mode,
						{
							autoIsDefault: true,
						},
					),
				),
			},
		).toStrictEqual(
			{
				notDefault: [false, false, false, true, true],
				isDefault: [false, false, false, false, true],
			},
		);
	});
});

describe("consentWorkspaceKey (upstream Hm)", () =>
{
	it("strips a trailing worktree so a worktree shares its repo's ack", () =>
	{
		expect([
			consentWorkspaceKey("/Users/a/app/.claude/worktrees/feat-x"),
			consentWorkspaceKey("/Users/a/app"),
			consentWorkspaceKey("/Users/a/app/.claude/worktrees/feat-x/sub"),
			consentWorkspaceKey(undefined),
		]).toStrictEqual(["/Users/a/app", "/Users/a/app", "/Users/a/app/.claude/worktrees/feat-x/sub", ""]);
	});
});

describe("isAcked", () =>
{
	it("acks Bypass per workspace and Auto through the one consent", () =>
	{
		expect([
			isAcked(
				"bypassPermissions",
				{
					workspace: "/w",
					acks: ["/w:bypassPermissions"],
					autoConsented: false,
				},
			),
			isAcked(
				"bypassPermissions",
				{
					workspace: "/other",
					acks: ["/w:bypassPermissions"],
					autoConsented: true,
				},
			),
			isAcked(
				"bypassPermissions",
				{
					workspace: "",
					acks: [":bypassPermissions"],
					autoConsented: false,
				},
			),
			isAcked(
				"auto",
				{
					workspace: "/w",
					acks: [],
					autoConsented: true,
				},
			),
			isAcked(
				"auto",
				{
					workspace: "/w",
					acks: ["/w:bypassPermissions"],
					autoConsented: false,
				},
			),
		]).toStrictEqual([true, false, false, true, false]);
	});
});

describe("recordAck (upstream confirm)", () =>
{
	it("appends a deduped workspace ack for Bypass and sets the consent for Auto", () =>
	{
		expect([
			recordAck(
				{
					mode: "bypassPermissions",
					workspace: "/w",
					acks: ["/w:bypassPermissions"],
					autoConsented: false,
				},
			),
			recordAck(
				{
					mode: "bypassPermissions",
					workspace: "/v",
					acks: ["/w:bypassPermissions"],
					autoConsented: true,
				},
			),
			recordAck(
				{
					mode: "bypassPermissions",
					workspace: "",
					acks: [],
					autoConsented: false,
				},
			),
			recordAck(
				{
					mode: "auto",
					workspace: "/w",
					acks: ["/w:bypassPermissions"],
					autoConsented: false,
				},
			),
		]).toStrictEqual([
			{
				acks: ["/w:bypassPermissions"],
				autoConsented: false,
			},
			{
				acks: ["/w:bypassPermissions", "/v:bypassPermissions"],
				autoConsented: true,
			},
			{
				acks: [],
				autoConsented: false,
			},
			{
				acks: ["/w:bypassPermissions"],
				autoConsented: true,
			},
		]);
	});
});

describe("consentCopy (upstream cbf7370a7)", () =>
{
	it("uses upstream's strings for each variant", () =>
	{
		expect(
			{
				bypass: consentCopy(
					{
						mode: "bypassPermissions",
						workspace: "/w",
						asksEveryTime: false,
					},
				),
				bypassNoWorkspace: consentCopy(
					{
						mode: "bypassPermissions",
						workspace: "",
						asksEveryTime: false,
					},
				),
				auto: consentCopy(
					{
						mode: "auto",
						workspace: "/w",
						asksEveryTime: false,
					},
				),
				autoEveryTime: consentCopy(
					{
						mode: "auto",
						workspace: "/w",
						asksEveryTime: true,
					},
				),
				url: PERMISSION_SECURITY_GUIDE_URL,
			},
		).toStrictEqual(
			{
				bypass:
				{
					title: "Bypass all permissions?",
					description: BYPASS_DESCRIPTION,
					confirmLabel: "Bypass permissions",
					footnoteLead: "You won’t be asked again for this workspace. Read our ",
				},
				bypassNoWorkspace:
				{
					title: "Bypass all permissions?",
					description: BYPASS_DESCRIPTION,
					confirmLabel: "Bypass permissions",
					footnoteLead: "Read our ",
				},
				auto:
				{
					title: "Enable auto mode?",
					description: AUTO_DESCRIPTION,
					confirmLabel: "Enable auto mode",
					footnoteLead: "You won’t be asked again. Read our ",
				},
				autoEveryTime:
				{
					title: "Enable auto mode?",
					description: AUTO_DESCRIPTION,
					confirmLabel: "Enable auto mode",
					footnoteLead: "Read our ",
				},
				url: "https://code.claude.com/docs/en/security",
			},
		);
	});
});
