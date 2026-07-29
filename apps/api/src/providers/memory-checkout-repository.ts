import type {
  ActivityEntry,
  CheckoutSnapshot,
  ListingsResponse,
  Surface,
} from "@checkout/sdk/contracts";

type SnapshotSession = CheckoutSnapshot["session"];

export type ListingRecord = ListingsResponse["listings"][number] & {
  heldBySessionId?: string;
  orderId?: string;
};

export type CheckoutSessionRecord = SnapshotSession & {
  resumeToken: string;
  initiatedBy: { surface: Surface; deviceId: string };
  inventoryHold: SnapshotSession["inventoryHold"] & { id: string };
  payment: SnapshotSession["payment"] & { attemptId?: string };
  observedClients: Array<{ surface: Surface; deviceId: string }>;
};

export interface PurchaseAttemptRecord {
  id: string;
  sessionId: string;
  idempotencyKey: string;
  offerVersion: number;
  totalCents: number;
  currency: "USD";
  initiatedBySurface: "web" | "mobile";
  initiatedByDeviceId: string;
  status: "pending" | "failed" | "succeeded";
  createdAt: string;
  completedAt?: string;
}

export interface OrderRecord {
  id: string;
  sessionId: string;
  listingId: string;
  paymentAttemptId: string;
  offerVersion: number;
  totalCents: number;
  currency: "USD";
  completedAt: string;
  completedByDeviceId: string;
}

export class CheckoutMemoryRepository {
  private readonly listings = new Map<string, ListingRecord>();
  private readonly sessions = new Map<string, CheckoutSessionRecord>();
  private readonly attempts: PurchaseAttemptRecord[] = [];
  private readonly orders: OrderRecord[] = [];
  private readonly activity: ActivityEntry[] = [];

  constructor(listings: readonly ListingRecord[]) {
    for (const listing of listings) {
      this.saveListing(listing);
    }
  }

  listListings(): readonly ListingRecord[] {
    return [...this.listings.values()];
  }

  getListing(id: string): ListingRecord | undefined {
    return this.listings.get(id);
  }

  saveListing(listing: ListingRecord): void {
    this.listings.set(listing.id, listing);
  }

  getSession(id: string): CheckoutSessionRecord | undefined {
    return this.sessions.get(id);
  }

  getNonterminalSessionByInitiatingDevice(
    deviceId: string,
  ): CheckoutSessionRecord | undefined {
    return [...this.sessions.values()]
      .filter(
        (candidate) =>
          candidate.initiatedBy.deviceId === deviceId &&
          (candidate.phase === "active" || candidate.phase === "purchasing"),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  }

  saveSession(session: CheckoutSessionRecord): void {
    this.sessions.set(session.id, session);
  }

  getAttemptById(id: string): PurchaseAttemptRecord | undefined {
    return this.attempts.find((attempt) => attempt.id === id);
  }

  getAttemptByIdempotencyKey(
    sessionId: string,
    idempotencyKey: string,
  ): PurchaseAttemptRecord | undefined {
    return this.attempts.find(
      (attempt) =>
        attempt.sessionId === sessionId &&
        attempt.idempotencyKey === idempotencyKey,
    );
  }

  saveAttempt(attempt: PurchaseAttemptRecord): void {
    const index = this.attempts.findIndex(
      (candidate) => candidate.id === attempt.id,
    );
    if (index === -1) {
      this.attempts.push(attempt);
    } else {
      this.attempts[index] = attempt;
    }
  }

  listAttempts(sessionId: string): readonly PurchaseAttemptRecord[] {
    return this.attempts.filter((attempt) => attempt.sessionId === sessionId);
  }

  getOrderBySessionId(sessionId: string): OrderRecord | undefined {
    return this.orders.find((order) => order.sessionId === sessionId);
  }

  listOrders(sessionId: string): readonly OrderRecord[] {
    return this.orders.filter((order) => order.sessionId === sessionId);
  }

  saveOrder(order: OrderRecord): void {
    const index = this.orders.findIndex(
      (candidate) => candidate.id === order.id,
    );
    if (index === -1) {
      this.orders.push(order);
    } else {
      this.orders[index] = order;
    }
  }

  appendActivity(entry: ActivityEntry): void {
    this.activity.push(entry);
  }

  listActivity(sessionId: string): readonly ActivityEntry[] {
    return this.activity.filter((entry) => entry.sessionId === sessionId);
  }
}
