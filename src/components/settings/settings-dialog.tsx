import { Dialog } from "@base-ui/react/dialog";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { X } from "lucide-react";
import { useCallback, useRef, type ComponentType } from "react";
import { useShortcut } from "../../hooks/use-shortcut";
import { settingsTabLabels } from "../../lib/schema-choices";
import {
  parseSettingsHash,
  settingsHash,
  SettingsTabSchema,
  type SettingsTab,
} from "../../lib/settings-hash";
import {
  AiFeaturesSettings,
  ApplicationConfigurationSection,
  ClaudeCodeSettings,
  ClaudeConfigSettings,
  GeneralSettings,
  SessionsSettings,
  SetupSettings,
  TranscriptSettings,
} from "./settings-sections";
import { UsageSettings } from "./usage-settings";

const TAB_PANELS = {
  general: GeneralSettings,
  usage: UsageSettings,
  "claude-code": ClaudeCodeSettings,
  transcript: TranscriptSettings,
  sessions: SessionsSettings,
  application: ApplicationConfigurationSection,
  "ai-features": AiFeaturesSettings,
  "claude-config": ClaudeConfigSettings,
  setup: SetupSettings,
} satisfies Record<SettingsTab, ComponentType>;

/** Returns a function that opens Settings over the current page at `tab`. */
export function useOpenSettings(): (tab: SettingsTab, row?: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (tab, row) => {
      void navigate({
        to: ".",
        search: true,
        params: true,
        hash: settingsHash(tab, row),
        resetScroll: false,
        hashScrollIntoView: false,
      });
    },
    [navigate],
  );
}

/**
 * The upstream-shaped Settings modal. It is open exactly while the location hash
 * is `#settings/<tab>[/<row>]`; closing clears the hash and restores focus to
 * whatever was focused when it opened.
 */
export function SettingsDialog() {
  const hash = useLocation({ select: (location) => location.hash });
  const navigate = useNavigate();
  const openSettings = useOpenSettings();
  const current = parseSettingsHash(hash);
  const open = current !== null;
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // The first render with a settings hash runs before Base UI moves focus into
  // the popup, so this still sees whatever the hash change was triggered from.
  if (open && returnFocusRef.current === null) {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) returnFocusRef.current = active;
  }

  useShortcut("settings", () => openSettings("general"));

  const close = useCallback(() => {
    void navigate({
      to: ".",
      search: true,
      params: true,
      resetScroll: false,
      hashScrollIntoView: false,
    });
  }, [navigate]);

  const selectTab = (tab: SettingsTab) => {
    void navigate({
      to: ".",
      search: true,
      params: true,
      hash: settingsHash(tab),
      replace: true,
      resetScroll: false,
      hashScrollIntoView: false,
    });
  };

  const finalFocus = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    return target !== null && target.isConnected ? target : true;
  }, []);

  const tab = current?.tab ?? "general";
  const Panel = TAB_PANELS[tab];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Popup
          aria-label="Settings"
          finalFocus={finalFocus}
          data-perf-overlay="settings_modal"
          data-perf-screen={tab}
          className="fixed inset-8 z-50 m-auto flex max-h-[50rem] max-w-[1024px] overflow-hidden rounded-card bg-[var(--menu-bg)] text-primary shadow-[var(--menu-shadow)] outline-none"
        >
          <nav
            aria-label="Settings"
            className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-subtle bg-surface-1 p-2"
          >
            <div className="px-2.5 pt-2 pb-1 text-caption text-t6">Settings</div>
            {SettingsTabSchema.options.map((navTab) => {
              const selected = navTab === tab;
              return (
                <button
                  key={navTab}
                  type="button"
                  aria-current={selected ? "page" : undefined}
                  onClick={() => selectTab(navTab)}
                  className={`flex h-8 shrink-0 items-center rounded-r6 px-2.5 text-left text-sm transition-colors ${
                    selected
                      ? "bg-fill-ghost-hover font-medium text-primary"
                      : "text-secondary hover:bg-fill-ghost-hover"
                  }`}
                >
                  {settingsTabLabels[navTab]}
                </button>
              );
            })}
          </nav>
          <div className="relative flex min-w-0 flex-1 flex-col">
            <Dialog.Close
              aria-label="Close settings"
              className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-r6 text-secondary transition-colors hover:bg-fill-ghost-hover"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
            <div className="flex-1 overflow-y-auto px-8 pt-6 pb-8">
              <h2 className="pr-10 text-lg font-semibold">{settingsTabLabels[tab]}</h2>
              <div className="mt-6 space-y-6">
                <Panel />
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
