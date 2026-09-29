import { createContext, useContext } from "react";

/** The session titlebar's measured width in px, or null before the first measurement. */
export const TitlebarWidthContext = createContext<number | null>(null);

export function useTitlebarWidth(): number | null {
  return useContext(TitlebarWidthContext);
}
