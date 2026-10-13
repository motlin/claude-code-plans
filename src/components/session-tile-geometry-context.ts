import {createContext} from "react";

/** Lets the chat tile's content report that its geometry is ready for scroll restoration. */
export const SessionTileGeometryReadyContext = createContext<(() => void) | undefined>(undefined);
