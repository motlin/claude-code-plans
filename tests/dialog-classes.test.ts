import {describe, expect, it} from "vite-plus/test";

import {DIALOG_BODY_CLASS} from "../src/components/ui/dialog-classes";

describe("DIALOG_BODY_CLASS", () => {
	it("is upstream's cds Dialog body (Xn) minus its padding, scroll-fade-y included", () => {
		expect(DIALOG_BODY_CLASS).toStrictEqual(
			"isolate flex min-h-0 flex-1 flex-col overflow-y-auto scroll-fade-y rounded-[inherit] break-words",
		);
	});
});
