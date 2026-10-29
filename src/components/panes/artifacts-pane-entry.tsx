import {useQuery} from "@tanstack/react-query";
import {useEffect} from "react";

import {type SessionArtifact, sessionArtifactsQueryOptions} from "../../lib/api/artifacts";
import {SessionArtifactsList} from "./artifacts-pane";
import {registerPane} from "./pane-registry";

/** One empty list for every render before the query has data, so effects keyed on it don't re-run each render. */
const NO_ARTIFACTS: readonly SessionArtifact[] = [];

/** The session's artifacts, refetched whenever the session itself refreshes. */
export function useSessionArtifacts(sessionId: string): readonly SessionArtifact[] {
	return useQuery(sessionArtifactsQueryOptions(sessionId)).data ?? NO_ARTIFACTS;
}

/** Registers the `artifacts` pane kind for this session while mounted. */
export function useRegisterArtifactsPane(artifacts: readonly SessionArtifact[]): void {
	useEffect(
		() =>
			registerPane("artifacts", {
				title: "Artifacts",
				render: () => <SessionArtifactsList artifacts={artifacts} />,
			}),
		[artifacts],
	);
}
