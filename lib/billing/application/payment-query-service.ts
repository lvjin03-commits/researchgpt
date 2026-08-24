import type { PaymentQueryRepository } from "../ports/payment-query-repository.ts";

const STATUSES = new Set(["pending", "paid", "failed", "closed", "reversed"]);

export class PointPaymentQueryService {
  private readonly repository: PaymentQueryRepository;
  constructor(repository: PaymentQueryRepository) { this.repository = repository; }

  listOrders(input: { ownerId: string; cursor?: string; limit?: number; status?: string }) {
    const limit = input.limit ?? 30;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Order limit must be between 1 and 100.");
    if (input.status !== undefined && !STATUSES.has(input.status)) throw new RangeError("Unknown payment order status.");
    return this.repository.listOrders({
      ownerId: input.ownerId,
      cursor: input.cursor ?? null,
      limit,
      status: (input.status as "pending" | "paid" | "failed" | "closed" | "reversed" | undefined) ?? null,
    });
  }
}
