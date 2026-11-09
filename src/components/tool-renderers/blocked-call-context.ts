import {createContext} from "react";
import type {ClientToolCall} from "./types";

/** The fields that say why an auto-mode-blocked call did not run. */
export type PolicyDenial = Pick<ClientToolCall, "blockedReason" | "blockedNoVerdict">;

/** The auto-mode-blocked call a row's body renders, so generic cards swap their error output for the reason. */
export const BlockedCallContext = createContext<PolicyDenial | null>(null);
