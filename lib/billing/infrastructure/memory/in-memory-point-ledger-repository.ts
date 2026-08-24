import { randomUUID } from "node:crypto";
import {
  InsufficientPointsError,
  PointAccountOnHoldError,
  PointLedgerConflictError,
  type FinalizeReservationInput,
  type GrantPointLotInput,
  type PointAccount,
  type PointAccountSnapshot,
  type PointLot,
  type PointRecoveryShortfall,
  type PointReservation,
  type PointTransaction,
  type ReleaseReservationInput,
  type ReservePointsInput,
  type ReservePointBundleSetInput,
  type ReversePointLotInput,
  type ReversePointLotResult,
} from "../../domain/contracts.ts";
import type { PointLedgerRepository } from "../../ports/point-ledger-repository.ts";

type Allocation = { lotId: string; reservedPoints: number };

function copy<T>(value: T): T {
  return structuredClone(value);
}

function lotOrder(left: PointLot, right: PointLot): number {
  if (left.expiresAt && right.expiresAt) return left.expiresAt.localeCompare(right.expiresAt);
  if (left.expiresAt) return -1;
  if (right.expiresAt) return 1;
  const priority = { purchase_bonus: 0, promotional_trial: 1, purchased: 2 } as const;
  return priority[left.grantKind] - priority[right.grantKind] || left.createdAt.localeCompare(right.createdAt);
}

export class InMemoryPointLedgerRepository implements PointLedgerRepository {
  private readonly accounts = new Map<string, PointAccount>();
  private readonly lots = new Map<string, PointLot>();
  private readonly reservations = new Map<string, PointReservation>();
  private readonly reservationByOperation = new Map<string, string>();
  private readonly allocations = new Map<string, Allocation[]>();
  private readonly events = new Map<string, unknown>();
  private readonly transactions: PointTransaction[] = [];
  private readonly shortfalls: PointRecoveryShortfall[] = [];

  async getAccount(ownerId: string): Promise<PointAccountSnapshot | null> {
    const account = this.accounts.get(ownerId);
    return account ? this.snapshot(account) : null;
  }

  async grantLot(input: GrantPointLotInput): Promise<PointAccountSnapshot> {
    this.assertPositiveInteger(input.points);
    const replay = this.events.get(input.eventId) as PointAccountSnapshot | undefined;
    if (replay) return copy(replay);
    if (this.lots.has(input.lotId)) throw new PointLedgerConflictError("lot ID already exists");

    const account = this.ensureAccount(input.ownerId, input.now);
    const lot: PointLot = {
      lotId: input.lotId,
      accountId: account.accountId,
      grantKind: input.grantKind,
      pointsGranted: input.points,
      pointsRemaining: input.points,
      paymentOrderId: input.paymentOrderId,
      campaignId: input.campaignId,
      grantReason: input.grantReason,
      policyVersion: input.policyVersion,
      expiresAt: input.expiresAt,
      createdAt: input.now,
    };
    this.lots.set(lot.lotId, lot);
    account.availablePoints += input.points;
    this.touch(account, input.now);
    this.record(input.eventId, account, "grant", input.points, 0, 0, "point_grant", input.now, lot.lotId, null);
    const result = this.snapshot(account);
    this.events.set(input.eventId, copy(result));
    return result;
  }

  async reserve(input: ReservePointsInput): Promise<PointReservation> {
    this.assertPositiveInteger(input.points);
    const existingId = this.reservationByOperation.get(input.billingOperationId);
    if (existingId) return copy(this.reservations.get(existingId)!);
    if (this.reservations.has(input.reservationId)) throw new PointLedgerConflictError("reservation ID already exists");

    const account = this.accounts.get(input.ownerId);
    if (!account) throw new InsufficientPointsError(0, input.points);
    if (account.status !== "active") throw new PointAccountOnHoldError();
    if (account.availablePoints < input.points) {
      throw new InsufficientPointsError(account.availablePoints, input.points);
    }

    const eligible = this.accountLots(account.accountId)
      .filter((lot) => lot.pointsRemaining > 0 && (!lot.expiresAt || lot.expiresAt > input.now))
      .sort(lotOrder);
    let remaining = input.points;
    const allocations: Allocation[] = [];
    for (const lot of eligible) {
      if (remaining === 0) break;
      const reservedPoints = Math.min(lot.pointsRemaining, remaining);
      lot.pointsRemaining -= reservedPoints;
      remaining -= reservedPoints;
      allocations.push({ lotId: lot.lotId, reservedPoints });
    }
    if (remaining !== 0) throw new PointLedgerConflictError("account summary and point lots diverged");

    const reservation: PointReservation = {
      reservationId: input.reservationId,
      accountId: account.accountId,
      billingOperationId: input.billingOperationId,
      requestedPoints: input.points,
      reservedPoints: input.points,
      settledPoints: 0,
      releasedPoints: 0,
      status: "reserved",
      pricePolicyVersion: input.pricePolicyVersion,
      expiresAt: input.expiresAt,
      createdAt: input.now,
      finalizedAt: null,
    };
    this.reservations.set(reservation.reservationId, reservation);
    this.reservationByOperation.set(input.billingOperationId, reservation.reservationId);
    this.allocations.set(reservation.reservationId, allocations);
    account.availablePoints -= input.points;
    account.reservedPoints += input.points;
    this.touch(account, input.now);
    this.record(randomUUID(), account, "reserve", -input.points, input.points, 0, "point_reservation", input.now, null, reservation.reservationId);
    return copy(reservation);
  }

  async reserveBundleSet(input: ReservePointBundleSetInput): Promise<PointReservation[]> {
    if (input.bundles.length === 0) throw new PointLedgerConflictError("a bundle set must not be empty");
    const operationIds = input.bundles.map((bundle) => bundle.billingOperationId);
    const reservationIds = input.bundles.map((bundle) => bundle.reservationId);
    if (new Set(operationIds).size !== operationIds.length || new Set(reservationIds).size !== reservationIds.length) {
      throw new PointLedgerConflictError("bundle reservation identities must be unique");
    }
    const existing = operationIds.map((operationId) => this.reservationByOperation.get(operationId));
    if (existing.every(Boolean)) return existing.map((reservationId) => copy(this.reservations.get(reservationId!)!));
    if (existing.some(Boolean)) throw new PointLedgerConflictError("bundle set is only partially present");
    const account = this.accounts.get(input.ownerId);
    const total = input.bundles.reduce((sum, bundle) => sum + bundle.points, 0);
    if (!account || account.availablePoints < total) throw new InsufficientPointsError(account?.availablePoints ?? 0, total);
    if (account.status !== "active") throw new PointAccountOnHoldError();
    return Promise.all(input.bundles.map((bundle) => this.reserve({ ownerId: input.ownerId, ...bundle })));
  }

  async settle(input: FinalizeReservationInput): Promise<PointReservation> {
    this.assertNonnegativeInteger(input.settledPoints);
    const replay = this.events.get(input.eventId) as PointReservation | undefined;
    if (replay) return copy(replay);
    const reservation = this.ownedReservation(input.ownerId, input.reservationId);
    if (reservation.status !== "reserved") return copy(reservation);
    if (input.settledPoints > reservation.reservedPoints) {
      throw new PointLedgerConflictError("settlement exceeds reserved points");
    }

    const account = this.accountById(reservation.accountId);
    let toSettle = input.settledPoints;
    let released = 0;
    for (const allocation of this.allocations.get(reservation.reservationId) ?? []) {
      const settled = Math.min(allocation.reservedPoints, toSettle);
      const returned = allocation.reservedPoints - settled;
      toSettle -= settled;
      released += returned;
      if (returned > 0) this.lots.get(allocation.lotId)!.pointsRemaining += returned;
    }
    account.reservedPoints -= reservation.reservedPoints;
    account.availablePoints += released;
    account.lifetimeSpentPoints += input.settledPoints;
    this.touch(account, input.now);
    reservation.settledPoints = input.settledPoints;
    reservation.releasedPoints = released;
    reservation.status = "settled";
    reservation.finalizedAt = input.now;
    if (input.settledPoints > 0) this.record(input.eventId, account, "settle", 0, -input.settledPoints, input.settledPoints, input.reason, input.now, null, reservation.reservationId);
    if (released > 0) this.record(randomUUID(), account, "release", released, -released, 0, "unused_reservation", input.now, null, reservation.reservationId);
    this.events.set(input.eventId, copy(reservation));
    return copy(reservation);
  }

  async release(input: ReleaseReservationInput): Promise<PointReservation> {
    const replay = this.events.get(input.eventId) as PointReservation | undefined;
    if (replay) return copy(replay);
    const reservation = this.ownedReservation(input.ownerId, input.reservationId);
    if (reservation.status !== "reserved") return copy(reservation);
    const account = this.accountById(reservation.accountId);
    for (const allocation of this.allocations.get(reservation.reservationId) ?? []) {
      this.lots.get(allocation.lotId)!.pointsRemaining += allocation.reservedPoints;
    }
    account.reservedPoints -= reservation.reservedPoints;
    account.availablePoints += reservation.reservedPoints;
    this.touch(account, input.now);
    reservation.releasedPoints = reservation.reservedPoints;
    reservation.status = "released";
    reservation.finalizedAt = input.now;
    this.record(input.eventId, account, "release", reservation.reservedPoints, -reservation.reservedPoints, 0, input.reason, input.now, null, reservation.reservationId);
    this.events.set(input.eventId, copy(reservation));
    return copy(reservation);
  }

  async reverseLot(input: ReversePointLotInput): Promise<ReversePointLotResult> {
    this.assertPositiveInteger(input.points);
    const replay = this.events.get(input.eventId) as ReversePointLotResult | undefined;
    if (replay) return copy(replay);
    const lot = this.lots.get(input.lotId);
    if (!lot) throw new PointLedgerConflictError("point lot does not exist");
    const account = this.accounts.get(input.ownerId);
    if (!account || account.accountId !== lot.accountId) throw new PointLedgerConflictError("point lot is not owned by account");
    const recoveredPoints = Math.min(lot.pointsRemaining, input.points);
    const shortfallPoints = input.points - recoveredPoints;
    lot.pointsRemaining -= recoveredPoints;
    account.availablePoints -= recoveredPoints;
    if (shortfallPoints > 0) {
      account.status = "risk_hold";
      this.shortfalls.push({
        shortfallId: randomUUID(), accountId: account.accountId, lotId: lot.lotId,
        eventId: input.eventId, expectedPoints: input.points, recoveredPoints,
        shortfallPoints, reason: input.reason, status: "open", createdAt: input.now,
      });
    }
    this.touch(account, input.now);
    this.record(input.eventId, account, "reversal", -recoveredPoints, 0, 0, input.reason, input.now, lot.lotId, null);
    const result = { recoveredPoints, shortfallPoints, account: copy(account) };
    this.events.set(input.eventId, copy(result));
    return result;
  }

  async listTransactions(ownerId: string): Promise<PointTransaction[]> {
    const account = this.accounts.get(ownerId);
    return account ? copy(this.transactions.filter((item) => item.accountId === account.accountId)) : [];
  }

  async listShortfalls(ownerId: string): Promise<PointRecoveryShortfall[]> {
    const account = this.accounts.get(ownerId);
    return account ? copy(this.shortfalls.filter((item) => item.accountId === account.accountId)) : [];
  }

  private ensureAccount(ownerId: string, now: string): PointAccount {
    const existing = this.accounts.get(ownerId);
    if (existing) return existing;
    const account: PointAccount = {
      accountId: randomUUID(), ownerId, status: "active", availablePoints: 0,
      reservedPoints: 0, lifetimeSpentPoints: 0, version: 0, createdAt: now, updatedAt: now,
    };
    this.accounts.set(ownerId, account);
    return account;
  }

  private snapshot(account: PointAccount): PointAccountSnapshot {
    return { account: copy(account), lots: copy(this.accountLots(account.accountId).sort(lotOrder)) };
  }

  private accountLots(accountId: string): PointLot[] {
    return [...this.lots.values()].filter((lot) => lot.accountId === accountId);
  }

  private accountById(accountId: string): PointAccount {
    const account = [...this.accounts.values()].find((item) => item.accountId === accountId);
    if (!account) throw new PointLedgerConflictError("point account does not exist");
    return account;
  }

  private ownedReservation(ownerId: string, reservationId: string): PointReservation {
    const reservation = this.reservations.get(reservationId);
    const account = this.accounts.get(ownerId);
    if (!reservation || !account || reservation.accountId !== account.accountId) {
      throw new PointLedgerConflictError("reservation is not owned by account");
    }
    return reservation;
  }

  private touch(account: PointAccount, now: string) {
    account.version += 1;
    account.updatedAt = now;
  }

  private record(eventId: string, account: PointAccount, kind: PointTransaction["kind"], availableDelta: number, reservedDelta: number, spentDelta: number, reason: string, now: string, lotId: string | null, reservationId: string | null) {
    this.transactions.push({ transactionId: randomUUID(), accountId: account.accountId, eventId, kind, lotId, reservationId, availableDelta, reservedDelta, spentDelta, reason, metadata: {}, createdAt: now });
  }

  private assertPositiveInteger(value: number) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new PointLedgerConflictError("points must be a positive safe integer");
  }

  private assertNonnegativeInteger(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) throw new PointLedgerConflictError("points must be a nonnegative safe integer");
  }
}
