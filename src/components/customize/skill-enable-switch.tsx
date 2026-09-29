import { useQuery } from "@tanstack/react-query";
import {
  customizeSettingsTogglesQueryOptions,
  isSkillEnabled,
  type SkillSummary,
} from "../../lib/api/customize";
import { Switch } from "../settings/switch";
import { useToggleWithToast } from "./use-toggle-with-toast";

/**
 * Upstream "Enable skill" switch. Personal and project skills write
 * `skillOverrides[name]` ("off", or the key removed to turn it back on).
 * Plugin skills ignore skillOverrides and follow their plugin, so their
 * switch only mirrors the listed state.
 */
export function SkillEnableSwitch({ skill }: { skill: SkillSummary }) {
  const { data: state } = useQuery(customizeSettingsTogglesQueryOptions);
  const toggle = useToggleWithToast();

  if (skill.source === "plugin") {
    return (
      <Switch
        aria-label="Enable skill"
        checked={skill.enabled}
        disabled
        onCheckedChange={() => {}}
      />
    );
  }

  const checked = state === undefined ? skill.enabled : isSkillEnabled(state, skill.name);
  return (
    <Switch
      aria-label="Enable skill"
      checked={checked}
      onCheckedChange={(enabled) =>
        toggle({ kind: "skill", name: skill.name, enabled }, skill.name)
      }
    />
  );
}
