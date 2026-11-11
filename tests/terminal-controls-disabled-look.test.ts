import {describe, expect, it} from "vite-plus/test";

import {GHOST_ICON_BUTTON} from "../src/components/panes/terminal-tab-strip";
import {OVERLAY_BUTTON_CLASS} from "../src/components/shell-terminal";
import {
	CDS_BUTTON_DISABLED,
	CDS_BUTTON_DISABLED_FILL,
	CDS_ICON_ONLY_DISABLED,
} from "../src/components/ui/cds-button-disabled";

const disabledLook = (classes: string) => classes.split(" ").filter((name) => name.includes("disabled"));

describe("local-only terminal controls take upstream's cds Button disabled look", () => {
	it("gives the tab strip's icon buttons the icon-only look and the shell overlay's buttons the filled look", () => {
		expect({
			iconButton: disabledLook(GHOST_ICON_BUTTON),
			overlay: disabledLook(OVERLAY_BUTTON_CLASS),
		}).toStrictEqual({
			iconButton: [...CDS_BUTTON_DISABLED.split(" "), CDS_ICON_ONLY_DISABLED],
			overlay: [...CDS_BUTTON_DISABLED.split(" "), CDS_BUTTON_DISABLED_FILL],
		});
	});
});
