# Product Definition

## Initial Concept
Google Apps Script toolkit for importing Drive files, extracting text, sampling data, and running multimodal AI inference — developed locally with TypeScript, Rollup, and Clasp.

## Key Features
The `gas-ssi-toolkit` offers the following core functionalities:

1.  **Google Drive Integration:** Seamlessly connect with Google Drive to import and process various file types. This includes advanced capabilities for OCR on PDFs and images via the Drive Advanced Service (v3 API) to extract text content.
2.  **Quickstart Guide Access:** Provides immediate access to an introductory quickstart guide via a dedicated menu option, improving user onboarding.
3.  **Multimodal AI Inference with Gemini API:** Leverage the Gemini API to perform sophisticated AI inference directly within Google Apps Script environments, such as Google Sheets. This allows for advanced data processing and analysis.
3.  **Text Extraction and Processing:** Efficiently extract text from imported documents, enabling further manipulation and analysis. The toolkit handles different document formats and provides OCR for non-textual files.
4.  **Data Sampling:** Tools for sampling data, which can be crucial for managing large datasets and focusing AI inference on relevant subsets.
5.  **Local Development Workflow:** Supports modern software development practices including TypeScript for type safety, Rollup for bundling, ESLint for linting, and Prettier for formatting, all managed with `@google/clasp` for deployment to Google Apps Script. This facilitates a robust and efficient development cycle.
