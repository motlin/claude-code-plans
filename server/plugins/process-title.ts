import {definePlugin} from "nitro";
import {setServerProcessTitle} from "../../src/lib/server-process-title";

export default definePlugin(() => {
	setServerProcessTitle({dev: import.meta.dev === true});
});
