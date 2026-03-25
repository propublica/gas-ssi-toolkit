import type { RecipeDefinition } from "./types";
import type { RecipeParams } from "./types";

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
          kind: "drive-file-folder",
          colTitle: { value: "Drive Link", locked: false },
          url: { value: "", locked: false, placeholder: "Paste Google Drive folder URL" },
          helperText: "Make sure you have access to this folder",
        },
        {
          kind: "system-prompt",
          colTitle: { value: "System Prompt", locked: true },
          prompt: {
            value:
              "You are an expert document analyst. Produce clear, structured summaries " +
              "focusing on key themes, main arguments, important data points, and actionable conclusions.",
            locked: true,
          },
        },
        {
          kind: "user-prompt",
          colTitle: { value: "User Prompt", locked: true },
          prompt: {
            value:
              "Please summarize the attached document. Include the main topics, key findings, " +
              "and important conclusions. The document file will be attached as inline data.",
            locked: true,
          },
        },
        {
          kind: "output",
          colTitle: { value: "AI_Summarization", locked: true },
        },
      ],
    } satisfies RecipeParams,
  },
  {
    id: "find-a-thing",
    name: "Find a Thing in a Thing",
    icon: "🔍",
    description: "Scan a folder of files to find which ones contain a specific item",
    panelId: "recipe",
    params: {
      columns: [
        {
          kind: "drive-file-folder",
          colTitle: { value: "Drive Link", locked: false },
          url: { value: "", locked: false, placeholder: "Paste Google Drive folder URL" },
          helperText: "The folder of files to scan",
        },
        {
          kind: "drive-file-constant",
          colTitle: { value: "Reference File", locked: false },
          url: { value: "", locked: false, placeholder: "Paste a Drive link to a reference file" },
          helperText: "Optional. Any file type — attach an example of what you're looking for.",
        },
        {
          kind: "system-prompt",
          colTitle: { value: "System Prompt", locked: true },
          prompt: {
            value:
              "You are a document analyst helping a reporter identify specific items within " +
              "a collection of files. For each file you receive, determine whether it contains " +
              "the item described below. Respond with exactly one of: \"yes\", \"no\", or " +
              "\"unsure\". Follow your answer with a single sentence explaining your reasoning. " +
              "Do not add any other commentary.\n\n" +
              "If a reference file is attached, it is a concrete example of what you are looking " +
              "for — use it as a visual or structural guide when evaluating the document.",
            locked: true,
          },
          appendFields: [
            {
              id: "searchDescription",
              label: "What are you looking for?",
              placeholder:
                "Describe the item, person, pattern, or visual artifact you want to find",
              prefix: "\n\nYou are specifically looking for:\n\n",
            },
          ],
        },
        {
          kind: "user-prompt",
          colTitle: { value: "User Prompt", locked: true },
          prompt: {
            value:
              "Analyze the attached file and determine whether it contains the item described " +
              "in your instructions.",
            locked: true,
          },
        },
        {
          kind: "output",
          colTitle: { value: "AI_FindAThing", locked: false },
        },
      ],
    } satisfies RecipeParams,
  },
];
