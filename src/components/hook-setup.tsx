import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Settings, Download, Trash2, AlertCircle } from "lucide-react";
import { generateHooksJson, DEFAULT_HOOK_PORT } from "../lib/hook-config";
import { hookStatusQueryOptions, useInstallHooks, useUninstallHooks } from "../lib/api/hooks";
import { useSettings } from "./settings-provider";

export function HookSetup() {
  const { settings } = useSettings();
  const [port, setPort] = useState(DEFAULT_HOOK_PORT);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [showJson, setShowJson] = useState(false);

  const { data: status } = useQuery(hookStatusQueryOptions);
  const installMutation = useInstallHooks();
  const uninstallMutation = useUninstallHooks();
  const installing = installMutation.isPending;
  const uninstalling = uninstallMutation.isPending;

  const includeContextBrief = settings.capabilities.sessionContextBrief.enabled;
  const json = generateHooksJson({ port, includeContextBrief });

  function handleCopy() {
    void navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function handleInstall() {
    setMessage(null);
    try {
      const result = await installMutation.mutateAsync({
        port,
        capabilities: settings.capabilities,
      });
      setMessage({
        type: "success",
        text: `Hooks installed to ${result.settingsPath}`,
      });
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    }
  }

  async function handleUninstall() {
    setMessage(null);
    try {
      const result = await uninstallMutation.mutateAsync({ port });
      setMessage({
        type: "success",
        text: `Hooks removed from ${result.settingsPath}`,
      });
    } catch (err) {
      setMessage({ type: "error", text: (err as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Settings className="h-5 w-5 text-secondary" />
        <h2 className="text-base font-semibold text-primary">Hook Configuration</h2>
      </div>

      <p className="text-sm text-secondary">
        Hooks enable real-time session tracking and push-based updates. Each hook fires a
        lightweight POST to the local server whenever Claude starts/ends sessions, completes tools,
        or finishes tasks.
      </p>

      {status && (
        <div
          className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
            status.installed
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
              : status.partial
                ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
                : "border-border bg-surface-0 text-secondary"
          }`}
        >
          {status.installed ? (
            <>
              <Check className="h-4 w-4" />
              All {status.totalCount} hooks installed
            </>
          ) : status.partial ? (
            <>
              <AlertCircle className="h-4 w-4" />
              {status.installedCount}/{status.totalCount} hooks installed
            </>
          ) : (
            <>
              <AlertCircle className="h-4 w-4" />
              Hooks not installed
            </>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <label htmlFor="hook-port" className="text-sm text-secondary">
          Server port
        </label>
        <input
          id="hook-port"
          type="number"
          value={port}
          onChange={(e) => setPort(Number(e.target.value) || DEFAULT_HOOK_PORT)}
          className="w-24 rounded-md border border-border bg-surface-1 px-2 py-1 text-sm text-primary focus:outline-none focus:ring-1 focus:ring-accent-100"
        />
      </div>

      <div className="flex items-center gap-2">
        {!status?.installed ? (
          <button
            type="button"
            onClick={handleInstall}
            disabled={installing}
            className="flex items-center gap-1.5 rounded-md bg-accent-100 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-100/80 disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {installing ? "Installing..." : "Install Hooks"}
          </button>
        ) : (
          <button
            type="button"
            onClick={handleUninstall}
            disabled={uninstalling}
            className="flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {uninstalling ? "Removing..." : "Uninstall Hooks"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowJson(!showJson)}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-secondary transition-colors hover:bg-surface-0"
        >
          {showJson ? "Hide JSON" : "Show JSON"}
        </button>
      </div>

      {message && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950/30 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {showJson && (
        <div className="relative">
          <button
            type="button"
            onClick={handleCopy}
            className="absolute right-2 top-2 flex items-center gap-1.5 rounded-md border border-border bg-surface-0 px-2.5 py-1 text-xs text-secondary transition-colors hover:bg-fill-ghost-hover hover:text-primary"
            title="Copy to clipboard"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-green-500" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>
          <pre className="overflow-auto rounded-md border border-border bg-surface-0 p-4 pr-24 font-mono text-xs leading-relaxed text-secondary">
            {json}
          </pre>
        </div>
      )}
    </div>
  );
}
