import {
  isSettingsConflict,
  type SettingsToggle,
  useSettingsToggle,
} from "../../lib/api/customize";
import { useToast } from "../toast";

/**
 * Fire an optimistic enable/disable write and report it: "<name> enabled" /
 * "<name> disabled" on success, a conflict hint when settings.json changed on
 * disk since it was read, or a generic failure.
 */
export function useToggleWithToast(): (toggle: SettingsToggle, name: string) => void {
  const mutation = useSettingsToggle();
  const toast = useToast();
  return (toggle, name) => {
    // mutateAsync, not mutate: a menu item unmounts on select, which would drop mutate's callbacks.
    mutation.mutateAsync(toggle).then(
      () => {
        toast({ kind: "success", message: `${name} ${toggle.enabled ? "enabled" : "disabled"}` });
      },
      (error: unknown) => {
        toast({
          kind: "error",
          message: isSettingsConflict(error)
            ? "settings.json changed on disk. Review and try again."
            : `Couldn't update settings.json for ${name}`,
        });
      },
    );
  };
}
