import {describe, expect, it} from "vite-plus/test";
import {mergeRefill, rejectedRetryAction, sendRejectedCopy, startFailedOffscreenToast} from "../src/lib/send-rejection";

describe("rejectedRetryAction", () => {
	it("resends when the composer still holds the rejected prompt", () => {
		expect(rejectedRetryAction("hi", "hi")).toEqual("resend");
	});

	it("focuses when the composer text was edited", () => {
		expect(rejectedRetryAction("hi", "hi edited")).toEqual("focus");
	});

	it("focuses when there is no rejected prompt", () => {
		expect(rejectedRetryAction(null, "hi")).toEqual("focus");
	});
});

describe("sendRejectedCopy", () => {
	it("returns the generic resendable copy", () => {
		expect(sendRejectedCopy({nonResendable: false})).toEqual({
			title: "Something went wrong",
			body: "Try sending your message again. If it keeps failing, the error details show why.",
			retry: true,
		});
	});

	it("returns the non-resendable copy without a retry", () => {
		expect(sendRejectedCopy({nonResendable: true})).toEqual({
			title: "Something went wrong",
			body: "Your message didn’t send. Check the error details before sending it again.",
			retry: false,
		});
	});
});

describe("mergeRefill", () => {
	it("returns the rejected prompt when the composer is blank", () => {
		expect(mergeRefill("hi", "  \n")).toEqual("hi");
	});

	it("puts the rejected prompt above newer text", () => {
		expect(mergeRefill("hi", "new")).toEqual("hi\n\nnew");
	});
});

describe("startFailedOffscreenToast", () => {
	it("says the prompt is back on the New session page when the draft held text", () => {
		expect(startFailedOffscreenToast({promptIsBack: true})).toStrictEqual(
			"Your new session couldn’t start. Your prompt is back on the New session page.",
		);
	});

	it("says only that the session couldn't start when nothing came back", () => {
		expect(startFailedOffscreenToast({promptIsBack: false})).toStrictEqual("Your new session couldn’t start.");
	});
});
