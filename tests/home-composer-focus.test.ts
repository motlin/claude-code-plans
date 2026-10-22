import {describe, expect, it} from "vite-plus/test";
import {onHomeComposerPrefillRequest, requestHomeComposerPrefill} from "../src/lib/home-composer-focus";

describe("home composer prefill bus", () => {
	it("delivers prefill text to every subscribed listener until it unsubscribes", () => {
		const received: string[] = [];
		const unsubscribe = onHomeComposerPrefillRequest((text) => received.push(text));

		requestHomeComposerPrefill("first");
		unsubscribe();
		requestHomeComposerPrefill("second");

		expect(received).toStrictEqual(["first"]);
	});
});
