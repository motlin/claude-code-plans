import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useShortcutKeys } from "../../hooks/use-shortcut";
import { localUserQueryOptions } from "../../lib/api/local-user";
import { Tooltip } from "../ui/tooltip";

/**
 * Upstream's `.df-bottom-tray`: a hairline-topped row with the account button on the left and
 * the ghost Search icon on the right. The cloud-only "Send feedback" button is omitted.
 */
export function SidebarFooter() {
  return (
    <div
      data-testid="sidebar-footer"
      className="flex h-12 shrink-0 items-center justify-between gap-2 border-t-[0.5px] border-border p-2"
    >
      <AccountButton />
      <div className="flex shrink-0 items-center">
        <SearchButton />
      </div>
    </div>
  );
}

function AccountButton() {
  const { data } = useQuery(localUserQueryOptions);
  const name = data?.username ?? "Local";

  return (
    <Link
      to="/settings"
      data-testid="user-menu-button"
      className="flex h-8 min-w-0 items-center gap-2 rounded-r6 pr-2 pl-0.5 text-[14px] text-secondary no-underline hover:bg-[var(--sb-hover)] focus-visible:bg-[var(--sb-hover)]"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center">
        <span
          aria-hidden="true"
          className="flex h-6 w-6 items-center justify-center rounded-full bg-fill-ghost-hover text-[12px] font-medium text-primary"
        >
          {name.charAt(0).toUpperCase()}
        </span>
      </span>
      <span className="min-w-0 truncate">{name}</span>
    </Link>
  );
}

function SearchButton() {
  const navigate = useNavigate();
  const { keys, ariaKeyShortcuts } = useShortcutKeys("search");

  return (
    <Tooltip content="Search" shortcut={keys}>
      <button
        type="button"
        aria-label="Search"
        aria-keyshortcuts={ariaKeyShortcuts}
        onClick={() => void navigate({ to: "/search", search: { q: "", mode: "titles" } })}
        className="flex h-8 w-8 items-center justify-center rounded-r5 text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
