import type { ReactNode } from "react";

import { AttentionSection } from "./attention-section";
import { useHomeAttention } from "./use-home-attention";
import { HomeLocalSections } from "./local-sections";
import { HomePage } from "./home-page";
import { HomeStatsSection } from "./home-stats-card";

/**
 * The home page body: the Sessions action center, or, once nothing needs attention,
 * upstream's "What’s up next?" greeting with the usage stats card in its place.
 */
export function HomeLanding({ dock }: Readonly<{ dock?: ReactNode }>) {
  const attention = useHomeAttention();
  const clear = attention !== undefined && attention.items.length === 0;

  return (
    <HomePage clear={clear} dock={dock}>
      <div data-home-action-center className="flex flex-col gap-10 pt-6 pb-14">
        {attention === undefined ? null : clear ? (
          <HomeStatsSection />
        ) : (
          <AttentionSection {...attention} />
        )}
        <HomeLocalSections />
      </div>
    </HomePage>
  );
}
