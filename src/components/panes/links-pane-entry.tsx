import {useEffect} from "react";
import {deferredPane} from "./deferred-pane";
import type {LinksPaneProps} from "./links-pane";
import {registerPane} from "./pane-registry";

const DeferredLinksPane = deferredPane("Links", () => import("./links-pane").then((module) => module.LinksPane));

/** Registers the local-only `links` pane kind (View options ▸ Links) while mounted; its list loads when it shows. */
export function useRegisterLinksPane({sessionId, lines, windowStartIndex, jumpTargetWindow}: LinksPaneProps): void {
	useEffect(
		() =>
			registerPane("links", {
				title: "Links",
				render: () => (
					<DeferredLinksPane
						resetKey={sessionId}
						props={{sessionId, lines, windowStartIndex, jumpTargetWindow}}
					/>
				),
			}),
		[sessionId, lines, windowStartIndex, jumpTargetWindow],
	);
}
