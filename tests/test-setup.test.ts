// @vitest-environment jsdom

import {AnimationFrame} from "@base-ui/utils/useAnimationFrame";
import {describe, expect, it} from "vite-plus/test";

describe("jsdom test setup", () => {
	it("provides navigator.sendBeacon, which the perf journey tracker's flush timer calls and jsdom lacks", () => {
		expect(typeof navigator.sendBeacon).toBe("function");
	});

	describe("the document selection", () => {
		it("ends a test with a range selected", () => {
			const text = document.createElement("p");
			text.textContent = "selected text";
			document.body.append(text);
			const range = document.createRange();
			range.selectNodeContents(text);
			document.getSelection()?.addRange(range);
		});

		// addRange is ignored while the selection already holds a range, so a range left behind breaks a later test's.
		it("starts the next test with nothing selected", () => {
			expect(document.getSelection()?.rangeCount).toBe(0);
		});
	});

	describe("Base UI's shared animation frame scheduler", () => {
		it("ends a test with the scheduler's frame still queued", () => {
			AnimationFrame.request(() => {});
		});

		// The setup cancels the frame the previous test left queued; the scheduler must not stay marked as scheduled.
		it("still runs a frame callback in the next test", async () => {
			const ran = await new Promise<string>((resolve) => {
				AnimationFrame.request(() => {
					resolve("ran");
				});
				window.setTimeout(() => {
					resolve("never ran");
				}, 200);
			});
			expect(ran).toBe("ran");
		});
	});
});
