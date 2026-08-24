import { reconcileProviderSettlements, type ProviderSettlementRecord } from "../domain/reconciliation.ts";
import type { ReconciliationRepository } from "../ports/reconciliation-repository.ts";

export class PaymentReconciliationService {
  private readonly repository: ReconciliationRepository;
  constructor(repository: ReconciliationRepository) { this.repository = repository; }

  async reconcile(input: { provider: string; merchantAccountId: string; from: string; to: string; providerRecords: ProviderSettlementRecord[] }) {
    const internalOrders = await this.repository.listInternalOrders(input);
    return {
      providerFindings: reconcileProviderSettlements({ providerRecords: input.providerRecords, internalOrders }),
      internalFindings: await this.repository.inspectInternalInvariants(),
    };
  }
}
