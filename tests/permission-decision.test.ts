import {describe, expect, it} from "vite-plus/test";
import {
	permissionDecisionLabel,
	permissionDecisionTitle,
	type PermissionDecision,
} from "../src/lib/permission-decision";

function labels(decisions: readonly PermissionDecision[]): (string | null)[] {
	return decisions.map(permissionDecisionLabel);
}

describe("permissionDecisionLabel", () => {
	it("names what allowed an accepted call", () => {
		expect(
			labels([
				{decision: "accept", source: "config", reasonType: "classifier"},
				{decision: "accept", source: "config", reasonType: "mode"},
				{decision: "accept", source: "config", reasonType: "rule"},
				{decision: "accept", source: "config", reasonType: "subcommandResults"},
				{decision: "accept", source: "config", reasonType: "other"},
				{decision: "accept", source: "config"},
				{decision: "accept", source: "hook", reasonType: "hook"},
				{decision: "accept", source: "user_temporary"},
				{decision: "accept", source: "user_permanent", reasonType: "rule"},
			]),
		).toStrictEqual([
			"Allowed by auto mode",
			"Allowed by permission mode",
			"Allowed by rule",
			"Allowed by rules",
			"Allowed by settings",
			"Allowed by settings",
			"Allowed by hook",
			"Approved once",
			"Approved always",
		]);
	});

	it("names what blocked a rejected call", () => {
		expect(
			labels([
				{decision: "reject", source: "hook", reasonType: "hook"},
				{decision: "reject", source: "config", reasonType: "classifier"},
				{decision: "reject", source: "config", reasonType: "safetyCheck"},
				{decision: "reject", source: "config", reasonType: "rule"},
			]),
		).toStrictEqual(["Blocked by hook", "Blocked by auto mode", "Blocked by safety check", "Blocked by rule"]);
	});

	it("says nothing when the user rejected the call, which the row already reports", () => {
		expect(permissionDecisionLabel({decision: "reject", source: "user_reject"})).toBeNull();
	});
});

describe("permissionDecisionTitle", () => {
	it("spells out the raw decision, source and reason", () => {
		expect([
			permissionDecisionTitle({decision: "accept", source: "config", reasonType: "classifier"}),
			permissionDecisionTitle({decision: "accept", source: "user_temporary"}),
		]).toStrictEqual(["Permission: Accepted · Configuration · Classifier", "Permission: Accepted · User (once)"]);
	});
});
