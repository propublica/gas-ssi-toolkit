import type { RecipeDefinition } from "./types";

export const RECIPES: RecipeDefinition[] = [
  {
    id: "document-summarization",
    name: "Document Summarization (V0)",
    icon: "📄",
    description: "Summarize files in a Google Drive folder",
    intro:
      "This recipe reads every file in a Drive folder and generates a tight, scannable summary for each one — designed to help you triage a large document set quickly. " +
      "For best results, point it at a folder of similar documents (e.g. all court filings from one case, or a set of FOIA responses).",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "The folder of documents to summarize. Make sure you have access.",
        placeholder: "Paste Google Drive folder URL",
      },
      {
        id: "docType",
        label: "Document Type",
        required: false,
        helperText:
          "Helps the AI read the document — legal language reads differently than a financial disclosure",
        placeholder: "e.g. court docket, email",
      },
      {
        id: "focus",
        label: "Area of Interest",
        required: false,
        helperText: "The AI will prioritize this above all else in the summary",
        placeholder: "e.g. specific people, financial fraud",
      },
    ],
    prepTemplate: [
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "template",
          template:
            "Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.\n\n" +
            'Tone: Objective, professional, and dense with information but sparse with "fluff" words.\n\n' +
            "Guidelines:\n" +
            '  - Prioritize Utility: Focus on information that helps a user decide: "Do I need to open the full file?"\n' +
            "  - Structure: Always start with a 1-sentence bottom line (no label or prefix — just the sentence). Follow with 3-5 high-impact bullet points.\n" +
            "  - Constraint: Keep the entire output under 150 words.\n" +
            "{{#docType}}  - Document type: {{docType}}\n{{/docType}}" +
            "{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.\n{{/focus}}",
        },
        role: "system-prompt",
      },
      {
        colTitle: "Drive Link",
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: "file-prompt",
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: "output",
      },
    ],
  },
  {
    id: "document-summarization-v1",
    name: "Document Summarization (V1)",
    icon: "📄",
    variant: "v1" as const,
    description:
      "Summarize files in a Google Drive folder — understand your documents at a glance.",
    intro:
      "This recipe reads every file in a Drive folder and generates a tight, scannable summary for each one. " +
      "Prep sets up your columns, then Test a single row, Cook everything, or Configure AI for full control.",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "The folder of documents to summarize. Make sure you have access.",
        placeholder: "Paste Google Drive folder URL",
      },
      {
        id: "docType",
        label: "Document Type",
        required: false,
        helperText:
          "Helps the AI read the document — legal language reads differently than a financial disclosure",
        placeholder: "e.g. court docket, email",
      },
      {
        id: "focus",
        label: "Area of Interest",
        required: false,
        helperText: "The AI will prioritize this above all else in the summary",
        placeholder: "e.g. specific people, financial fraud",
      },
    ],
    prepTemplate: [
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "template",
          template:
            "Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.\n\n" +
            'Tone: Objective, professional, and dense with information but sparse with "fluff" words.\n\n' +
            "Guidelines:\n" +
            '  - Prioritize Utility: Focus on information that helps a user decide: "Do I need to open the full file?"\n' +
            "  - Structure: Always start with a 1-sentence bottom line (no label or prefix — just the sentence). Follow with 3-5 high-impact bullet points.\n" +
            "  - Constraint: Keep the entire output under 150 words.\n" +
            "{{#docType}}  - Document type: {{docType}}\n{{/docType}}" +
            "{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.\n{{/focus}}",
        },
        role: "system-prompt",
      },
      {
        colTitle: "Drive Link",
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: "file-prompt",
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: "output",
      },
    ],
  },
  {
    id: "document-summarization-v2",
    name: "Document Summarization (V2)",
    icon: "📄",
    variant: "v2" as const,
    description:
      "Summarize files in a Google Drive folder — understand your documents at a glance.",
    intro:
      "This recipe reads every file in a Drive folder and generates a tight, scannable summary for each one. " +
      "Test runs on the first 10 rows so you can check quality. Cook processes everything in one shot.",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "The folder of documents to summarize. Make sure you have access.",
        placeholder: "Paste Google Drive folder URL",
      },
      {
        id: "docType",
        label: "Document Type",
        required: false,
        helperText:
          "Helps the AI read the document — legal language reads differently than a financial disclosure",
        placeholder: "e.g. court docket, email",
      },
      {
        id: "focus",
        label: "Area of Interest",
        required: false,
        helperText: "The AI will prioritize this above all else in the summary",
        placeholder: "e.g. specific people, financial fraud",
      },
    ],
    prepTemplate: [
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "template",
          template:
            "Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.\n\n" +
            'Tone: Objective, professional, and dense with information but sparse with "fluff" words.\n\n' +
            "Guidelines:\n" +
            '  - Prioritize Utility: Focus on information that helps a user decide: "Do I need to open the full file?"\n' +
            "  - Structure: Always start with a 1-sentence bottom line (no label or prefix — just the sentence). Follow with 3-5 high-impact bullet points.\n" +
            "  - Constraint: Keep the entire output under 150 words.\n" +
            "{{#docType}}  - Document type: {{docType}}\n{{/docType}}" +
            "{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.\n{{/focus}}",
        },
        role: "system-prompt",
      },
      {
        colTitle: "Drive Link",
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: "file-prompt",
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: "output",
      },
    ],
  },
  {
    id: "document-summarization-v3",
    name: "Document Summarization (V3)",
    icon: "📄",
    variant: "v3" as const,
    description:
      "Summarize files in a Google Drive folder — understand your documents at a glance.",
    intro:
      "This recipe walks you through each stage of setup before running the AI. " +
      "Import your files, configure your prompt, then Test or Cook when you're ready.",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "The folder of documents to summarize. Make sure you have access.",
        placeholder: "Paste Google Drive folder URL",
      },
      {
        id: "docType",
        label: "Document Type",
        required: false,
        helperText:
          "Helps the AI read the document — legal language reads differently than a financial disclosure",
        placeholder: "e.g. court docket, email",
      },
      {
        id: "focus",
        label: "Area of Interest",
        required: false,
        helperText: "The AI will prioritize this above all else in the summary",
        placeholder: "e.g. specific people, financial fraud",
      },
    ],
    prepTemplate: [
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "template",
          template:
            "Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.\n\n" +
            'Tone: Objective, professional, and dense with information but sparse with "fluff" words.\n\n' +
            "Guidelines:\n" +
            '  - Prioritize Utility: Focus on information that helps a user decide: "Do I need to open the full file?"\n' +
            "  - Structure: Always start with a 1-sentence bottom line (no label or prefix — just the sentence). Follow with 3-5 high-impact bullet points.\n" +
            "  - Constraint: Keep the entire output under 150 words.\n" +
            "{{#docType}}  - Document type: {{docType}}\n{{/docType}}" +
            "{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.\n{{/focus}}",
        },
        role: "system-prompt",
      },
      {
        colTitle: "Drive Link",
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: "file-prompt",
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: "output",
      },
    ],
  },
];
