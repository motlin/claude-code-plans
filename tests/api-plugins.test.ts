import { describe, it, expect } from "vite-plus/test";
import { groupPluginsByMarketplace, type PluginInfoData } from "../src/lib/api/plugins";

function makePlugin(id: string, name: string): PluginInfoData {
  const [, marketplace = ""] = id.split("@");
  return {
    id,
    name,
    version: "1.0.0",
    versionKind: "release",
    description: "",
    author: "",
    marketplace,
    installPath: "/tmp/test",
    agents: [],
    commands: [],
    skills: [],
  };
}

describe("groupPluginsByMarketplace", () => {
  it("groups plugins by marketplace", () => {
    const plugins = [
      makePlugin("hookify@claude-code-plugins", "hookify"),
      makePlugin("playwright@claude-plugins-official", "playwright"),
      makePlugin("feature-dev@claude-code-plugins", "feature-dev"),
    ];

    const groups = groupPluginsByMarketplace(plugins);
    expect(groups.map((g) => g.marketplace.id)).toStrictEqual([
      "claude-plugins-official",
      "claude-code-plugins",
    ]);
    expect(groups[0]!.plugins.length).toBe(1);
    expect(groups[1]!.plugins.length).toBe(2);
  });

  it("derives display names for unknown marketplaces from the id", () => {
    const plugins = [makePlugin("my-plugin@custom-marketplace", "my-plugin")];
    const groups = groupPluginsByMarketplace(plugins);
    expect(groups.length).toBe(1);
    expect(groups[0]!.marketplace.displayName).toBe("Custom Marketplace");
  });

  it("returns empty array for no plugins", () => {
    expect(groupPluginsByMarketplace([])).toStrictEqual([]);
  });

  it("sorts official marketplaces before third-party, then alphabetically by displayName", () => {
    const plugins = [
      makePlugin("a@zzz-marketplace", "a"),
      makePlugin("b@anthropic-agent-skills", "b"),
      makePlugin("c@claude-plugins-official", "c"),
      makePlugin("d@aaa-marketplace", "d"),
    ];
    const groups = groupPluginsByMarketplace(plugins);
    expect(groups.map((g) => g.marketplace.id)).toStrictEqual([
      "anthropic-agent-skills",
      "claude-plugins-official",
      "aaa-marketplace",
      "zzz-marketplace",
    ]);
  });

  it("flags isOfficial for known official marketplaces only", () => {
    const plugins = [
      makePlugin("a@claude-plugins-official", "a"),
      makePlugin("b@anthropic-agent-skills", "b"),
      makePlugin("c@some-third-party", "c"),
    ];
    const groups = groupPluginsByMarketplace(plugins);
    const byId = Object.fromEntries(groups.map((g) => [g.marketplace.id, g.isOfficial]));
    expect(byId).toStrictEqual({
      "claude-plugins-official": true,
      "anthropic-agent-skills": true,
      "some-third-party": false,
    });
  });
});
