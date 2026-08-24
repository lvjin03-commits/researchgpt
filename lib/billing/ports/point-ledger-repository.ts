import type {
  FinalizeReservationInput,
  GrantPointLotInput,
  PointAccountSnapshot,
  PointRecoveryShortfall,
  PointReservation,
  PointTransaction,
  ReleaseReservationInput,
  ReservePointsInput,
  ReservePointBundleSetInput,
  ReversePointLotInput,
  ReversePointLotResult,
} from "../domain/contracts.ts";

export interface PointLedgerRepository {
  getAccount(ownerId: string): Promise<PointAccountSnapshot | null>;
  grantLot(input: GrantPointLotInput): Promise<PointAccountSnapshot>;
  reserve(input: ReservePointsInput): Promise<PointReservation>;
  reserveBundleSet(input: ReservePointBundleSetInput): Promise<PointReservation[]>;
  settle(input: FinalizeReservationInput): Promise<PointReservation>;
  release(input: ReleaseReservationInput): Promise<PointReservation>;
  reverseLot(input: ReversePointLotInput): Promise<ReversePointLotResult>;
  listTransactions(ownerId: string): Promise<PointTransaction[]>;
  listShortfalls(ownerId: string): Promise<PointRecoveryShortfall[]>;
}
