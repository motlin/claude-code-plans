import {useEffect} from "react";
import {deferredPane} from "../panes/deferred-pane";
import {registerPane} from "../panes/pane-registry";

const DeferredChangesPane = deferredPane("Changes", async () =>
	import("./changes-pane").then((module) => module.ChangesPane),
);

/** Register metadata immediately so saved layouts and deep links retain the pane while its renderer loads. */
export function useRegisterChangesPane(sessionId: string): void {
	useEffect(
		() =>
			registerPane("changes", {
				title: "Changes",
				header: "custom",
				render: (chrome) => (
					<DeferredChangesPane resetKey={sessionId} chrome={chrome} props={{sessionId, chrome}} />
				),
			}),
		[sessionId],
	);
}
