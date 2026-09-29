import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";

import { formatTokenCount } from "../lib/home-stats";
import { formatModelName } from "../lib/model-name";
import { formatUsd, type SessionCostState } from "../lib/session-cost";
import { formatDuration } from "./tool-renderers/shared";

const POPUP_CLASS =
  "flex w-[320px] max-w-[calc(100vw-16px)] flex-col gap-2 rounded-card bg-[var(--menu-bg)] p-3 text-[12px]/[16px] text-primary shadow-[var(--menu-shadow)] outline-none";

const ROW_CLASS = "flex items-baseline justify-between gap-2";

function modelTokenSummary(model: SessionCostState["models"][number]): string {
  const parts = [
    `${formatTokenCount(model.inputTokens)} in`,
    `${formatTokenCount(model.outputTokens)} out`,
  ];
  if (model.cacheReadInputTokens > 0) {
    parts.push(`${formatTokenCount(model.cacheReadInputTokens)} cache read`);
  }
  if (model.cacheCreationInputTokens > 0) {
    parts.push(`${formatTokenCount(model.cacheCreationInputTokens)} cache write`);
  }
  return parts.join(" · ");
}

function CostRow({ kind, label, value }: { kind: string; label: string; value: string }) {
  return (
    <div data-cost-row={kind} className={ROW_CLASS}>
      <span className="text-secondary">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function CostBreakdown({ cost }: { cost: SessionCostState }) {
  return (
    <>
      <Popover.Title className="sr-only">Session cost</Popover.Title>
      <div data-cost-row="total" className={`${ROW_CLASS} font-medium`}>
        <span>Total cost</span>
        <span className="tabular-nums">{formatUsd(cost.totalCostUSD)}</span>
      </div>
      <CostRow
        kind="lines"
        label="Lines changed"
        value={`+${cost.linesAdded} −${cost.linesRemoved}`}
      />
      {cost.apiDurationMs !== undefined && (
        <CostRow kind="api" label="API time" value={formatDuration(cost.apiDurationMs)} />
      )}
      {cost.toolDurationMs !== undefined && (
        <CostRow kind="tools" label="Tool time" value={formatDuration(cost.toolDurationMs)} />
      )}
      {cost.models.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          {cost.models.map((model) => (
            <div key={model.model} data-cost-row="model" className="grid grid-cols-[1fr_auto]">
              <span title={model.model} className="truncate">
                {formatModelName(model.model) ?? model.model}
              </span>
              <span className="tabular-nums">{formatUsd(model.costUSD)}</span>
              <span className="col-span-2 text-caption text-secondary tabular-nums">
                {modelTokenSummary(model)}
              </span>
            </div>
          ))}
        </div>
      )}
      {cost.hasUnknownModelCost && (
        <p data-cost-unknown="" className="text-caption text-secondary">
          Some models have no known price, so the total is a floor.
        </p>
      )}
    </>
  );
}

/**
 * The session's spend from its latest `cost-state` record, as an origin pill
 * that opens the lines-changed, timing and per-model breakdown.
 */
export function SessionCostPill({
  cost,
  className,
  children,
}: {
  cost: SessionCostState;
  className: string;
  /** The pill's face, e.g. the formatted total. */
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        data-origin-pill="cost"
        aria-label={`Session cost: ${formatUsd(cost.totalCostUSD)}`}
        className={className}
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-[130]">
          <Popover.Popup className={POPUP_CLASS}>
            <CostBreakdown cost={cost} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
