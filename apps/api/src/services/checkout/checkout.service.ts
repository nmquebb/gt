import { randomUUID } from "node:crypto";
import { Result, type Result as ResultType } from "better-result";
import type {
  AcceptOfferRequest,
  ActivityEntry,
  CheckoutSessionUpdatedCause,
  CheckoutSnapshot,
  CreateCheckoutSessionRequest,
  ListingsResponse,
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
import type {
  DelayedPaymentSimulator,
  PaymentAuthorization,
} from "../../providers/payment-simulator";
import type { RealtimeHub } from "../../providers/realtime-hub";
import {
  CheckoutSessionExpired,
  CheckoutSessionNotFound,
  InvalidPriceAdjustment,
  InvalidResumeToken,
  ListingUnavailable,
  OfferVersionMismatch,
  PurchaseNotAllowed,
  type CheckoutError,
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

export interface RepriceInput extends SessionIdInput {
  increaseCents: number;
}

export interface PurchaseInput
  extends AuthenticatedSessionInput, PurchaseRequest {
  idempotencyKey: string;
}

export type PurchaseOutput = PurchaseResponse;

interface LockedOperationOutput<T> {
  result: ResultType<T, CheckoutError>;
  event?: {
    cause: CheckoutSessionUpdatedCause;
    snapshot: CheckoutSnapshot;
  };
  events?: readonly {
    cause: CheckoutSessionUpdatedCause;
    snapshot: CheckoutSnapshot;
  }[];
  attempt?: PurchaseAttemptRecord;
}

interface SessionOperationInput {
  session: CheckoutSessionRecord;
  listing: ListingRecord;
  now: Date;
}

interface TransitionOutput {
  session: CheckoutSessionRecord;
  snapshot: CheckoutSnapshot;
  event: {
    cause: CheckoutSessionUpdatedCause;
    snapshot: CheckoutSnapshot;
  };
}

export class CheckoutService {
  constructor(
    private readonly repository: CheckoutMemoryRepository,
    private readonly locks: InMemoryKeyedLock,
    private readonly payment: DelayedPaymentSimulator,
    private readonly realtime: RealtimeHub,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listListings(): Promise<ResultType<ListingsResponse, CheckoutError>> {
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

    return Result.ok({ event: DEMO_EVENT, listings });
  }

  async createSession(
    input: CreateCheckoutSessionRequest,
  ): Promise<ResultType<CreatedCheckout, CheckoutError>> {
    await this.reconcileExpiredListing(input.listingId);

    return this.locks.withKeys(
      [`checkout-owner:${input.deviceId}`],
      async () => {
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

        const output = await this.locks.withKeys(
          lockKeys,
          async (): Promise<LockedOperationOutput<CreatedCheckout>> => {
            const now = this.now();
            const prior =
              this.repository.getNonterminalSessionByInitiatingDevice(
                input.deviceId,
              );

            if (prior?.phase === "purchasing") {
              return {
                result: Result.err(
                  new PurchaseNotAllowed({
                    snapshot: projectCheckout(prior, now),
                  }),
                ),
              };
            }

            const priorListing = prior
              ? this.repository.getListing(prior.listing.id)
              : undefined;
            const expired =
              prior && priorListing
                ? this.expireIfNeeded(prior, priorListing, now)
                : undefined;
            const currentPrior = expired === undefined ? prior : undefined;
            const currentListing = this.repository.getListing(input.listingId);
            if (
              !currentListing ||
              (currentListing.status !== "available" &&
                currentListing.heldBySessionId !== currentPrior?.id)
            ) {
              return {
                result: Result.err(
                  new ListingUnavailable({ listingId: input.listingId }),
                ),
                ...(expired ? { event: expired.event } : {}),
              };
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
            if (!availableListing || availableListing.status !== "available") {
              return {
                result: Result.err(
                  new ListingUnavailable({ listingId: input.listingId }),
                ),
                ...(expired ? { event: expired.event } : {}),
              };
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
              result: Result.ok({
                snapshot: projectCheckout(session, now),
                resumeToken: session.resumeToken,
              }),
              ...(superseded
                ? { event: superseded.event }
                : expired
                  ? { event: expired.event }
                  : {}),
            };
          },
        );
        this.publishOutput(output);

        return output.result;
      },
    );
  }

  async getSession(
    input: AuthenticatedSessionInput,
  ): Promise<ResultType<CheckoutSnapshot, CheckoutError>> {
    const output = await this.withSessionAndListing(
      input.sessionId,
      ({ session, listing, now }) => {
        const authenticationError = this.authenticate(
          session.id,
          input.resumeToken,
        );
        if (authenticationError) {
          return { result: Result.err(authenticationError) };
        }

        const expired = this.expireIfNeeded(session, listing, now);
        return {
          result: Result.ok(projectCheckout(expired?.session ?? session, now)),
          ...(expired ? { event: expired.event } : {}),
        };
      },
    );

    return output?.result ?? Result.err(this.notFound(input.sessionId));
  }

  async resume(
    input: CheckoutClientInput,
  ): Promise<ResultType<CheckoutSnapshot, CheckoutError>> {
    const output = await this.withSessionAndListing(
      input.sessionId,
      ({ session, listing, now }) => {
        const authenticationError = this.authenticate(
          session.id,
          input.resumeToken,
        );
        if (authenticationError) {
          return { result: Result.err(authenticationError) };
        }

        const expired = this.expireIfNeeded(session, listing, now);
        const current = expired?.session ?? session;

        const knownClient = current.observedClients.some(
          (client) =>
            client.surface === input.surface &&
            client.deviceId === input.deviceId,
        );
        if (knownClient) {
          return {
            result: Result.ok(projectCheckout(current, now)),
            ...(expired ? { event: expired.event } : {}),
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
          result: Result.ok(projectCheckout(resumed, now)),
          ...(expired ? { event: expired.event } : {}),
        };
      },
    );

    return output?.result ?? Result.err(this.notFound(input.sessionId));
  }

  async leave(
    input: CheckoutClientInput,
  ): Promise<ResultType<CheckoutSnapshot, CheckoutError>> {
    const output = await this.withSessionAndListing(
      input.sessionId,
      ({ session, listing, now }) => {
        const authenticationError = this.authenticate(
          session.id,
          input.resumeToken,
        );
        if (authenticationError) {
          return { result: Result.err(authenticationError) };
        }

        const expired = this.expireIfNeeded(session, listing, now);
        if (expired) {
          return {
            result: Result.ok(expired.snapshot),
            event: expired.event,
          };
        }
        if (
          session.phase !== "active" ||
          this.realtime.connectionCount(session.id) > 1
        ) {
          return { result: Result.ok(projectCheckout(session, now)) };
        }

        const abandoned = this.abandon(session, listing, now, {
          surface: input.surface,
          deviceId: input.deviceId,
          reason: "navigation",
        });
        return {
          result: Result.ok(abandoned.snapshot),
          event: abandoned.event,
        };
      },
    );

    return output?.result ?? Result.err(this.notFound(input.sessionId));
  }

  async acceptOffer(
    input: AcceptOfferInput,
  ): Promise<ResultType<CheckoutSnapshot, CheckoutError>> {
    const output = await this.withSessionAndListing(
      input.sessionId,
      ({ session, listing, now }) => {
        const authenticationError = this.authenticate(
          session.id,
          input.resumeToken,
        );
        if (authenticationError) {
          return { result: Result.err(authenticationError) };
        }

        const expired = this.expireIfNeeded(session, listing, now);
        if (expired || session.phase === "expired") {
          return {
            result: Result.err(
              new CheckoutSessionExpired({
                snapshot: expired?.snapshot ?? projectCheckout(session, now),
              }),
            ),
            ...(expired ? { event: expired.event } : {}),
          };
        }

        const currentSnapshot = projectCheckout(session, now);
        if (session.phase !== "active") {
          return {
            result: Result.err(
              new PurchaseNotAllowed({ snapshot: currentSnapshot }),
            ),
          };
        }
        if (input.offerVersion !== session.offer.currentVersion) {
          return {
            result: Result.err(
              new OfferVersionMismatch({ snapshot: currentSnapshot }),
            ),
          };
        }
        if (session.offer.acceptedVersion === session.offer.currentVersion) {
          return { result: Result.ok(currentSnapshot) };
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
          result: Result.ok(snapshot),
          event: { cause: "offer_accepted", snapshot },
        };
      },
    );

    return output?.result ?? Result.err(this.notFound(input.sessionId));
  }

  async reprice(
    input: RepriceInput,
  ): Promise<ResultType<CheckoutSnapshot, CheckoutError>> {
    const output = await this.withSessionAndListing(
      input.sessionId,
      ({ session, listing, now }) => {
        const expired = this.expireIfNeeded(session, listing, now);
        if (expired || session.phase === "expired") {
          return {
            result: Result.err(
              new CheckoutSessionExpired({
                snapshot: expired?.snapshot ?? projectCheckout(session, now),
              }),
            ),
            ...(expired ? { event: expired.event } : {}),
          };
        }

        const currentSnapshot = projectCheckout(session, now);
        if (session.phase !== "active") {
          return {
            result: Result.err(
              new PurchaseNotAllowed({ snapshot: currentSnapshot }),
            ),
          };
        }

        const nextVersion = session.offer.currentVersion + 1;
        const nextTotal = session.offer.currentTotalCents + input.increaseCents;
        if (
          !Number.isSafeInteger(input.increaseCents) ||
          !Number.isSafeInteger(nextVersion) ||
          !Number.isSafeInteger(nextTotal)
        ) {
          return { result: Result.err(new InvalidPriceAdjustment({})) };
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
          result: Result.ok(snapshot),
          event: { cause: "repriced", snapshot },
        };
      },
    );

    return output?.result ?? Result.err(this.notFound(input.sessionId));
  }

  async forceExpire(
    input: AuthenticatedSessionInput,
  ): Promise<ResultType<CheckoutSnapshot, CheckoutError>> {
    const output = await this.withSessionAndListing(
      input.sessionId,
      ({ session, listing, now }) => {
        const authenticationError = this.authenticate(
          session.id,
          input.resumeToken,
        );
        if (authenticationError) {
          return { result: Result.err(authenticationError) };
        }
        if (session.phase !== "active") {
          return { result: Result.ok(projectCheckout(session, now)) };
        }

        const expired = this.expire(session, listing, now);
        return { result: Result.ok(expired.snapshot), event: expired.event };
      },
    );

    return output?.result ?? Result.err(this.notFound(input.sessionId));
  }

  async purchase(
    input: PurchaseInput,
  ): Promise<ResultType<PurchaseOutput, CheckoutError>> {
    const started = await this.withSessionAndListing(
      input.sessionId,
      ({ session, listing, now }) =>
        this.startPurchase(input, session, listing, now),
    );
    if (!started) {
      return Result.err(this.notFound(input.sessionId));
    }
    if (!started.attempt) {
      return started.result;
    }

    const authorization = await this.payment.authorize({
      sessionId: input.sessionId,
      attemptId: started.attempt.id,
      amountCents: started.attempt.totalCents,
      currency: started.attempt.currency,
    });
    const finalized = await this.withSessionAndListing(
      input.sessionId,
      ({ session, listing, now }) =>
        this.finalizePurchase(
          started.attempt as PurchaseAttemptRecord,
          authorization,
          session,
          listing,
          now,
        ),
    );

    return finalized?.result ?? Result.err(this.notFound(input.sessionId));
  }

  async recordAppHandoff(
    input: AuthenticatedSessionInput,
  ): Promise<ResultType<void, CheckoutError>> {
    const output = await this.withSessionAndListing(
      input.sessionId,
      ({ session, now }) => {
        const authenticationError = this.authenticate(
          session.id,
          input.resumeToken,
        );
        if (authenticationError) {
          return { result: Result.err(authenticationError) };
        }
        this.repository.appendActivity({
          id: identifier("act"),
          at: now.toISOString(),
          sessionId: session.id,
          revision: session.revision,
          type: "app_handoff_opened",
          details: {},
        });
        return { result: Result.ok(undefined) };
      },
    );

    return output?.result ?? Result.err(this.notFound(input.sessionId));
  }

  async listActivity(
    input: AuthenticatedSessionInput,
  ): Promise<ResultType<readonly ActivityEntry[], CheckoutError>> {
    const authentication = this.repository.getSession(input.sessionId);
    if (!authentication) {
      return Result.err(this.notFound(input.sessionId));
    }
    const authenticationError = this.authenticate(
      authentication.id,
      input.resumeToken,
    );
    if (authenticationError) {
      return Result.err(authenticationError);
    }

    return Result.ok(this.repository.listActivity(input.sessionId));
  }

  private authenticate(
    sessionId: string,
    token: string,
  ): CheckoutSessionNotFound | InvalidResumeToken | undefined {
    const session = this.repository.getSession(sessionId);
    if (!session) {
      return this.notFound(sessionId);
    }

    return session.resumeToken === token
      ? undefined
      : new InvalidResumeToken({});
  }

  private publish(
    cause: CheckoutSessionUpdatedCause,
    snapshot: CheckoutSnapshot,
  ): void {
    this.realtime.publish({
      type: "checkout_session_updated",
      cause,
      snapshot,
    });
  }

  private publishOutput<T>(output: LockedOperationOutput<T>): void {
    if (output.event) {
      this.publish(output.event.cause, output.event.snapshot);
    }
    for (const event of output.events ?? []) {
      this.publish(event.cause, event.snapshot);
    }
  }

  private async withSessionAndListing<T>(
    sessionId: string,
    operation: (input: SessionOperationInput) => LockedOperationOutput<T>,
  ): Promise<LockedOperationOutput<T> | undefined> {
    const association = this.repository.getSession(sessionId);
    if (!association) {
      return undefined;
    }
    const output = await this.locks.withKeys(
      [`listing:${association.listing.id}`, `session:${sessionId}`],
      async () => {
        const session = this.repository.getSession(sessionId);
        const listing = this.repository.getListing(association.listing.id);
        if (!session || !listing) {
          return undefined;
        }
        return operation({ session, listing, now: this.now() });
      },
    );
    if (output) {
      this.publishOutput(output);
    }

    return output;
  }

  private startPurchase(
    input: PurchaseInput,
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
  ): LockedOperationOutput<PurchaseOutput> {
    const authenticationError = this.authenticate(
      session.id,
      input.resumeToken,
    );
    if (authenticationError) {
      return { result: Result.err(authenticationError) };
    }

    const expired = this.expireIfNeeded(session, listing, now);
    const snapshot = expired?.snapshot ?? projectCheckout(session, now);
    const replay = this.repository.getAttemptByIdempotencyKey(
      session.id,
      input.idempotencyKey,
    );
    if (replay) {
      return {
        result: Result.ok(
          this.purchaseOutput(
            this.dispositionForAttempt(replay),
            snapshot,
            false,
          ),
        ),
        ...(expired ? { event: expired.event } : {}),
      };
    }

    if (expired || session.phase === "expired") {
      return {
        result: Result.err(new CheckoutSessionExpired({ snapshot })),
        ...(expired ? { event: expired.event } : {}),
      };
    }

    const order = this.repository.getOrderBySessionId(session.id);
    if (order || session.phase === "completed") {
      return {
        result: Result.ok(this.purchaseOutput("completed", snapshot, false)),
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
        result: Result.ok(this.purchaseOutput("pending", snapshot, true)),
      };
    }

    if (
      session.phase !== "active" ||
      listing.status !== "held" ||
      listing.heldBySessionId !== session.id ||
      session.offer.currentVersion !== session.offer.acceptedVersion ||
      session.offer.currentTotalCents !== session.offer.acceptedTotalCents
    ) {
      return {
        result: Result.err(new PurchaseNotAllowed({ snapshot })),
      };
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
      result: Result.ok(
        this.purchaseOutput("pending", purchasingSnapshot, false),
      ),
      event: { cause: "purchase_started", snapshot: purchasingSnapshot },
      attempt,
    };
  }

  private finalizePurchase(
    attempt: PurchaseAttemptRecord,
    authorization: PaymentAuthorization,
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
  ): LockedOperationOutput<PurchaseOutput> {
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
        result: Result.ok(this.purchaseOutput(disposition, snapshot, false)),
      };
    }

    if (Result.isError(authorization)) {
      return this.finalizeFailure(currentAttempt, session, listing, now);
    }

    if (listing.status !== "held" || listing.heldBySessionId !== session.id) {
      return { result: Result.err(new PurchaseNotAllowed({ snapshot })) };
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
      result: Result.ok(
        this.purchaseOutput("completed", completedSnapshot, false),
      ),
      event: { cause: "completed", snapshot: completedSnapshot },
    };
  }

  private finalizeFailure(
    attempt: PurchaseAttemptRecord,
    session: CheckoutSessionRecord,
    listing: ListingRecord,
    now: Date,
  ): LockedOperationOutput<PurchaseOutput> {
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
        result: Result.ok(this.purchaseOutput("failed", failedSnapshot, false)),
        events: [
          { cause: "purchase_failed", snapshot: failedSnapshot },
          { cause: "expired", snapshot: failedSnapshot },
        ],
      };
    }

    return {
      result: Result.ok(this.purchaseOutput("failed", failedSnapshot, false)),
      event: { cause: "purchase_failed", snapshot: failedSnapshot },
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
      this.publish(output.event.cause, output.event.snapshot);
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
      event: { cause: "expired", snapshot },
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
      event: { cause: "abandoned", snapshot },
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

  private notFound(sessionId: string): CheckoutSessionNotFound {
    return new CheckoutSessionNotFound({ sessionId });
  }
}
