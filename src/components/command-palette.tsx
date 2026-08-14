import { Command } from "cmdk";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  Brain,
  MessageSquare,
  FolderOpen,
  Search,
  Star,
  Home,
  SlidersHorizontal,
  CircleCheckBig,
} from "lucide-react";
import { recentSessionsQueryOptions } from "../lib/api/sessions";
import { clearAll, observeSessionState } from "../lib/unread-store";
import { isLiveSessionState } from "../lib/session-state";

interface RecentSession {
  id: string;
  title: string;
  mtime: string;
}

function formatRelativeTime(mtime: string): string {
  const now = Date.now();
  const then = new Date(mtime).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(mtime).toLocaleDateString();
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  // `enabled: open` avoids fetching until the palette is opened. The server
  // already returns the most-recent sessions, ordered, so no client sort needed.
  const { data } = useQuery({ ...recentSessionsQueryOptions(8), enabled: open });

  const recentSessions = useMemo<RecentSession[]>(
    () => (data?.sessions ?? []).map((s) => ({ id: s.id, title: s.title, mtime: s.mtime })),
    [data],
  );

  useEffect(() => {
    for (const session of data?.sessions ?? []) {
      if (isLiveSessionState(session.state)) observeSessionState(session.id, session.state);
    }
  }, [data]);

  function select(callback: () => void) {
    onOpenChange(false);
    callback();
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      loop
      overlayClassName="fixed inset-0 z-50 bg-black/50"
      contentClassName="fixed left-1/2 top-[20%] z-50 w-full max-w-[600px] -translate-x-1/2 rounded-xl border border-border bg-surface-1 shadow-2xl"
    >
      <div className="flex items-center border-b border-border px-3">
        <Search className="mr-2 h-4 w-4 shrink-0 text-t6" />
        <Command.Input
          placeholder="Search or jump to..."
          className="flex h-11 w-full bg-transparent py-3 text-sm text-primary outline-none placeholder:text-t6"
        />
      </div>

      <Command.List className="max-h-[320px] overflow-y-auto px-2 py-2">
        <Command.Empty className="px-3 py-6 text-center text-sm text-t6">
          No results found.
        </Command.Empty>

        <Command.Group
          heading="Quick Actions"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-t6"
        >
          <CommandItem
            icon={<Home className="h-4 w-4" />}
            onSelect={() => select(() => navigate({ to: "/" }))}
          >
            Home
          </CommandItem>
          <CommandItem
            icon={<Search className="h-4 w-4" />}
            onSelect={() =>
              select(() =>
                navigate({
                  to: "/search",
                  search: { q: "", mode: "titles" as const },
                }),
              )
            }
            shortcut="/"
          >
            Search
          </CommandItem>
          <CommandItem
            icon={<CircleCheckBig className="h-4 w-4" />}
            onSelect={() => select(clearAll)}
          >
            Mark all sessions seen
          </CommandItem>
        </Command.Group>

        {recentSessions.length > 0 && (
          <Command.Group
            heading="Recent Sessions"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-t6"
          >
            {recentSessions.map((session) => (
              <CommandItem
                key={session.id}
                icon={<MessageSquare className="h-4 w-4" />}
                onSelect={() =>
                  select(() =>
                    navigate({
                      to: "/session/$id",
                      params: { id: session.id },
                    }),
                  )
                }
                metadata={formatRelativeTime(session.mtime)}
                keywords={[session.id]}
              >
                {session.title}
              </CommandItem>
            ))}
          </Command.Group>
        )}

        <Command.Group
          heading="Navigation"
          className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-t6"
        >
          <CommandItem
            icon={<Star className="h-4 w-4" />}
            onSelect={() => select(() => navigate({ to: "/starred" }))}
          >
            Starred
          </CommandItem>
          <CommandItem
            icon={<FolderOpen className="h-4 w-4" />}
            onSelect={() => select(() => navigate({ to: "/projects" }))}
          >
            Projects
          </CommandItem>
          <CommandItem
            icon={<FileText className="h-4 w-4" />}
            onSelect={() => select(() => navigate({ to: "/plans" }))}
          >
            Plans
          </CommandItem>
          <CommandItem
            icon={<Brain className="h-4 w-4" />}
            onSelect={() => select(() => navigate({ to: "/memories" }))}
          >
            Memories
          </CommandItem>
          <CommandItem
            icon={<MessageSquare className="h-4 w-4" />}
            onSelect={() => select(() => navigate({ to: "/sessions" }))}
          >
            Sessions
          </CommandItem>
          <CommandItem
            icon={<SlidersHorizontal className="h-4 w-4" />}
            onSelect={() => select(() => navigate({ to: "/settings" }))}
          >
            Settings
          </CommandItem>
        </Command.Group>
      </Command.List>

      <div className="flex items-center gap-3 border-t border-border px-3 py-2">
        <span className="flex items-center gap-1 text-[11px] text-t6">
          Select{" "}
          <kbd className="rounded bg-fill-ghost-hover px-1.5 py-0.5 font-mono text-[10px] font-medium text-secondary">
            &uarr;&darr;
          </kbd>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-t6">
          Open{" "}
          <kbd className="rounded bg-fill-ghost-hover px-1.5 py-0.5 font-mono text-[10px] font-medium text-secondary">
            &crarr;
          </kbd>
        </span>
        <span className="flex items-center gap-1 text-[11px] text-t6">
          Close{" "}
          <kbd className="rounded bg-fill-ghost-hover px-1.5 py-0.5 font-mono text-[10px] font-medium text-secondary">
            Esc
          </kbd>
        </span>
      </div>
    </Command.Dialog>
  );
}

function CommandItem({
  children,
  icon,
  onSelect,
  shortcut,
  metadata,
  keywords,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  onSelect: () => void;
  shortcut?: string;
  metadata?: string;
  keywords?: string[];
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      {...(keywords ? { keywords } : {})}
      className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-secondary transition-colors select-none data-[selected=true]:bg-fill-ghost-hover data-[selected=true]:text-primary"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-t6">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {metadata && <span className="shrink-0 text-xs text-t6">{metadata}</span>}
      {shortcut && (
        <kbd className="shrink-0 rounded bg-fill-ghost-hover px-1.5 py-0.5 font-mono text-[10px] font-medium text-t6">
          {shortcut}
        </kbd>
      )}
    </Command.Item>
  );
}
