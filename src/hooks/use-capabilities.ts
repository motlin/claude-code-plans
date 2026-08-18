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
  pending: boolean;
  error: Error | null;
  states: Capabilities;
  showReadOnlyMcpServer: boolean;
  showWorkingCopyReview: boolean;
  showSessionContextBrief: boolean;
}

function unresolvedCapabilities(persisted: PersistedCapabilities): Capabilities {
  return {
    readOnlyMcpServer: {
      ...persisted.readOnlyMcpServer,
      installed: true,
      available: false,
      unavailabilityReason: null,
    },
    workingCopyReview: {
      ...persisted.workingCopyReview,
      installed: true,
      available: false,
      unavailabilityReason: null,
    },
    sessionContextBrief: {
      ...persisted.sessionContextBrief,
      installed: true,
      available: false,
      unavailabilityReason: null,
    },
  };
}

export interface CapabilityQueryState {
  data: Capabilities | undefined;
  isPending: boolean;
  error: Error | null;
}

export function resolveCapabilityFlags(
  persisted: PersistedCapabilities,
  loaded: boolean,
  query: CapabilityQueryState,
): CapabilityFlags {
  return {
    loaded,
    pending: loaded && query.isPending,
    error: loaded ? query.error : null,
    states: query.data ?? unresolvedCapabilities(persisted),
    showReadOnlyMcpServer: capabilityVisible(loaded, persisted, "readOnlyMcpServer"),
    showWorkingCopyReview: capabilityVisible(loaded, persisted, "workingCopyReview"),
    showSessionContextBrief: capabilityVisible(loaded, persisted, "sessionContextBrief"),
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
  return resolveCapabilityFlags(settings.capabilities, loaded, query);
}
