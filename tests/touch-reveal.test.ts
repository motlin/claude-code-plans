import {describe, expect, it} from "vite-plus/test";
import {TOUCH_HIT, TOUCH_REVEAL} from "../src/lib/touch-reveal";

describe("TOUCH_REVEAL", () => {
	it("reveals hover-only controls on coarse pointers and hover-less devices, as upstream's tool-row trail", () => {
		expect(TOUCH_REVEAL).toBe(
			"pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
		);
	});
});

describe("TOUCH_HIT", () => {
	it("grows a tiny control's hit area to 44px on coarse pointers and hover-less devices with an ::after overlay, as upstream's .touch", () => {
		expect(TOUCH_HIT).toBe(
			"relative pointer-coarse:after:absolute pointer-coarse:after:-inset-[max(0px,calc((2.75rem-100%)/2))] [@media(hover:none)]:after:absolute [@media(hover:none)]:after:-inset-[max(0px,calc((2.75rem-100%)/2))]",
		);
	});
});
