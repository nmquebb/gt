import {
  CheckoutSessionUpdatedEventSchema,
  type CheckoutSessionUpdatedEvent,
} from "@checkout/sdk/contracts";

export interface RealtimeSocket {
  send(data: string): void;
}

export class RealtimeHub {
  private readonly socketsBySessionId = new Map<string, Set<RealtimeSocket>>();

  private remove(sessionId: string, socket: RealtimeSocket): void {
    const sockets = this.socketsBySessionId.get(sessionId);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.socketsBySessionId.delete(sessionId);
    }
  }

  private sendSerialized(
    socket: RealtimeSocket,
    serialized: string,
    sessionId: string,
  ): boolean {
    try {
      socket.send(serialized);
      return true;
    } catch {
      this.remove(sessionId, socket);
      return false;
    }
  }

  register(sessionId: string, socket: RealtimeSocket): () => void {
    const sockets = this.socketsBySessionId.get(sessionId) ?? new Set();
    sockets.add(socket);
    this.socketsBySessionId.set(sessionId, sockets);

    return () => {
      this.remove(sessionId, socket);
    };
  }

  send(socket: RealtimeSocket, event: CheckoutSessionUpdatedEvent): boolean {
    const parsed = CheckoutSessionUpdatedEventSchema.safeParse(event);
    if (!parsed.success) {
      return false;
    }

    return this.sendSerialized(
      socket,
      JSON.stringify(parsed.data),
      parsed.data.snapshot.session.id,
    );
  }

  publish(event: CheckoutSessionUpdatedEvent): boolean {
    const parsed = CheckoutSessionUpdatedEventSchema.safeParse(event);
    if (!parsed.success) {
      return false;
    }

    const sockets = this.socketsBySessionId.get(
      parsed.data.snapshot.session.id,
    );
    if (!sockets) {
      return true;
    }

    const serialized = JSON.stringify(parsed.data);
    for (const socket of [...sockets]) {
      this.sendSerialized(socket, serialized, parsed.data.snapshot.session.id);
    }
    return true;
  }

  connectionCount(sessionId: string): number {
    return this.socketsBySessionId.get(sessionId)?.size ?? 0;
  }
}
