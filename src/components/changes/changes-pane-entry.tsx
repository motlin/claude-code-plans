import {useEffect} from "react";
import {useShortcut} from "../../hooks/use-shortcut";
import {deferredPane} from "../panes/deferred-pane";
import {registerPane} from "../panes/pane-registry";
import {usePaneHost} from "../panes/tile-host";

const DeferredChangesPane = deferredPane("Changes", () =>
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

/** Binds ⌃⇧D whether the titlebar toggle is shown or folded. */
export function ChangesPaneShortcut() {
	const host = usePaneHost();
	useShortcut("toggle_changes", () => host.togglePane("changes"));
	return null;
}
