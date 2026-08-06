import { definePlugin } from "nitro";
import { stopAllTerminalObservers } from "../../src/lib/herdr/terminal-observer";

export default definePlugin((nitroApp) => {
  nitroApp.hooks.hook("close", stopAllTerminalObservers);
});
