import { definePlugin } from "nitro";
import { stopAllTerminalObservers } from "../../src/lib/herdr/terminal-observer";
import { stopAllShells } from "../../src/lib/shell-pty";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", stopAllTerminalObservers);
  nitroApp.hooks.hook("close", stopAllShells);
});
