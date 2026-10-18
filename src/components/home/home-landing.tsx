import type {ReactNode} from "react";

import {HomeLaunchFolderProvider} from "./launch-folder";
import {HomePage} from "./home-page";
import {HomeStartCard} from "./start-card";
import {useHomeNextSteps} from "./use-home-next-steps";

/**
 * The home page body: upstream's start card (Recent environments and Next steps) alone between the
 * "New session" titlebar and the docked composer, which share one launch folder.
 */
export function HomeLanding({dock}: Readonly<{dock?: ReactNode}>) {
	const nextSteps = useHomeNextSteps();

	return (
		<HomeLaunchFolderProvider>
			<HomePage dock={dock}>
				<div
					data-home-action-center
					data-perf-ready={nextSteps === undefined ? undefined : ""}
					className="flex flex-col gap-10 pt-6 pb-14"
				>
					<HomeStartCard nextSteps={nextSteps} />
				</div>
			</HomePage>
		</HomeLaunchFolderProvider>
	);
}
