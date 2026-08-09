import { describe, expect, it } from "vite-plus/test";
import { useActiveSection } from "../src/components/sidebar/hooks";
import { navItems } from "../src/components/sidebar/navigation";

describe("sidebar navigation", () => {
  it("links to each top-level section", () => {
    expect(navItems.map(({ label, to }) => ({ label, to }))).toStrictEqual([
      { label: "Active", to: "/active" },
      { label: "Herdr", to: "/herdr" },
      { label: "Tmux Windows", to: "/tmux" },
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

  it("activates the tmux section on the tmux route", () => {
    const matches = [{ fullPath: "/tmux", params: {} }] as unknown as Parameters<
      typeof useActiveSection
    >[0];

    expect(useActiveSection(matches)).toStrictEqual({ section: "tmux", activeItemId: null });
  });

  it("activates the Herdr section and terminal on a live terminal route", () => {
    const matches = [
      { fullPath: "/herdr/terminal/$sessionId", params: { sessionId: "session-test-100" } },
    ] as unknown as Parameters<typeof useActiveSection>[0];

    expect(useActiveSection(matches)).toStrictEqual({
      section: "herdr",
      activeItemId: "session-test-100",
    });
  });
});
