/**
 * Resolves the theme on `<html>` before the first paint.
 *
 * `ThemeProvider` only applies `light`/`dark` from an effect, which cannot run
 * until the client bundle hydrates. Without this script a dark-mode user gets a
 * light-themed frame for the whole download-and-hydrate window. The script runs
 * synchronously from `<head>`, so the very first painted pixels already carry
 * the right theme. Keep the storage key in sync with `ThemeProvider`.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var stored=localStorage.getItem("theme");var dark=stored==="dark"||((stored===null||stored==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var root=document.documentElement;root.classList.add(dark?"dark":"light");root.style.colorScheme=dark?"dark":"light";}catch(error){}})();`;
