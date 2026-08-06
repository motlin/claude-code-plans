import { describe, expect, it } from "vite-plus/test";
import { navItems } from "../src/components/sidebar/navigation";

describe("sidebar navigation", () => {
  it("uses Terminal Fleet as the single terminal placement surface", () => {
    expect(navItems.map(({ label, to }) => ({ label, to }))).toStrictEqual([
      { label: "Active", to: "/active" },
      { label: "Terminal Fleet", to: "/herdr" },
      { label: "Approvals", to: "/approvals" },
      { label: "Notifications", to: "/notifications" },
      { label: "Starred", to: "/starred" },
      { label: "Tasks", to: "/tasks" },
      { label: "Projects", to: "/projects" },
      { label: "Plans", to: "/plans" },
      { label: "Memories", to: "/memories" },
      { label: "Sessions", to: "/sessions" },
      { label: "Plugins", to: "/plugins" },
      { label: "Settings", to: "/settings" },
      { label: "Claude Config", to: "/settings/edit" },
      { label: "Setup", to: "/setup" },
    ]);
  });
});
