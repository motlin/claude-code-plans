import {describe, expect, it} from "vite-plus/test";
import {TOUCH_REVEAL} from "../src/lib/touch-reveal";

describe("TOUCH_REVEAL", () => {
	it("reveals hover-only controls on coarse pointers and hover-less devices, as upstream's tool-row trail", () => {
		expect(TOUCH_REVEAL).toBe(
			"pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto",
		);
	});
});
