import { useQuery } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { customizeSettingsTogglesQueryOptions, isPluginEnabled } from "../../lib/api/customize";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { useToggleWithToast } from "./use-toggle-with-toast";

/** Enable/Disable for one installed plugin, written to `enabledPlugins[id]`. */
export function PluginEnableMenuItem({ pluginId, name }: { pluginId: string; name: string }) {
  const { data: state } = useQuery(customizeSettingsTogglesQueryOptions);
  const toggle = useToggleWithToast();
  const enabled = state === undefined || isPluginEnabled(state, pluginId);
  return (
    <MenuItem
      disabled={state === undefined}
      onSelect={() => toggle({ kind: "plugin", id: pluginId, enabled: !enabled }, name)}
    >
      {enabled ? "Disable" : "Enable"}
    </MenuItem>
  );
}

/** Plugin row kebab "More actions for <name>". */
export function PluginRowActions({ pluginId, name }: { pluginId: string; name: string }) {
  return (
    <Menu>
      <MenuTrigger
        aria-label={`More actions for ${name}`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-r6 text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-expanded:text-primary"
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuContent align="end">
        <PluginEnableMenuItem pluginId={pluginId} name={name} />
      </MenuContent>
    </Menu>
  );
}
