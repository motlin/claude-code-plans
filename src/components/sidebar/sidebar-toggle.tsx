import { useShortcutKeys } from "../../hooks/use-shortcut";
import { toggleSidebarCollapsed, useSidebarState } from "../../lib/sidebar-store";
import { Tooltip } from "../ui/tooltip";
import { SidebarToggleIcon } from "./primitives";

/** The sidebar hide/show button, labelled and tooltipped like claude.ai/code. */
export function SidebarToggleButton({
  className,
  onClick = toggleSidebarCollapsed,
  collapsed: collapsedOverride,
  tooltip = true,
}: {
  className?: string;
  onClick?: () => void;
  collapsed?: boolean;
  /** False drops the tooltip and ⌘B hint, as upstream's forced-collapse trigger does. */
  tooltip?: boolean;
}) {
  const state = useSidebarState();
  const collapsed = collapsedOverride ?? state.collapsed;
  const { keys, ariaKeyShortcuts } = useShortcutKeys("toggle_sidebar");
  const label = collapsed ? "Show sidebar" : "Hide sidebar";

  const button = (
    <button
      type="button"
      onClick={onClick}
      onKeyDown={(event) => {
        // Handle Enter directly (suppressing the native click) so it toggles exactly once.
        if (event.key !== "Enter") return;
        event.preventDefault();
        onClick();
      }}
      aria-label={label}
      aria-keyshortcuts={tooltip ? ariaKeyShortcuts : undefined}
      className={
        className ??
        "flex h-8 w-8 items-center justify-center rounded-r5 text-primary transition-colors hover:bg-fill-ghost-hover"
      }
    >
      <SidebarToggleIcon />
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={keys}>
      {button}
    </Tooltip>
  );
}
