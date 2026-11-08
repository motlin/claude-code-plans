import * as shrinkwrapEngine from "../lib/shrinkwrap";
import {provideShrinkwrapEngine} from "../lib/shrinkwrap-loader";

// The session view's user bubbles and markdown tips fit on mount, so the engine loads with them and every lazy
// shrinkwrap (tooltips) on the page fits synchronously too.
provideShrinkwrapEngine(shrinkwrapEngine);

/**
 * {@link useLazyShrinkwrap} with the engine loaded statically: for components that only render where the engine
 * belongs on the cold load. Elsewhere (tooltips, the composer's slash menu) use `useLazyShrinkwrap` directly.
 */
export {useLazyShrinkwrap as useShrinkwrap} from "./use-lazy-shrinkwrap";
