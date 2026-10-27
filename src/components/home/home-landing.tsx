import type {ReactNode} from "react";

import {HomeLaunchFolderProvider} from "./launch-folder";
import {HomePage} from "./home-page";
import {HomeStartCard} from "./start-card";
import {START_CARD_WRAPPER_CLASS, useStartCardPlacement} from "./start-card-placement";
import {useHomeNextSteps} from "./use-home-next-steps";

/**
 * The home page body: upstream's start card (Recent environments and Next steps) alone between the
 * "New session" titlebar and the docked composer, which share one launch folder. Like upstream, the
 * card is centred above the composer and Next steps hides when it doesn't fit.
 */
export function HomeLanding({dock}: Readonly<{dock?: ReactNode}>) {
	return (
		<HomeLaunchFolderProvider>
			<HomeLandingBody dock={dock} />
		</HomeLaunchFolderProvider>
	);
}

/** Inside the provider, so Next steps reads the composer's launch folder and Worktree state. */
function HomeLandingBody({dock}: Readonly<{dock?: ReactNode}>) {
	const nextSteps = useHomeNextSteps();
	const placementRef = useStartCardPlacement();

	return (
		<HomePage dock={dock}>
			<div
				ref={placementRef}
				data-home-action-center
				data-perf-ready={nextSteps === undefined ? undefined : ""}
				className={START_CARD_WRAPPER_CLASS}
			>
				<div className="flex w-full flex-col">
					<HomeStartCard nextSteps={nextSteps} />
				</div>
			</div>
		</HomePage>
	);
}
