import type { RecipeDefinition } from "./types";
import type { RecipeParams } from "../shared/types";

export const RECIPES: RecipeDefinition[] = [
  {
    id: "document-summarization",
    name: "Document Summarization",
    icon: "📄",
    description: "Summarize each file in a Google Drive folder",
    panelId: "recipe",
    params: {
      driveFolder: {
        colTitle: "Drive Link",
        helperText: "Make sure you have access to this folder",
      },
      systemPrompt: {
        colTitle: { value: "System Prompt", locked: true },
        prompt: {
          value:
            "You are an expert document analyst. Produce clear, structured summaries " +
            "focusing on key themes, main arguments, important data points, and actionable conclusions.",
          locked: true,
        },
      },
      userPrompts: [
        {
          colTitle: { value: "User Prompt", locked: true },
          prompt: {
            value:
              "Please summarize the attached document. Include the main topics, key findings, " +
              "and important conclusions. The document file will be attached as inline data.",
            locked: true,
          },
        },
      ],
      outputCol: {
        colTitle: { value: "AI_Summarization", locked: true },
      },
    } satisfies RecipeParams,
  },
];
