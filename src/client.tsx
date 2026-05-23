import { StartClient } from "@tanstack/react-start/client";
import { hydrateRoot } from "react-dom/client";
import { preloadMarkdown } from "./lib/markdown";
import "./router";

preloadMarkdown();
hydrateRoot(document, <StartClient />);
