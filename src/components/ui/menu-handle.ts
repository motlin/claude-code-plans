import {Menu as BaseMenu} from "@base-ui/react/menu";

/** A handle that lets a detached `MenuTrigger` open a `Menu` mounted elsewhere, or later (upstream's lazy BK body). */
export const createMenuHandle = BaseMenu.createHandle;
export type MenuHandle<Payload> = BaseMenu.Handle<Payload>;
