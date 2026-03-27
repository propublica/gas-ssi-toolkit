import type { RecipeDefinition, RecipeParams } from "./types";

export const RECIPES: RecipeDefinition[] = [
  {
    id: "document-summarization",
    name: "Document Summarization",
    icon: "📄",
    description: "Summarize each file in a Google Drive folder",
    panelId: "recipe",
    params: {
      columns: [
        {
          label: "Drive Folder",
          role: "driveLink",
          strategyKind: "list-drive-folder",
          colTitle: { value: "Drive Link", locked: true },
          url: { value: "", locked: false, placeholder: "Paste Google Drive folder URL" },
          helperText: "Make sure you have access to this folder",
          required: true,
        },
        {
          label: "System Prompt",
          role: "systemPrompt",
          strategyKind: "fill-value",
          colTitle: { value: "System Prompt", locked: true },
          prompt: {
            value:
              "You are an expert document analyst. Produce clear, structured summaries " +
              "focusing on key themes, main arguments, important data points, and actionable conclusions.",
            locked: true,
          },
        },
        {
          label: "User Prompt",
          role: "userPrompt",
          strategyKind: "fill-value",
          colTitle: { value: "User Prompt", locked: true },
          prompt: {
            value:
              "Please summarize the attached document. Include the main topics, key findings, " +
              "and important conclusions. The document file will be attached as inline data.",
            locked: true,
          },
        },
        {
          label: "Output Column",
          role: "output",
          strategyKind: "create-empty",
          colTitle: { value: "AI_Summarization", locked: true },
        },
      ],
    } satisfies RecipeParams,
  },
];
