import { useQuery } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { customizeSettingsTogglesQueryOptions, isPluginEnabled } from "../../lib/api/customize";
import { writeClipboardText } from "../../lib/clipboard";
import { useToast } from "../toast";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/menu";
import { pluginInstallCommand } from "./plugin-view";
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

/**
 * Plugin kebab: Enable/Disable, "Copy install command" (the
 * `claude plugin install <id>` line), and "Copy path" (the install directory,
 * since the browser cannot open Finder).
 */
export function PluginRowActions({
  pluginId,
  name,
  installPath,
  triggerLabel = `More actions for ${name}`,
}: {
  pluginId: string;
  name: string;
  installPath: string;
  /** Rows say "More actions for <name>"; the detail header says "More options for <name>". */
  triggerLabel?: string;
}) {
  const toast = useToast();
  const copy = async (text: string, message: string) => {
    const copied = await writeClipboardText(text);
    toast(copied ? { kind: "success", message } : { kind: "error", message: "Copy failed" });
  };

  return (
    <Menu>
      <MenuTrigger
        aria-label={triggerLabel}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-r6 text-t6 transition-colors hover:bg-fill-ghost-hover hover:text-primary aria-expanded:text-primary"
      >
        <Ellipsis aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuContent align="end">
        <PluginEnableMenuItem pluginId={pluginId} name={name} />
        <MenuItem
          onSelect={() => void copy(pluginInstallCommand(pluginId), "Install command copied")}
        >
          Copy install command
        </MenuItem>
        <MenuItem onSelect={() => void copy(installPath, "Folder path copied")}>Copy path</MenuItem>
      </MenuContent>
    </Menu>
  );
}
