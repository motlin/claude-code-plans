import { useSyncExternalStore } from "react";

import { isMacPlatform } from "../lib/shortcuts/match";

function subscribe(): () => void {
  return () => {};
}

/** Mac platform test that renders `false` during SSR and hydrates to the UA test. */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribe, isMacPlatform, () => false);
}
