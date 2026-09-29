import { Popover } from "@base-ui/react/popover";
import { Plus } from "lucide-react";

import {
  type ComposerState,
  type ComposerUsage,
  FIVE_HOUR_LABEL,
  formatContextSummary,
  formatResetsIn,
  formatUpdatedAgo,
  formatUsageAriaLabel,
  type RateLimitWindow,
  USAGE_RING_CIRCUMFERENCE,
  usageRingDashoffset,
  WEEKLY_LABEL,
} from "../lib/composer-state";
import { type LaunchOptions, modeTriggerLabel, modelLabel } from "../lib/launch-options";
import {
  CHIN_BUTTON_CLASS,
  type ChinMenu,
  EffortSelector,
  ModeMenu,
  ModelMenu,
} from "./composer-launch-menus";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./ui/menu";

const POPUP_CLASS =
  "flex w-[360px] max-w-[calc(100vw-16px)] flex-col gap-3 rounded-card bg-[var(--menu-bg)] p-3 text-[12px]/[16px] text-primary shadow-[var(--menu-shadow)] outline-none";

function Meter({ percent, label }: { percent: number; label: string }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className="h-1 w-full overflow-hidden rounded-r3 bg-alpha-1"
    >
      <div className="h-full rounded-r3 bg-accent-100" style={{ width: `${clamped}%` }} />
    </div>
  );
}

function LimitRow({ label, window }: { label: string; window: RateLimitWindow }) {
  const percent = Math.round(window.usedPercentage);
  return (
    <div className="flex flex-col gap-1">
      <div data-usage-row className="flex items-baseline gap-2">
        <span className="text-primary">{label}</span>
        <span className="text-t6">Resets in {formatResetsIn(window.resetsAt, Date.now())}</span>
        <span className="ms-auto tabular-nums text-secondary">{percent}%</span>
      </div>
      <Meter percent={window.usedPercentage} label={label} />
    </div>
  );
}

function UsagePopoverBody({ usage }: { usage: ComposerUsage | null }) {
  const limits = [
    usage?.fiveHour ? { label: FIVE_HOUR_LABEL, window: usage.fiveHour } : null,
    usage?.weekly ? { label: WEEKLY_LABEL, window: usage.weekly } : null,
  ].filter((limit) => limit !== null);
  return (
    <>
      <Popover.Title className="sr-only">Usage</Popover.Title>
      <div className="flex flex-col gap-1.5">
        <div data-usage-context className="flex items-baseline justify-between gap-2">
          <span className="font-medium">Context window</span>
          <span className="tabular-nums text-secondary">{formatContextSummary(usage)}</span>
        </div>
        <Meter percent={usage?.contextPercent ?? 0} label="Context window" />
        {usage?.updatedAt && (
          <p data-usage-updated className="text-t6">
            Last updated {formatUpdatedAgo(usage.updatedAt, Date.now())}. Send a message to refresh.
          </p>
        )}
      </div>
      {limits.length > 0 && (
        <>
          <div className="h-px bg-alpha-2" />
          <div className="flex flex-col gap-2">
            <span className="font-medium">Plan usage limits</span>
            {limits.map((limit) => (
              <LimitRow key={limit.label} label={limit.label} window={limit.window} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function UsageRing({ usage }: { usage: ComposerUsage | null }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={formatUsageAriaLabel(usage, Date.now())}
        className={`${CHIN_BUTTON_CLASS} aspect-square`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" className="-rotate-90" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="none" strokeWidth="2" stroke="var(--color-alpha-2)" />
          <circle
            data-usage-ring-arc
            cx="6"
            cy="6"
            r="5"
            fill="none"
            strokeWidth="2"
            strokeLinecap="round"
            stroke="var(--accent-100)"
            strokeDasharray={USAGE_RING_CIRCUMFERENCE}
            strokeDashoffset={usageRingDashoffset(usage?.contextPercent ?? null)}
          />
        </svg>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={6} className="z-[130]">
          <Popover.Popup className={POPUP_CLASS}>
            <UsagePopoverBody usage={usage} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface ChinLaunchControls {
  launchOptions: LaunchOptions;
  onLaunchOptionsChange: (next: LaunchOptions) => void;
  openMenu: ChinMenu | null;
  onOpenMenuChange: (menu: ChinMenu | null) => void;
  bypassPermissionsAllowed: boolean;
}

/**
 * The claude.ai/code composer chin: `+` and the permission mode on the left;
 * model, effort and the 12px context-usage ring on the right. Mode, model and
 * effort open menus whose choices apply to the next fork or launch.
 */
export function ComposerChin({
  state,
  onInsertSlash,
  launch,
}: {
  state: ComposerState;
  onInsertSlash: () => void;
  launch: ChinLaunchControls;
}) {
  const { launchOptions, onLaunchOptionsChange, openMenu, onOpenMenuChange } = launch;
  const menuProps = (menu: ChinMenu) => ({
    open: openMenu === menu,
    onOpenChange: (open: boolean) => onOpenMenuChange(open ? menu : null),
  });
  const modeLabel =
    launchOptions.permissionMode === undefined
      ? (state.mode?.label ?? "Manual")
      : modeTriggerLabel(launchOptions.permissionMode);
  const modelText =
    launchOptions.model === undefined
      ? (state.model ?? "Default model")
      : modelLabel(launchOptions.model);
  return (
    <>
      <div className="flex min-w-0 items-center self-start">
        <Menu>
          <MenuTrigger aria-label="Add" className={`${CHIN_BUTTON_CLASS} aspect-square`}>
            <Plus className="size-3.5" aria-hidden="true" />
          </MenuTrigger>
          <MenuContent side="top">
            <MenuItem onSelect={onInsertSlash}>Slash commands</MenuItem>
          </MenuContent>
        </Menu>
        <ModeMenu
          {...menuProps("mode")}
          current={launchOptions.permissionMode ?? state.mode?.id ?? "default"}
          currentLabel={modeLabel}
          bypassPermissionsAllowed={launch.bypassPermissionsAllowed}
          onSelect={(permissionMode) => onLaunchOptionsChange({ ...launchOptions, permissionMode })}
        />
      </div>
      <div className="ms-auto flex min-w-0 items-center gap-1 ps-2">
        <ModelMenu
          {...menuProps("model")}
          current={launchOptions.model}
          currentLabel={modelText}
          onSelect={(model) => onLaunchOptionsChange({ ...launchOptions, model })}
        />
        <EffortSelector
          {...menuProps("effort")}
          current={launchOptions.effort ?? state.effort.id}
          onSelect={(effort) => onLaunchOptionsChange({ ...launchOptions, effort })}
        />
        <UsageRing usage={state.usage} />
      </div>
    </>
  );
}
