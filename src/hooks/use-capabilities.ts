import { useQuery } from "@tanstack/react-query";
import { useSettings } from "../components/settings-provider";
import { capabilitiesQueryOptions } from "../lib/api/capabilities";
import {
  type Capabilities,
  type CapabilityId,
  type PersistedCapabilities,
} from "../lib/capabilities";

export interface CapabilityFlags {
  loaded: boolean;
  states: Capabilities;
  showReadOnlyMcpServer: boolean;
  showWorkingCopyReview: boolean;
  showSessionContextBrief: boolean;
}

function unresolvedCapabilities(
  persisted: PersistedCapabilities,
  installed: boolean,
  available: boolean,
): Capabilities {
  return {
    readOnlyMcpServer: { ...persisted.readOnlyMcpServer, installed, available },
    workingCopyReview: { ...persisted.workingCopyReview, installed, available },
    sessionContextBrief: { ...persisted.sessionContextBrief, installed, available },
  };
}

export function capabilityVisible(
  loaded: boolean,
  capabilities: PersistedCapabilities,
  capabilityId: CapabilityId,
): boolean {
  return !loaded || capabilities[capabilityId].enabled;
}

/** Client boundary: collapse capability state into the few booleans used by view call sites. */
export function useCapabilities(): CapabilityFlags {
  const { settings, loaded } = useSettings();
  const query = useQuery({
    ...capabilitiesQueryOptions(settings.capabilities),
    enabled: loaded,
  });
  const states =
    query.data ?? unresolvedCapabilities(settings.capabilities, true, !loaded || query.isPending);

  return {
    loaded,
    states,
    showReadOnlyMcpServer: capabilityVisible(loaded, settings.capabilities, "readOnlyMcpServer"),
    showWorkingCopyReview: capabilityVisible(loaded, settings.capabilities, "workingCopyReview"),
    showSessionContextBrief: capabilityVisible(
      loaded,
      settings.capabilities,
      "sessionContextBrief",
    ),
  };
}
