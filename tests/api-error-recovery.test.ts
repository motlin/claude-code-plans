import {describe, expect, it} from "vite-plus/test";
import {fallbackModel, recoveryActions, type RecoveryInput} from "../src/lib/api-error-recovery";

const NONE: RecoveryInput = {
	retryHelps: false,
	rewindHelps: false,
	compactHelps: false,
	isOverloaded: false,
	modelSwitchHelps: false,
	retried: false,
	canRetry: true,
	canRewind: true,
	canCompact: true,
	canFallback: true,
	currentModelLabel: "Opus 5.5",
};

const OVERLOADED: RecoveryInput = {
	...NONE,
	retryHelps: true,
	isOverloaded: true,
	modelSwitchHelps: true,
	fallbackModelLabel: "Sonnet",
	modelItems: [
		{value: "opus", checked: true},
		{value: "sonnet", checked: false},
	],
};

const CONTEXT_LENGTH: RecoveryInput = {...NONE, compactHelps: true, rewindHelps: true};
const IMAGE_DIMENSION: RecoveryInput = {...NONE, rewindHelps: true};

describe("recoveryActions", () => {
	it("follows upstream's Kt visibility, primary choice and primary-last order", () => {
		expect([
			recoveryActions(OVERLOADED),
			recoveryActions({...OVERLOADED, modelItems: [{value: "opus", checked: true}]}),
			recoveryActions({...NONE, retryHelps: true}),
			recoveryActions(CONTEXT_LENGTH),
			recoveryActions({...CONTEXT_LENGTH, canRewind: false}),
			recoveryActions(IMAGE_DIMENSION),
			recoveryActions({...IMAGE_DIMENSION, canRewind: false}),
			recoveryActions({...OVERLOADED, retried: true}),
			recoveryActions({...OVERLOADED, canRetry: false}),
		]).toStrictEqual([
			[
				{key: "switch-model", primary: false, label: "Opus 5.5"},
				{key: "retry", primary: true, label: "Try again"},
			],
			// Upstream's Fe hides Try again whenever the fallback shows.
			[{key: "fallback", primary: true, label: "Try again with Sonnet"}],
			[{key: "retry", primary: true, label: "Try again"}],
			[{key: "compact-split", primary: true, label: "Compact session"}],
			[{key: "compact", primary: true, label: "Compact session"}],
			[{key: "rewind", primary: true, label: "Rewind"}],
			[],
			[],
			[],
		]);
	});
});

describe("fallbackModel", () => {
	it("maps opus to Sonnet and sonnet to Haiku like upstream's Aq/jq", () => {
		expect([
			fallbackModel("claude-opus-5-5"),
			fallbackModel("claude-sonnet-4-6"),
			fallbackModel("claude-haiku-4-5"),
		]).toStrictEqual([{alias: "sonnet", label: "Sonnet"}, {alias: "haiku", label: "Haiku"}, undefined]);
	});
});
