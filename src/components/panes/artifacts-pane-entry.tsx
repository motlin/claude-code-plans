import {useQuery} from "@tanstack/react-query";
import {useEffect} from "react";

import {type SessionArtifact, sessionArtifactsQueryOptions} from "../../lib/api/artifacts";
import {SessionArtifactsList} from "./artifacts-pane";
import {registerPane} from "./pane-registry";

/** The session's artifacts, refetched whenever the session itself refreshes. */
export function useSessionArtifacts(sessionId: string): SessionArtifact[] {
	return useQuery(sessionArtifactsQueryOptions(sessionId)).data ?? [];
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
