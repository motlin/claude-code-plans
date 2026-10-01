import {describe, expect, it} from "vite-plus/test";
import * as settingsEditRoute from "../src/routes/settings_.edit";

describe("/settings/edit route code splitting", () => {
	// TanStack's code splitter only moves unexported bindings into the lazy `?tsr-split=component` chunk. Anything the
	// route file exports stays in the reference module that routeTree.gen imports from the client entry, so it (and
	// everything it pulls in) lands in every page's cold load, including home.
	it("exports only Route, so the settings editor stays in the lazy route chunk", () => {
		expect(Object.keys(settingsEditRoute)).toStrictEqual(["Route"]);
	});
});
