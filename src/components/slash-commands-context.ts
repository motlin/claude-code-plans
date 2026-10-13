import {createContext} from "react";

import type {SlashCommand} from "../lib/slash-commands";

const EMPTY_SLASH_COMMANDS: readonly SlashCommand[] = [];

/** The commands `/api/commands` knows for this session's project, for the chip's description. */
export const SlashCommandsContext = createContext<readonly SlashCommand[]>(EMPTY_SLASH_COMMANDS);
