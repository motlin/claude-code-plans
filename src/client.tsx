import { StartClient } from "@tanstack/react-start/client";
import { hydrateRoot } from "react-dom/client";
import "./router";

hydrateRoot(document, <StartClient />);
