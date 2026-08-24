import type { PointPaymentOrderPage } from "../domain/payment-contracts.ts";

export interface PaymentQueryRepository {
  listOrders(input: {
    ownerId: string;
    cursor: string | null;
    limit: number;
    status: "pending" | "paid" | "failed" | "closed" | "reversed" | null;
  }): Promise<PointPaymentOrderPage>;
}
