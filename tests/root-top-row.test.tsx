// @vitest-environment jsdom

import {cleanup, render} from "@testing-library/react";
import {afterEach, describe, expect, it} from "vite-plus/test";
import {RootTopRow} from "../src/routes/__root";

afterEach(cleanup);

describe("RootTopRow", () => {
	it("reserves a 48px band at phone width so page titles start below the fixed Show-sidebar trigger", () => {
		const {container} = render(<RootTopRow />);
		expect((container.firstElementChild as HTMLElement).className).toBe("min-h-9 px-4 pt-3 max-sm:h-12 sm:px-8");
	});
});
