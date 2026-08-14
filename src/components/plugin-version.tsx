import type { PluginInfoData } from "../lib/api/plugins";

const SHORT_COMMIT_LENGTH = 12;

export function PluginVersion({
  version,
  versionKind,
}: Pick<PluginInfoData, "version" | "versionKind">) {
  if (versionKind === "commit") {
    return (
      <code className="font-mono text-xs text-t6" title={`Pinned to commit ${version}`}>
        {version.slice(0, SHORT_COMMIT_LENGTH)}
      </code>
    );
  }

  return <span className="text-xs text-t6">v{version}</span>;
}
