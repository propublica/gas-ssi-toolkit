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
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: { kind: "file-prompt" },
      },
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "fill-value",
          value:
            "You are an expert document analyst. Produce clear, structured summaries " +
            "focusing on key themes, main arguments, important data points, and actionable conclusions.",
        },
        role: { kind: "system-prompt" },
      },
      {
        colTitle: "User Prompt",
        fillStrategy: {
          kind: "fill-value",
          value:
            "Please summarize the attached document. Include the main topics, key findings, " +
            "and important conclusions. The document file will be attached as inline data.",
        },
        role: { kind: "text-prompt" },
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: { kind: "output" },
      },
    ],
  },
];
