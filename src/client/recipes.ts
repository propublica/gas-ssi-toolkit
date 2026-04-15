import type { RecipeDefinition } from "./types";

export const RECIPES: RecipeDefinition[] = [
  {
    id: "document-summarization",
    name: "Document Summarization",
    icon: "📄",
    description: "Summarize each file in a Google Drive folder",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "Make sure you have access to this folder",
        placeholder: "Paste Google Drive folder URL",
      },
    ],
    prepTemplate: [
      {
        colTitle: "Drive Link",
        strategy: { kind: "list-drive-folder", inputId: "folder" },
      },
      {
        colTitle: "System Prompt",
        strategy: {
          kind: "fill-value",
          value:
            "You are an expert document analyst. Produce clear, structured summaries " +
            "focusing on key themes, main arguments, important data points, and actionable conclusions.",
        },
      },
      {
        colTitle: "User Prompt",
        strategy: {
          kind: "fill-value",
          value:
            "Please summarize the attached document. Include the main topics, key findings, " +
            "and important conclusions. The document file will be attached as inline data.",
        },
      },
      {
        colTitle: "AI_Summarization",
        strategy: { kind: "create-empty" },
      },
    ],
    runTemplate: {
      promptCols: [
        { col: "Drive Link", kind: "file" },
        { col: "User Prompt", kind: "text" },
      ],
      systemPromptCol: "System Prompt",
      outputCol: "AI_Summarization",
    },
  },
];
