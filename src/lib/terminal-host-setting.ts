import {z} from "zod";

/**
 * Which terminal multiplexer ccp drives for live sessions. `auto` picks herdr
 * when its socket answers, else tmux when `$TMUX` is set or a tmux server runs.
 */
export const TerminalHostSettingSchema = z.enum(["auto", "herdr", "tmux"]);

export type TerminalHostSetting = z.infer<typeof TerminalHostSettingSchema>;

export const DEFAULT_TERMINAL_HOST_SETTING: TerminalHostSetting = "auto";
