import {
  DocumentTemplateDefinitionSchema,
  type DocumentTemplateDefinition,
  type TemplateCandidate,
} from "./contracts";
import { SCI_REVIEW_TEMPLATE } from "./sci-review";

export class TemplateRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateRegistryError";
  }
}

export class DocumentTemplateRegistry {
  readonly #templates: ReadonlyMap<string, DocumentTemplateDefinition>;

  constructor(definitions: ReadonlyArray<DocumentTemplateDefinition>) {
    const templates = new Map<string, DocumentTemplateDefinition>();
    for (const input of definitions) {
      const definition = DocumentTemplateDefinitionSchema.parse(input);
      const identity = `${definition.templateId}@${definition.templateVersion}`;
      if (templates.has(identity)) {
        throw new TemplateRegistryError(
          `Duplicate document template identity "${identity}".`,
        );
      }
      templates.set(identity, deepFreeze(structuredClone(definition)));
    }
    const activeTemplateIds = new Set<string>();
    for (const template of templates.values()) {
      if (template.status !== "active") continue;
      if (activeTemplateIds.has(template.templateId)) {
        throw new TemplateRegistryError(
          `Template "${template.templateId}" has multiple active versions.`,
        );
      }
      activeTemplateIds.add(template.templateId);
    }
    this.#templates = templates;
  }

  activeCandidates(input: {
    language: "zh" | "en";
    outputFormat: "docx";
    documentType: "sci_review";
  }): TemplateCandidate[] {
    return [...this.#templates.values()]
      .filter(
        (template) =>
          template.status === "active" &&
          template.documentType === input.documentType &&
          template.supportedLanguages.includes(input.language) &&
          template.supportedFormats.includes(input.outputFormat),
      )
      .map((template) => ({
        templateId: template.templateId,
        templateVersion: template.templateVersion,
        displayName: template.displayName,
        description: template.description,
        suitableFor: [...template.matchProfile.suitableFor],
        unsuitableFor: [...template.matchProfile.unsuitableFor],
      }));
  }

  getActive(templateId: string, templateVersion?: string) {
    const matches = [...this.#templates.values()].filter(
      (template) =>
        template.templateId === templateId &&
        template.status === "active" &&
        (!templateVersion || template.templateVersion === templateVersion),
    );
    if (matches.length === 0) {
      throw new TemplateRegistryError(
        `Active document template "${templateId}${templateVersion ? `@${templateVersion}` : ""}" was not found.`,
      );
    }
    if (matches.length > 1) {
      throw new TemplateRegistryError(
        `Template "${templateId}" has multiple active versions; an explicit version is required.`,
      );
    }
    return matches[0];
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}

export const DOCUMENT_V2_TEMPLATE_REGISTRY = new DocumentTemplateRegistry([
  SCI_REVIEW_TEMPLATE,
]);
