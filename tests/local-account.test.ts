import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {type LocalAccount, readLocalAccount} from "../src/lib/local-account";

const homes: string[] = [];

function fixtureHome(claudeJson: unknown): string {
	const home = mkdtempSync(join(tmpdir(), "local-account-"));
	homes.push(home);
	if (claudeJson !== undefined) {
		writeFileSync(join(home, ".claude.json"), JSON.stringify(claudeJson));
	}
	return home;
}

afterEach(() => {
	for (const home of homes.splice(0)) rmSync(home, {recursive: true, force: true});
});

const cases: {name: string; claudeJson: unknown; expected: LocalAccount}[] = [
	{
		name: "missing file",
		claudeJson: undefined,
		expected: {name: "osuser", firstName: "osuser", initial: "O"},
	},
	{
		name: "no oauthAccount",
		claudeJson: {numStartups: 3, projects: {}},
		expected: {name: "osuser", firstName: "osuser", initial: "O"},
	},
	{
		name: "displayName only",
		claudeJson: {oauthAccount: {displayName: "craig"}},
		expected: {name: "craig", firstName: "craig", initial: "C"},
	},
	{
		name: "fullName only",
		claudeJson: {oauthAccount: {fullName: "Ada Lovelace", emailAddress: "ada@example.com"}},
		expected: {
			name: "Ada Lovelace",
			firstName: "Ada",
			initial: "A",
			email: "ada@example.com",
		},
	},
	{
		name: "max 20x",
		claudeJson: {
			oauthAccount: {
				accountUuid: "ignored",
				displayName: "Craig",
				fullName: "Craig Motlin",
				emailAddress: "craig@example.com",
				organizationType: "claude_max",
				organizationRateLimitTier: "default_claude_max_20x",
			},
		},
		expected: {
			name: "Craig",
			firstName: "Craig",
			initial: "C",
			email: "craig@example.com",
			planLabel: "Max",
			planDetail: "Max (20x)",
		},
	},
	{
		name: "max 5x",
		claudeJson: {
			oauthAccount: {
				displayName: "Craig",
				organizationType: "claude_max",
				organizationRateLimitTier: "default_claude_max_5x",
			},
		},
		expected: {
			name: "Craig",
			firstName: "Craig",
			initial: "C",
			planLabel: "Max",
			planDetail: "Max (5x)",
		},
	},
	{
		name: "pro",
		claudeJson: {
			oauthAccount: {
				displayName: "Craig",
				organizationType: "claude_pro",
				organizationRateLimitTier: "default_claude_ai",
			},
		},
		expected: {
			name: "Craig",
			firstName: "Craig",
			initial: "C",
			planLabel: "Pro",
			planDetail: "Pro",
		},
	},
	{
		name: "unknown organization type",
		claudeJson: {oauthAccount: {displayName: "Craig", organizationType: "claude_team"}},
		expected: {name: "Craig", firstName: "Craig", initial: "C"},
	},
	{
		name: "malformed oauthAccount",
		claudeJson: {oauthAccount: {displayName: 42}},
		expected: {name: "osuser", firstName: "osuser", initial: "O"},
	},
];

describe("readLocalAccount", () => {
	it.each(cases)("$name", async ({claudeJson, expected}) => {
		const home = fixtureHome(claudeJson);
		expect(await readLocalAccount({home, username: "osuser"})).toStrictEqual(expected);
	});
});
