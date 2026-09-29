import { SlidersHorizontal } from "lucide-react";
import type { z } from "zod";

import {
  sessionActivityDaysLabels,
  sessionGroupByLabels,
  sessionSortByLabels,
  sessionStatusFilterLabels,
} from "../../lib/schema-choices";
import {
  clearSessionFilters,
  DEFAULT_SESSION_LIST_PREFS,
  filterLabel,
  SessionActivityDaysSchema,
  SessionGroupBySchema,
  SessionSortBySchema,
  SessionStatusFilterSchema,
  type SessionListPrefs,
} from "../../lib/session-groups";
import { useSettings } from "../settings-provider";
import {
  Menu,
  MenuCheckboxItem,
  MenuContent,
  MenuItem,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { SessionGroups } from "./session-groups";

type RadioPref = "statusFilter" | "activityDays" | "groupBy" | "sortBy";

function RadioSubmenu<Schema extends z.ZodEnum>({
  label,
  pref,
  schema,
  labels,
  prefs,
  onChange,
}: {
  label: string;
  pref: RadioPref;
  schema: Schema;
  labels: Record<z.infer<Schema>, string>;
  prefs: SessionListPrefs;
  onChange: (next: SessionListPrefs) => void;
}) {
  const value = prefs[pref] as z.infer<Schema>;
  return (
    <MenuSub>
      <MenuSubTrigger
        value={labels[value]}
        valueAccent={value !== DEFAULT_SESSION_LIST_PREFS[pref]}
      >
        {label}
      </MenuSubTrigger>
      <MenuSubContent>
        <MenuRadioGroup
          value={value}
          onValueChange={(next: unknown) => {
            const parsed = schema.safeParse(next);
            if (parsed.success) onChange({ ...prefs, [pref]: parsed.data });
          }}
        >
          {schema.options.map((option) => (
            <MenuRadioItem key={String(option)} value={option}>
              {labels[option as z.infer<Schema>]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuSubContent>
    </MenuSub>
  );
}

/**
 * claude.ai/code's Filter & group menu, minus Environment (cloud-only), the
 * Archived status (no archive yet) and Show PR status (no PR data yet).
 */
function SessionFilterMenu({
  prefs,
  onChange,
}: {
  prefs: SessionListPrefs;
  onChange: (next: SessionListPrefs) => void;
}) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={filterLabel(prefs)}
        data-row-action=""
        className="relative -my-1 flex size-6 shrink-0 items-center justify-center rounded-[var(--sb-radius)] text-ink-muted hover:bg-[var(--sb-hover)] hover:text-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent-100 data-[popup-open]:bg-[var(--sb-hover)]"
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuContent align="end" className="!min-w-[200px]">
        <RadioSubmenu
          label="Status"
          pref="statusFilter"
          schema={SessionStatusFilterSchema}
          labels={sessionStatusFilterLabels}
          prefs={prefs}
          onChange={onChange}
        />
        {prefs.groupBy === "state" && (
          <RadioSubmenu
            label="Last activity"
            pref="activityDays"
            schema={SessionActivityDaysSchema}
            labels={sessionActivityDaysLabels}
            prefs={prefs}
            onChange={onChange}
          />
        )}
        <MenuSeparator />
        <RadioSubmenu
          label="Group by"
          pref="groupBy"
          schema={SessionGroupBySchema}
          labels={sessionGroupByLabels}
          prefs={prefs}
          onChange={onChange}
        />
        <RadioSubmenu
          label="Sort by"
          pref="sortBy"
          schema={SessionSortBySchema}
          labels={sessionSortByLabels}
          prefs={prefs}
          onChange={onChange}
        />
        {prefs.groupBy === "project" && (
          <>
            <MenuSeparator />
            <MenuCheckboxItem
              checked={prefs.showEmptyGroups}
              onCheckedChange={(checked) => onChange({ ...prefs, showEmptyGroups: checked })}
            >
              Show empty groups
            </MenuCheckboxItem>
          </>
        )}
        <MenuSeparator />
        <MenuItem onSelect={() => onChange(clearSessionFilters(prefs))}>Clear filters</MenuItem>
      </MenuContent>
    </Menu>
  );
}

/** The sidebar session list wired to the persisted Filter & group prefs. */
export function SidebarSessionGroups({ activeItemId }: { activeItemId: string | null }) {
  const { settings, setSetting } = useSettings();
  const prefs = settings.sessionListPrefs;
  return (
    <SessionGroups
      activeItemId={activeItemId}
      prefs={prefs}
      filterSlot={
        <SessionFilterMenu
          prefs={prefs}
          onChange={(next) => setSetting("sessionListPrefs", next)}
        />
      }
    />
  );
}
