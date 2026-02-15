import { WebSocketServer, type WebSocket } from "ws";

type RealtimeMessage =
  | {
    type: "snapshot";
    payload: {
      connectedAt: string;
    };
  }
  | {
    type: "bidCreated";
    payload: {
      id: string;
      slotId: string;
      ownerId: string;
      amount: number;
      escrowStatus: string;
      createdAt: Date;
    };
  }
  | {
    type: "auctionClosed";
    payload: {
      slotId: string;
      status: "VOID" | "IN_PROGRESS";
      contractId?: string;
      winningBidId?: string;
      clearingPrice?: number;
    };
  };

export class RealtimeHub {
  constructor(private readonly wss: WebSocketServer) {
    this.wss.on("connection", (socket) => {
      this.sendSnapshot(socket);
    });
  }

  private sendSnapshot(socket: WebSocket) {
    const message: RealtimeMessage = {
      type: "snapshot",
      payload: {
        connectedAt: new Date().toISOString(),
      },
    };
    socket.send(JSON.stringify(message));
  }

  broadcastBidCreated(payload: {
    id: string;
    slotId: string;
    ownerId: string;
    amount: number;
    escrowStatus: string;
    createdAt: Date;
  }) {
    this.broadcast({ type: "bidCreated", payload });
  }

  broadcastAuctionClosed(payload: {
    slotId: string;
    status: "VOID" | "IN_PROGRESS";
    contractId?: string;
    winningBidId?: string;
    clearingPrice?: number;
  }) {
    this.broadcast({ type: "auctionClosed", payload });
  }

  private broadcast(message: RealtimeMessage) {
    const encoded = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === client.OPEN) {
        client.send(encoded);
      }
    }
  }
}
