/**
 * Integration tests for src/client/recipes.ts
 *
 * Exercises each recipe's template strings through interpolateTemplate to catch
 * typos in placeholder/block syntax (e.g. mismatched closing tags) that would
 * silently pass unit tests on either module in isolation.
 */

import { RECIPES } from "../src/client/recipes";
import { interpolateTemplate } from "../src/server/utils";
import type { RecipeColumn } from "../src/client/types";

function getTemplateCol(cols: RecipeColumn[], role: RecipeColumn["role"]): string | null {
  const col = cols.find((c) => c.role === role);
  if (!col || col.fillStrategy.kind !== "template") return null;
  return col.fillStrategy.template;
}

describe("document-summarization recipe", () => {
  const recipe = RECIPES.find((r) => r.id === "document-summarization");

  it("is registered in RECIPES", () => {
    expect(recipe).toBeDefined();
  });

  describe("system-prompt template", () => {
    const template = recipe ? getTemplateCol(recipe.prepTemplate, "system-prompt") : null;

    it("uses a template fill strategy", () => {
      expect(template).not.toBeNull();
    });

    it("renders cleanly with no optional inputs", () => {
      const result = interpolateTemplate(template!, { folder: "", docType: "", focus: "" });
      expect(result).not.toContain("{{");
      expect(result).toContain("Briefing Assistant");
      expect(result).not.toContain("Document type");
      expect(result).not.toContain("Area of interest");
    });

    it("renders docType when provided", () => {
      const result = interpolateTemplate(template!, {
        folder: "",
        docType: "court filing",
        focus: "",
      });
      expect(result).toContain("Document type: court filing");
      expect(result).not.toContain("Area of interest");
      expect(result).not.toContain("{{");
    });

    it("renders focus when provided", () => {
      const result = interpolateTemplate(template!, {
        folder: "",
        docType: "",
        focus: "financial fraud",
      });
      expect(result).not.toContain("Document type");
      expect(result).toContain("Area of interest: financial fraud");
      expect(result).not.toContain("{{");
    });

    it("renders both optional inputs when provided", () => {
      const result = interpolateTemplate(template!, {
        folder: "",
        docType: "FOIA response",
        focus: "conflicts of interest",
      });
      expect(result).toContain("Document type: FOIA response");
      expect(result).toContain("Area of interest: conflicts of interest");
      expect(result).not.toContain("{{");
    });
  });
});
