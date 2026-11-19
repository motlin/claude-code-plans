import {describe, expect, it} from "vite-plus/test";
import {contextFullNotice} from "../src/lib/context-full-notice";

describe("contextFullNotice", () =>
{
	it("picks upstream's api_prompt_too_long body for the retry, composer and no-composer states, plain and compact-failed", () =>
	{
		expect([
			contextFullNotice(
				{
					compactFailed: false,
					retryShown: false,
					hasComposer: true,
				},
			),
			contextFullNotice(
				{
					compactFailed: false,
					retryShown: false,
					hasComposer: false,
				},
			),
			contextFullNotice(
				{
					compactFailed: true,
					retryShown: true,
					hasComposer: true,
				},
			),
			contextFullNotice(
				{
					compactFailed: true,
					retryShown: false,
					hasComposer: true,
				},
			),
			contextFullNotice(
				{
					compactFailed: true,
					retryShown: false,
					hasComposer: false,
				},
			),
		]).toStrictEqual([
			{
				title: "Your context window is full",
				body: "This conversation is too long to continue. You can start a new session, or turn off some connectors to free up space.",
				retryHelps: false,
			},
			{
				title: "Your context window is full",
				body: "This conversation is too long to continue. Start a new session.",
				retryHelps: false,
			},
			{
				title: "Your context window is full",
				body: "Couldn’t compact this conversation to free up space. Try again, or start a new session.",
				retryHelps: true,
			},
			{
				title: "Your context window is full",
				body: "Couldn’t compact this conversation to free up space. Send a message to try again, or start a new session.",
				retryHelps: true,
			},
			{
				title: "Your context window is full",
				body: "Couldn’t compact this conversation to free up space. Start a new session.",
				retryHelps: true,
			},
		]);
	});
});
