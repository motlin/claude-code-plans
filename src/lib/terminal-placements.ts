import { createHerdrPlacementProvider, type HerdrTerminalPlacement } from "./herdr/panes";
import { createTmuxPlacementProvider, type TmuxTerminalPlacement } from "./tmux-windows";

export type TerminalProviderId = "tmux" | "herdr";

export interface TerminalPlacementCapabilities {
  readonly supportsWrite: boolean;
  readonly supportsEvents: boolean;
  readonly supportsObserve: boolean;
}

export interface TerminalPlacementBase {
  provider: TerminalProviderId;
  sessionId: string;
  displayName: string;
  active: boolean;
  paneHandle: string;
  scopeHandle: string;
  capabilities: TerminalPlacementCapabilities;
}

export type TerminalPlacement = TmuxTerminalPlacement | HerdrTerminalPlacement;

export interface TerminalPlacementProvider {
  readonly id: TerminalProviderId;
  readonly capabilities: TerminalPlacementCapabilities;
  getPlacements: () => Promise<TerminalPlacement[]>;
}

function defaultProviders(): TerminalPlacementProvider[] {
  return [createTmuxPlacementProvider(), createHerdrPlacementProvider()];
}

/**
 * Read every provider independently and merge their placements in stable
 * provider order. Herdr replaces tmux only for sessions reported by both.
 */
export async function getTerminalPlacements(
  providers: TerminalPlacementProvider[] = defaultProviders(),
): Promise<TerminalPlacement[]> {
  const results = await Promise.allSettled(providers.map((provider) => provider.getPlacements()));
  const placements = results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const herdrPlacements = placements.filter(
    (placement): placement is HerdrTerminalPlacement => placement.provider === "herdr",
  );
  const herdrSessionIds = new Set(herdrPlacements.map((placement) => placement.sessionId));
  const tmuxPlacements = placements.filter(
    (placement): placement is TmuxTerminalPlacement =>
      placement.provider === "tmux" && !herdrSessionIds.has(placement.sessionId),
  );

  return [...tmuxPlacements, ...herdrPlacements];
}
