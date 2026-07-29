import { randomUUID } from "node:crypto";
import type {
  AcceptOfferRequest,
  ActivityEntry,
  CheckoutSnapshot,
  CreateCheckoutSessionRequest,
  ListingsResponse,
  PaymentOutcome,
  PurchaseRequest,
  PurchaseResponse,
  Surface,
} from "@checkout/sdk/contracts";
import { DEMO_EVENT } from "../../fixtures";
import type { InMemoryKeyedLock } from "../../providers/keyed-lock";
import type {
  CheckoutMemoryRepository,
  CheckoutSessionRecord,
  ListingRecord,
  OrderRecord,
  PurchaseAttemptRecord,
} from "../../providers/memory-checkout-repository";
import type { DelayedPaymentSimulator } from "../../providers/payment-simulator";
import type { RealtimeHub } from "../../providers/realtime-hub";
import {
  CheckoutSessionExpired,
  CheckoutSessionNotFound,
  CheckoutError,
  InvalidPriceAdjustment,
  InvalidResumeToken,
  ListingUnavailable,
  OfferVersionMismatch,
  PurchaseNotAllowed,
  type CheckoutUpdate,
} from "./checkout.errors";
import { projectCheckout } from "./checkout.projection";

const HOLD_DURATION_MS = 90_000;

function identifier(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

function resumeToken(): string {
  return crypto.getRandomValues(new Uint8Array(32)).toBase64();
}

export interface CreatedCheckout {
  snapshot: CheckoutSnapshot;
  resumeToken: string;
}

export type CreateCheckoutSessionInput = CreateCheckoutSessionRequest;

export interface SessionIdInput {
  sessionId: string;
}

export interface AuthenticatedSessionInput extends SessionIdInput {
  resumeToken: string;
}

export interface CheckoutClientInput extends AuthenticatedSessionInput {
  surface: Surface;
  deviceId: string;
}

export interface AcceptOfferInput
  extends AuthenticatedSessionInput, AcceptOfferRequest {}

export interface RepriceInput extends AuthenticatedSessionInput {
  increaseCents: number;
}

export interface PurchaseInput
  extends AuthenticatedSessionInput, PurchaseRequest {
  idempotencyKey: string;
}

export type PurchaseOutput = PurchaseResponse;

interface Mutation<T> {
  value: T;
  updates?: readonly CheckoutUpdate[];
}

type PurchaseStart =
  | { kind: "resolved"; response: PurchaseResponse }
  | {
      kind: "authorize";
      response: PurchaseResponse;
      attempt: PurchaseAttemptRecord;
    };

interface SessionOperationInput {
  session: CheckoutSessionRecord;
  listing: ListingRecord;
  now: Date;
}

interface TransitionOutput {
  session: CheckoutSessionRecord;
  snapshot: CheckoutSnapshot;
  update: CheckoutUpdate;
}

export class CheckoutService {
  constructor(
    private readonly repository: CheckoutMemoryRepository,
    private readonly locks: InMemoryKeyedLock,
    private readonly payment: DelayedPaymentSimulator,
    private readonly realtime: RealtimeHub,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listListings(): Promise<ListingsResponse> {
    const listingIds = this.repository
      .listListings()
      .map((listing) => listing.id)
      .sort();
    for (const listingId of listingIds) {
      await this.reconcileExpiredListing(listingId);
    }

    const listings = this.repository.listListings().map((listing) => ({
      id: listing.id,
      section: listing.section,
      row: listing.row,
      seat: listing.seat,
      priceCents: listing.priceCents,
      status: listing.status,
    }));

    return { event: DEMO_EVENT, listings };
  }

  async createSession(
    input: CreateCheckoutSessionRequest,
  ): Promise<CreatedCheckout> {
    await this.reconcileExpiredListing(input.listingId);
    let updatesOnError: readonly CheckoutUpdate[] = [];
    try {
      const mutation = await this.locks.withKeys(
        [`checkout-owner:${input.deviceId}`],
        async (): Promise<Mutation<CreatedCheckout>> => {
          const association =
            this.repository.getNonterminalSessionByInitiatingDevice(
              input.deviceId,
            );
          const lockKeys = [`listing:${input.listingId}`];
          if (association) {
            lockKeys.push(
              `listing:${association.listing.id}`,
              `session:${association.id}`,
            );
          }

          return this.locks.withKeys(
            lockKeys,
            async (): Promise<Mutation<CreatedCheckout>> => {
              const now = this.now();
              const prior =
                this.repository.getNonterminalSessionByInitiatingDevice(
                  input.deviceId,
                );

              if (prior?.phase === "purchasing") {
                throw new PurchaseNotAllowed(projectCheckout(prior, now));
              }

              const priorListing = prior
                ? this.repository.getListing(prior.listing.id)
                : undefined;
              const expired =
                prior && priorListing
                  ? this.expireIfNeeded(prior, priorListing, now)
                  : undefined;
              const currentPrior = expired === undefined ? prior : undefined;
              const currentListing = this.repository.getListing(
                input.listingId,
              );
              if (
                !currentListing ||
                (currentListing.status !== "available" &&
                  currentListing.heldBySessionId !== currentPrior?.id)
              ) {
                updatesOnError = expired ? [expired.update] : [];
                throw new ListingUnavailable(input.listingId);
              }

              const superseded =
                currentPrior && priorListing
                  ? this.abandon(currentPrior, priorListing, now, {
                      surface: input.surface,
                      deviceId: input.deviceId,
                      reason: "superseded",
                    })
                  : undefined;
              const availableListing = this.repository.getListing(
                input.listingId,
              );
              if (
                !availableListing ||
                availableListing.status !== "available"
              ) {
                updatesOnError = expired ? [expired.update] : [];
                throw new ListingUnavailable(input.listingId);
              }

              const session = this.createRecord(availableListing, input, now);
              this.repository.saveSession(session);
              this.repository.saveListing({
                ...availableListing,
                status: "held",
                heldBySessionId: session.id,
              });
              this.repository.appendActivity({
                id: identifier("act"),
                at: now.toISOString(),
                sessionId: session.id,
                revision: session.revision,
                type: "checkout_session_created",
                surface: input.surface,
                deviceId: input.deviceId,
                details: {
                  listingId: availableListing.id,
                  expiresAt: session.inventoryHold.expiresAt,
                },
              });

              return {
                value: {
                  snapshot: projectCheckout(session, now),
                  resumeToken: session.resumeToken,
                },
                ...(superseded
                  ? { updates: [superseded.update] }
                  : expired
                    ? { updates: [expired.update] }
                    : {}),
              };
            },
          );
        },
      );
      this.publishUpdates(mutation.updates);
      return mutation.value;
    } catch (error) {
      if (error instanceof CheckoutError) {
        this.publishUpdates(
          error.updates.length > 0 ? error.updates : updatesOnError,
        );
      }
      throw error;
    }
  }

  async getSession(
    input: AuthenticatedSessionInput,
  ): Promise<CheckoutSnapshot> {
    return this.withSession(input.sessionId, ({ session, listing, now }) => {
      this.authenticate(session, input.resumeToken);

      const expired = this.expireIfNeeded(session, listing, now);
      return {
        value: projectCheckout(expired?.session ?? session, now),
        ...(expired ? { updates: [expired.update] } : {}),
      };
    });
  }

  async resume(input: CheckoutClientInput): Promise<CheckoutSnapshot> {
    return this.withSession(input.sessionId, ({ session, listing, now }) => {
      this.authenticate(session, input.resumeToken);

      const expired = this.expireIfNeeded(session, listing, now);
      const current = expired?.session ?? session;

      const knownClient = current.observedClients.some(
        (client) =>
          client.surface === input.surface &&
          client.deviceId === input.deviceId,
      );
      if (knownClient) {
        return {
          value: projectCheckout(current, now),
          ...(expired ? { updates: [expired.update] } : {}),
        };
      }

      const resumed: CheckoutSessionRecord = {
        ...current,
        observedClients: [
          ...current.observedClients,
          { surface: input.surface, deviceId: input.deviceId },
        ],
      };
      this.repository.saveSession(resumed);
      this.repository.appendActivity({
        id: identifier("act"),
        at: now.toISOString(),
        sessionId: resumed.id,
        revision: resumed.revision,
        type: "checkout_session_resumed",
        surface: input.surface,
        deviceId: input.deviceId,
        details: {},
      });

      return {
        value: projectCheckout(resumed, now),
        ...(expired ? { updates: [expired.update] } : {}),
      };
    });
  }

  async leave(input: CheckoutClientInput): Promise<CheckoutSnapshot> {
    return this.withSession(input.sessionId, ({ session, listing, now }) => {
      this.authenticate(session, input.resumeToken);

      const expired = this.expireIfNeeded(session, listing, now);
      if (expired) {
        return {
          value: expired.snapshot,
          updates: [expired.update],
        };
      }
      if (
        session.phase !== "active" ||
        this.realtime.connectionCount(session.id) > 1
      ) {
        return { value: projectCheckout(session, now) };
      }

      const abandoned = this.abandon(session, listing, now, {
        surface: input.surface,
        deviceId: input.deviceId,
        reason: "navigation",
      });
      return {
        value: abandoned.snapshot,
        updates: [abandoned.update],
      };
    });
  }

  async acceptOffer(input: AcceptOfferInput): Promise<CheckoutSnapshot> {
    return this.withSession(input.sessionId, ({ session, listing, now }) => {
      this.authenticate(session, input.resumeToken);

      const expired = this.expireIfNeeded(session, listing, now);
      if (expired || session.phase === "expired") {
        throw new CheckoutSessionExpired(
          expired?.snapshot ?? projectCheckout(session, now),
          expired ? [expired.update] : [],
        );
      }

      const currentSnapshot = projectCheckout(session, now);
      if (session.phase !== "active") {
        throw new PurchaseNotAllowed(currentSnapshot);
      }
      if (input.offerVersion !== session.offer.currentVersion) {
        throw new OfferVersionMismatch(currentSnapshot);
      }
      if (session.offer.acceptedVersion === session.offer.currentVersion) {
        return { value: currentSnapshot };
      }

      const accepted: CheckoutSessionRecord = {
        ...session,
        revision: session.revision + 1,
        updatedAt: now.toISOString(),
        offer: {
          ...session.offer,
          acceptedVersion: session.offer.currentVersion,
          acceptedTotalCents: session.offer.currentTotalCents,
        },
      };
      this.repository.saveSession(accepted);
      this.repository.appendActivity({
        id: identifier("act"),
        at: now.toISOString(),
        sessionId: accepted.id,
        revision: accepted.revision,
        type: "price_change_accepted",
        surface: input.surface,
        deviceId: input.deviceId,
        details: {
          acceptedVersion: accepted.offer.acceptedVersion,
          acceptedTotalCents: accepted.offer.acceptedTotalCents,
        },
      });
      const snapshot = projectCheckout(accepted, now);
      return {
        value: snapshot,
        updates: [{ cause: "offer_accepted", snapshot }],
      };
    });
  }

  async reprice(input: RepriceInput): Promise<CheckoutSnapshot> {
    return this.withSession(input.sessionId, ({ session, listing, now }) => {
      this.authenticate(session, input.resumeToken);
      const expired = this.expireIfNeeded(session, listing, now);
      if (expired || session.phase === "expired") {
        throw new CheckoutSessionExpired(
          expired?.snapshot ?? projectCheckout(session, now),
          expired ? [expired.update] : [],
        );
      }

      const currentSnapshot = projectCheckout(session, now);
      if (session.phase !== "active") {
        throw new PurchaseNotAllowed(currentSnapshot);
      }

      const nextVersion = session.offer.currentVersion + 1;
      const nextTotal = session.offer.currentTotalCents + input.increaseCents;
      if (
        !Number.isSafeInteger(input.increaseCents) ||
        !Number.isSafeInteger(nextVersion) ||
        !Number.isSafeInteger(nextTotal)
      ) {
        throw new InvalidPriceAdjustment();
      }

      const repriced: CheckoutSessionRecord = {
        ...session,
        revision: session.revision + 1,
        updatedAt: now.toISOString(),
        offer: {
          ...session.offer,
          currentVersion: nextVersion,
          currentTotalCents: nextTotal,
        },
      };
      this.repository.saveSession(repriced);
      this.repository.appendActivity({
        id: identifier("act"),
        at: now.toISOString(),
        sessionId: repriced.id,
        revision: repriced.revision,
        type: "price_changed",
        details: {
          previousTotalCents: session.offer.currentTotalCents,
          currentTotalCents: repriced.offer.currentTotalCents,
          currentVersion: repriced.offer.currentVersion,
        },
      });
      const snapshot = projectCheckout(repriced, now);
      return {
        value: snapshot,
        updates: [{ cause: "repriced", snapshot }],
      };
    });
  }

  async forceExpire(
    input: AuthenticatedSessionInput,
  ): Promise<CheckoutSnapshot> {
    return this.withSession(input.sessionId, ({ session, listing, now }) => {
      this.authenticate(session, input.resumeToken);
      if (session.phase !== "active") {
        return { value: projectCheckout(session, now) };
      }

      const expired = this.expire(session, listing, now);
      return { value: expired.snapshot, updates: [expired.update] };
    });
  }

  async purchase(input: PurchaseInput): Promise<PurchaseOutput> {
    const started = await this.withSession(
      input.sessionId,
      ({ session, listing, now }) =>
        this.startPurchase(input, session, listing, now),
    );
    if (started.kind === "resolved") {
      return started.response;
    }

    const authorization = await this.payment.authorize({
      sessionId: input.sessionId,
      attemptId: started.attempt.id,
      amountCents: started.attempt.totalCents,
      currency: started.attempt.currency,
    });
    return this.withSession(input.sessionId, ({ session, listing, now }) =>
      this.finalizePurchase(
        started.attempt,
        authorization,
        session,
        listing,
        now,
      ),
    );
  }

  async recordAppHandoff(
    input: AuthenticatedSessionInput,
    handoff: () => Promise<void>,
  ): Promise<void> {
    await this.withSession(input.sessionId, ({ session }) => {
      this.authenticate(session, input.resumeToken);
      return { value: undefined };
    });
    await handoff();

    return this.withSession(input.sessionId, ({ session, now }) => {
      this.repository.appendActivity({
        id: identifier("act"),
        at: now.toISOString(),
        sessionId: session.id,
        revision: session.revision,
        type: "app_handoff_opened",
        details: {},
      });
      return { value: undefined };
    });
  }

  async listActivity(
    input: AuthenticatedSessionInput,
  ): Promise<readonly ActivityEntry[]> {
    return this.withSession(input.sessionId, ({ session }) => {
      this.authenticate(session, input.resumeToken);
      return { value: this.repository.listActivity(input.sessionId) };
    });
  }

  private authenticate(session: CheckoutSessionRecord, token: string): void {
    if (session.resumeToken !== token) {
      throw new InvalidResumeToken();
    }
  }

  private publishUpdates(updates: readonly CheckoutUpdate[] = []): void {
    for (const update of updates) {
      this.realtime.publish({
        type: "checkout_session_updated",
        cause: update.cause,
        snapshot: update.snapshot,
      });
    }
  }

  private async withSession<T>(
    sessionId: string,
    operation: (input: SessionOperationInput) => Mutation<T>,
  ): Promise<T> {
    try {
      const mutation = await this.lockSession(sessionId, operation);
      this.publishUpdates(mutation.updates);
      return mutation.value;
    } catch (error) {
      if (error instanceof CheckoutError) {
        this.publishUpdates(error.updates);
      }
      throw error;
    }
  }

  private async lockSession<T>(
    sessionId: string,
    operation: (input: SessionOperationInput) => Mutation<T>,
  ): Promise<Mutation<T>> {
    const association = this.repository.getSession(sessionId);
    if (!association) {
      throw new CheckoutSessionNotFound(sessionId);
    }
    return this.locks.withKeys(
      [`listing:${association.listing.id}`, `session:${sessionId}`],
      async () => {
        const session = this.repository.getSession(sessionId);
        const listing = this.repository.getListing(association.listing.id);
        if (!session || !listing) {
          throw new CheckoutSessionNotFound(sessionId);
        }
        return operation({ session, listing, now: this.now() });
      },
    );
  }

  private startPurchase(
    input: PurchaseInput,
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
  ): Mutation<PurchaseStart> {
    this.authenticate(session, input.resumeToken);

    const expired = this.expireIfNeeded(session, listing, now);
    const snapshot = expired?.snapshot ?? projectCheckout(session, now);
    const replay = this.repository.getAttemptByIdempotencyKey(
      session.id,
      input.idempotencyKey,
    );
    if (replay) {
      return {
        value: {
          kind: "resolved",
          response: this.purchaseOutput(
            this.dispositionForAttempt(replay),
            snapshot,
            false,
          ),
        },
        ...(expired ? { updates: [expired.update] } : {}),
      };
    }

    if (expired || session.phase === "expired") {
      throw new CheckoutSessionExpired(
        snapshot,
        expired ? [expired.update] : [],
      );
    }

    const order = this.repository.getOrderBySessionId(session.id);
    if (order || session.phase === "completed") {
      return {
        value: {
          kind: "resolved",
          response: this.purchaseOutput("completed", snapshot, false),
        },
      };
    }

    if (
      session.payment.status === "pending" ||
      session.phase === "purchasing"
    ) {
      this.repository.appendActivity({
        id: identifier("act"),
        at: now.toISOString(),
        sessionId: session.id,
        revision: session.revision,
        type: "duplicate_purchase_prevented",
        surface: input.surface,
        deviceId: input.deviceId,
        details: {},
      });
      return {
        value: {
          kind: "resolved",
          response: this.purchaseOutput("pending", snapshot, true),
        },
      };
    }

    if (
      session.phase !== "active" ||
      listing.status !== "held" ||
      listing.heldBySessionId !== session.id ||
      session.offer.currentVersion !== session.offer.acceptedVersion ||
      session.offer.currentTotalCents !== session.offer.acceptedTotalCents
    ) {
      throw new PurchaseNotAllowed(snapshot);
    }

    const attempt: PurchaseAttemptRecord = {
      id: identifier("pat"),
      sessionId: session.id,
      idempotencyKey: input.idempotencyKey,
      offerVersion: session.offer.acceptedVersion,
      totalCents: session.offer.acceptedTotalCents,
      currency: session.offer.currency,
      initiatedBySurface: input.surface,
      initiatedByDeviceId: input.deviceId,
      status: "pending",
      createdAt: now.toISOString(),
    };
    const purchasing: CheckoutSessionRecord = {
      ...session,
      revision: session.revision + 1,
      updatedAt: now.toISOString(),
      phase: "purchasing",
      payment: { status: "pending", attemptId: attempt.id },
    };
    this.repository.saveAttempt(attempt);
    this.repository.saveSession(purchasing);
    this.repository.appendActivity({
      id: identifier("act"),
      at: now.toISOString(),
      sessionId: purchasing.id,
      revision: purchasing.revision,
      type: "checkout_purchase_started",
      surface: input.surface,
      deviceId: input.deviceId,
      details: { totalCents: attempt.totalCents },
    });
    const purchasingSnapshot = projectCheckout(purchasing, now);

    return {
      value: {
        kind: "authorize",
        response: this.purchaseOutput("pending", purchasingSnapshot, false),
        attempt,
      },
      updates: [{ cause: "purchase_started", snapshot: purchasingSnapshot }],
    };
  }

  private finalizePurchase(
    attempt: PurchaseAttemptRecord,
    authorization: PaymentOutcome,
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
  ): Mutation<PurchaseOutput> {
    const currentAttempt = this.repository.getAttemptById(attempt.id);
    const snapshot = projectCheckout(session, now);
    const order = this.repository.getOrderBySessionId(session.id);
    if (
      order ||
      !currentAttempt ||
      currentAttempt.status !== "pending" ||
      session.payment.status !== "pending" ||
      session.payment.attemptId !== attempt.id
    ) {
      const disposition =
        order || session.phase === "completed"
          ? "completed"
          : currentAttempt
            ? this.dispositionForAttempt(currentAttempt)
            : "failed";
      return {
        value: this.purchaseOutput(disposition, snapshot, false),
      };
    }

    if (authorization === "failure") {
      return this.finalizeFailure(currentAttempt, session, listing, now);
    }

    if (listing.status !== "held" || listing.heldBySessionId !== session.id) {
      throw new PurchaseNotAllowed(snapshot);
    }

    const completedAttempt: PurchaseAttemptRecord = {
      ...currentAttempt,
      status: "succeeded",
      completedAt: now.toISOString(),
    };
    const orderRecord: OrderRecord = {
      id: identifier("ord"),
      sessionId: session.id,
      listingId: listing.id,
      paymentAttemptId: currentAttempt.id,
      offerVersion: currentAttempt.offerVersion,
      totalCents: currentAttempt.totalCents,
      currency: currentAttempt.currency,
      completedAt: now.toISOString(),
      completedByDeviceId: currentAttempt.initiatedByDeviceId,
    };
    const completed: CheckoutSessionRecord = {
      ...session,
      revision: session.revision + 1,
      updatedAt: now.toISOString(),
      phase: "completed",
      payment: { status: "succeeded", attemptId: currentAttempt.id },
      order: {
        id: orderRecord.id,
        completedAt: orderRecord.completedAt,
        completedByDeviceId: orderRecord.completedByDeviceId,
      },
    };
    const soldListing: ListingRecord = {
      ...listing,
      status: "sold",
      orderId: orderRecord.id,
    };
    delete soldListing.heldBySessionId;
    this.repository.saveAttempt(completedAttempt);
    this.repository.saveOrder(orderRecord);
    this.repository.saveListing(soldListing);
    this.repository.saveSession(completed);
    this.repository.appendActivity({
      id: identifier("act"),
      at: now.toISOString(),
      sessionId: completed.id,
      revision: completed.revision,
      type: "order_completed",
      surface: currentAttempt.initiatedBySurface,
      deviceId: currentAttempt.initiatedByDeviceId,
      details: { orderId: orderRecord.id },
    });
    const completedSnapshot = projectCheckout(completed, now);

    return {
      value: this.purchaseOutput("completed", completedSnapshot, false),
      updates: [{ cause: "completed", snapshot: completedSnapshot }],
    };
  }

  private finalizeFailure(
    attempt: PurchaseAttemptRecord,
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
  ): Mutation<PurchaseOutput> {
    const failedAttempt: PurchaseAttemptRecord = {
      ...attempt,
      status: "failed",
      completedAt: now.toISOString(),
    };
    const expired =
      now.getTime() >= Date.parse(session.inventoryHold.expiresAt);
    const failedSession: CheckoutSessionRecord = {
      ...session,
      revision: session.revision + 1,
      updatedAt: now.toISOString(),
      phase: expired ? "expired" : "active",
      payment: {
        status: "failed",
        attemptId: attempt.id,
      },
    };
    this.repository.saveAttempt(failedAttempt);
    this.repository.saveSession(failedSession);
    this.repository.appendActivity({
      id: identifier("act"),
      at: now.toISOString(),
      sessionId: failedSession.id,
      revision: failedSession.revision,
      type: "purchase_failed",
      surface: attempt.initiatedBySurface,
      deviceId: attempt.initiatedByDeviceId,
      details: {},
    });
    if (expired) {
      if (listing.heldBySessionId === session.id) {
        const availableListing: ListingRecord = {
          ...listing,
          status: "available",
        };
        delete availableListing.heldBySessionId;
        this.repository.saveListing(availableListing);
      }
      this.repository.appendActivity({
        id: identifier("act"),
        at: now.toISOString(),
        sessionId: failedSession.id,
        revision: failedSession.revision,
        type: "inventory_hold_expired",
        details: {},
      });
    }
    const failedSnapshot = projectCheckout(failedSession, now);

    if (expired) {
      return {
        value: this.purchaseOutput("failed", failedSnapshot, false),
        updates: [
          { cause: "purchase_failed", snapshot: failedSnapshot },
          { cause: "expired", snapshot: failedSnapshot },
        ],
      };
    }

    return {
      value: this.purchaseOutput("failed", failedSnapshot, false),
      updates: [{ cause: "purchase_failed", snapshot: failedSnapshot }],
    };
  }

  private dispositionForAttempt(
    attempt: PurchaseAttemptRecord,
  ): PurchaseOutput["disposition"] {
    return attempt.status === "succeeded"
      ? "completed"
      : attempt.status === "pending"
        ? "pending"
        : "failed";
  }

  private purchaseOutput(
    disposition: PurchaseOutput["disposition"],
    snapshot: CheckoutSnapshot,
    duplicatePrevented: boolean,
  ): PurchaseOutput {
    return { disposition, snapshot, duplicatePrevented };
  }

  private async reconcileExpiredListing(listingId: string): Promise<void> {
    const association = this.repository.getListing(listingId);
    const sessionId = association?.heldBySessionId;
    if (!sessionId) {
      return;
    }
    const output = await this.locks.withKeys(
      [`listing:${listingId}`, `session:${sessionId}`],
      async () => {
        const listing = this.repository.getListing(listingId);
        const session = this.repository.getSession(sessionId);
        if (!listing || listing.heldBySessionId !== sessionId || !session) {
          return undefined;
        }
        return this.expireIfNeeded(session, listing, this.now());
      },
    );
    if (output) {
      this.publishUpdates([output.update]);
    }
  }

  private expireIfNeeded(
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
  ): TransitionOutput | undefined {
    if (
      session.phase !== "active" ||
      now.getTime() < Date.parse(session.inventoryHold.expiresAt)
    ) {
      return undefined;
    }

    return this.expire(session, listing, now);
  }

  private expire(
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
  ): TransitionOutput {
    const expired: CheckoutSessionRecord = {
      ...session,
      phase: "expired",
      revision: session.revision + 1,
      updatedAt: now.toISOString(),
    };
    this.repository.saveSession(expired);
    if (listing.heldBySessionId === session.id) {
      const availableListing: ListingRecord = {
        ...listing,
        status: "available",
      };
      delete availableListing.heldBySessionId;
      this.repository.saveListing(availableListing);
    }
    this.repository.appendActivity({
      id: identifier("act"),
      at: now.toISOString(),
      sessionId: expired.id,
      revision: expired.revision,
      type: "inventory_hold_expired",
      details: {},
    });
    const snapshot = projectCheckout(expired, now);
    return {
      session: expired,
      snapshot,
      update: { cause: "expired", snapshot },
    };
  }

  private abandon(
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
    actor: {
      surface: Surface;
      deviceId: string;
      reason: "navigation" | "superseded";
    },
  ): TransitionOutput {
    const abandoned: CheckoutSessionRecord = {
      ...session,
      phase: "abandoned",
      revision: session.revision + 1,
      updatedAt: now.toISOString(),
    };
    this.repository.saveSession(abandoned);
    if (listing.heldBySessionId === session.id) {
      const available: ListingRecord = { ...listing, status: "available" };
      delete available.heldBySessionId;
      this.repository.saveListing(available);
    }
    this.repository.appendActivity({
      id: identifier("act"),
      at: now.toISOString(),
      sessionId: abandoned.id,
      revision: abandoned.revision,
      type: "checkout_session_abandoned",
      surface: actor.surface,
      deviceId: actor.deviceId,
      details: { reason: actor.reason },
    });
    const snapshot = projectCheckout(abandoned, now);
    return {
      session: abandoned,
      snapshot,
      update: { cause: "abandoned", snapshot },
    };
  }

  private createRecord(
    listing: ListingRecord,
    input: CreateCheckoutSessionRequest,
    now: Date,
  ): CheckoutSessionRecord {
    return {
      id: identifier("chk"),
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      resumeToken: resumeToken(),
      initiatedBy: { surface: input.surface, deviceId: input.deviceId },
      event: DEMO_EVENT,
      listing: {
        id: listing.id,
        section: listing.section,
        row: listing.row,
        seat: listing.seat,
      },
      inventoryHold: {
        id: identifier("hold"),
        expiresAt: new Date(now.getTime() + HOLD_DURATION_MS).toISOString(),
      },
      offer: {
        currency: "USD",
        currentVersion: 1,
        currentTotalCents: listing.priceCents,
        acceptedVersion: 1,
        acceptedTotalCents: listing.priceCents,
      },
      phase: "active",
      payment: { status: "idle" },
      observedClients: [{ surface: input.surface, deviceId: input.deviceId }],
    };
  }
}
