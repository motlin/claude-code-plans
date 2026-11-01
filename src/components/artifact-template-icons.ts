import {ChartLine, FileText, Palette, Presentation, type LucideIcon} from "lucide-react";

import type {ArtifactTemplateSlug} from "../lib/artifact-templates";

export const TEMPLATE_ICONS: Record<ArtifactTemplateSlug, LucideIcon> = {
	pages: FileText,
	slides: Presentation,
	design: Palette,
	dashboard: ChartLine,
};
