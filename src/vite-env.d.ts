/// <reference types="vite/client" />
// oxlint-disable-next-line triple-slash-reference -- load the @tanstack/react-start `server` route option augmentation, which is not reachable through `export type *` under verbatimModuleSyntax
/// <reference path="../node_modules/@tanstack/start-client-core/dist/esm/serverRoute.d.ts" />

declare module "*.css?url" {
  const content: string;
  export default content;
}

declare module "*.module.css" {
  const content: Record<string, string>;
  export default content;
}
