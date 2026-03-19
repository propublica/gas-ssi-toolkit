/**
 * GAS-coupled entry point for the sidebar.
 *
 * Instantiates all panels, creates the Router, and starts on tool-list.
 * All google.script.run calls are in services.ts.
 * All DOM manipulation is in panel and component classes.
 */

import { Router } from "./router";
import { ToolListPanel } from "./panels/tool-list";
import { ConfigureAIRunPanel } from "./panels/configure-ai-run";
import { RecipesListPanel } from "./panels/recipes-list";
import { RecipePanel } from "./panels/recipe";
import { ImportDriveLinksPanel } from "./panels/import-drive-links";
import { JobIndicator } from "./components/job-indicator";
import { jobStore } from "./job-store";
import type { Panel, PanelId } from "./types";

function init(): void {
  const app = document.getElementById("app");
  if (!app) return;

  const jobStrip = document.getElementById("job-strip");
  if (jobStrip) {
    new JobIndicator(jobStrip, jobStore);
  }

  const panels = new Map<PanelId, Panel>([
    ["tool-list", new ToolListPanel()],
    ["configure-ai-run", new ConfigureAIRunPanel()],
    ["recipes-list", new RecipesListPanel()],
    ["recipe", new RecipePanel()],
    ["import-drive-links", new ImportDriveLinksPanel()],
  ]);

  const router = new Router(app, panels);
  router.start("tool-list");
}

init();
