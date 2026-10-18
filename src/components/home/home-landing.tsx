import type {ReactNode} from "react";

import {AttentionSection} from "./attention-section";
import {useHomeAttention} from "./use-home-attention";
import {HomeLocalSections} from "./local-sections";
import {HomeLaunchFolderProvider} from "./launch-folder";
import {HomePage} from "./home-page";
import {HomeStartCard} from "./start-card";
import {HomeStatsSection} from "./home-stats-card";
import {PullRequestsSection} from "./pull-requests-section";

/**
 * The home page body: the Sessions and Pull requests action center, or, once nothing needs attention,
 * the usage stats card in its place, under the start card's recent folders. The start card and the
 * docked composer share one launch folder.
 */
export function HomeLanding({dock}: Readonly<{dock?: ReactNode}>) {
	const attention = useHomeAttention();
	const clear = attention?.items.length === 0 && attention.prs.length === 0;

	return (
		<HomeLaunchFolderProvider>
			<HomePage dock={dock}>
				<div
					data-home-action-center
					data-perf-ready={attention === undefined ? undefined : ""}
					className="flex flex-col gap-10 pt-6 pb-14"
				>
					<HomeStartCard />
					{attention === undefined ? null : clear ? (
						<HomeStatsSection />
					) : (
						<>
							<AttentionSection {...attention} />
							<PullRequestsSection
								rows={attention.prs}
								rowLimit={attention.rowLimit}
								now={attention.now}
								onOpen={attention.onOpen}
							/>
						</>
					)}
					<HomeLocalSections />
				</div>
			</HomePage>
		</HomeLaunchFolderProvider>
	);
}
