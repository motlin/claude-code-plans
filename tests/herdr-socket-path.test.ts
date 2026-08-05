import { describe, expect, it } from "vite-plus/test";
import { resolveHerdrSocketPath } from "../src/lib/herdr/socket-path";

describe("resolveHerdrSocketPath", () => {
  it("uses HERDR_SOCKET_PATH verbatim when it is non-empty", () => {
    expect(
      resolveHerdrSocketPath({
        HERDR_SOCKET_PATH: "relative/custom.sock",
        XDG_CONFIG_HOME: "/tmp/test/xdg",
        HOME: "/tmp/test/home",
        HERDR_SESSION: "alice",
      }),
    ).toBe("relative/custom.sock");
  });

  it("uses XDG_CONFIG_HOME for the release-build config directory", () => {
    expect(
      resolveHerdrSocketPath({
        HERDR_SOCKET_PATH: "",
        XDG_CONFIG_HOME: "/tmp/test/xdg",
        HOME: "/tmp/test/home",
      }),
    ).toBe("/tmp/test/xdg/herdr/herdr.sock");
  });

  it("falls back to HOME when XDG_CONFIG_HOME is unavailable", () => {
    expect(resolveHerdrSocketPath({ HOME: "/tmp/test/home" })).toBe(
      "/tmp/test/home/.config/herdr/herdr.sock",
    );
  });

  it("uses the named session socket when HERDR_SESSION is non-empty", () => {
    expect(
      resolveHerdrSocketPath({
        HOME: "/tmp/test/home",
        HERDR_SESSION: "alice",
      }),
    ).toBe("/tmp/test/home/.config/herdr/sessions/alice/herdr.sock");
  });

  it("uses the top-level socket when HERDR_SESSION is empty", () => {
    expect(
      resolveHerdrSocketPath({
        HOME: "/tmp/test/home",
        HERDR_SESSION: "",
      }),
    ).toBe("/tmp/test/home/.config/herdr/herdr.sock");
  });

  it("excludes the literal default HERDR_SESSION name", () => {
    expect(
      resolveHerdrSocketPath({
        HOME: "/tmp/test/home",
        HERDR_SESSION: "default",
      }),
    ).toBe("/tmp/test/home/.config/herdr/herdr.sock");
  });
});
