import {createContext} from "react";

import type {TailActionsOutlet} from "../lib/tail-actions-outlet";

/** The session's tail actions outlet; null outside a session page (subagent panes keep actions in place). */
export const TailActionsOutletContext = createContext<TailActionsOutlet | null>(null);

/** Whether this transcript row is the feed's last row (upstream's turn-tail row). */
export const TranscriptLastRowContext = createContext(false);
