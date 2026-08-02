import { deriveOrderedReferenceIds } from "../citations/manifest";
import {
  FinalDocumentSpecSchema,
  type DocumentPlan,
  type FinalDocumentSpec,
} from "../contracts";
import {
  GeneratedComponentPayloadSchema,
  type ApprovedComponent,
  type DocumentOrchestrationState,
  type GeneratedComponentPayload,
} from "../orchestration/contracts";

export class DocumentAssemblyInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentAssemblyInvariantError";
  }
}

export function deriveReferenceListPayload(input: {
  plan: DocumentPlan;
  approvedComponents: ReadonlyArray<{
    componentKey: string;
    content: ApprovedComponent;
  }>;
}): GeneratedComponentPayload {
  const blocks = input.approvedComponents.flatMap(({ content }) =>
    content.kind === "blocks" ? content.blocks : [],
  );
  return GeneratedComponentPayloadSchema.parse({
    kind: "references",
    referenceIds: deriveOrderedReferenceIds({
      blocks,
      includeAbstract:
        input.plan.templateSnapshot.citationPolicy.includeAbstract,
    }),
  });
}

export function buildFinalDocumentSpec(
  state: DocumentOrchestrationState,
): FinalDocumentSpec {
  const titleComponent = state.components.find(
    (component) => component.approved?.kind === "title",
  )?.approved;
  if (!titleComponent || titleComponent.kind !== "title") {
    throw new DocumentAssemblyInvariantError(
      "Approved orchestration has no document title.",
    );
  }

  const blocks = state.components.flatMap((component) =>
    component.approved?.kind === "blocks" ? component.approved.blocks : [],
  );
  const assets = state.components.flatMap((component) =>
    component.approved?.kind === "blocks" ? component.approved.assets : [],
  );
  const referenceSelection = state.components.find(
    (component) => component.approved?.kind === "references",
  )?.approved;
  const selectedReferenceIds =
    referenceSelection?.kind === "references"
      ? referenceSelection.referenceIds
      : [];
  const citedReferenceIds = blocks.flatMap((block) =>
    block.type === "paragraph" ? block.citationIds : [],
  );
  const orderedReferenceIds = [
    ...new Set([...citedReferenceIds, ...selectedReferenceIds]),
  ];
  const verifiedReferenceById = new Map(
    state.verifiedReferences.map((reference) => [reference.id, reference]),
  );
  const references = orderedReferenceIds.flatMap((referenceId) => {
    const reference = verifiedReferenceById.get(referenceId);
    return reference ? [reference] : [];
  });

  return FinalDocumentSpecSchema.parse({
    requestId: state.request.requestId,
    schemaVersion: 1,
    templateSnapshot: state.plan.templateSnapshot,
    metadata: {
      title: titleComponent.title,
      language: state.request.language,
      documentType: "sci_review",
      referencesStatus: references.length > 0 ? "verified" : "not_available",
    },
    blocks,
    references,
    assets,
  });
}
