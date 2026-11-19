import {createContext} from "react";

import type {TranscriptMode} from "../lib/transcript-mode";

/** The transcript's view mode; Verbose is upstream's transcript-wide expand-all. */
export const TranscriptModeContext = createContext<TranscriptMode>("normal");
