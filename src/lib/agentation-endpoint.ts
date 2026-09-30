// Same-origin path the dev server proxies to the local Agentation server, so the toolbar
// works when the app is opened through another host (e.g. an https reverse proxy) where
// the browser's own localhost:4747 is unreachable or blocked as mixed content.
export const AGENTATION_ENDPOINT = "/__agentation";
export const AGENTATION_SERVER = "http://localhost:4747";
