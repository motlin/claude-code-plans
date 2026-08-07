import type { PluginInfoData } from "../lib/api/plugins";

const SHORT_COMMIT_LENGTH = 12;

export function PluginVersion({
  version,
  versionKind,
}: Pick<PluginInfoData, "version" | "versionKind">) {
  if (versionKind === "commit") {
    return (
      <code className="font-mono text-xs text-text-500" title={`Pinned to commit ${version}`}>
        {version.slice(0, SHORT_COMMIT_LENGTH)}
      </code>
    );
  }

  return <span className="text-xs text-text-500">v{version}</span>;
}
