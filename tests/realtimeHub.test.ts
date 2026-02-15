import { describe, expect, it, vi } from "vitest";
import { RealtimeHub } from "../src/services/realtimeHub.js";

type FakeSocket = {
  OPEN: number;
  readyState: number;
  send: ReturnType<typeof vi.fn>;
};

type ConnectionHandler = (socket: FakeSocket) => void;

function createFakeWss() {
  const clients = new Set<FakeSocket>();
  let connectionHandler: ConnectionHandler | undefined;

  const wss = {
    clients,
    on: (event: string, handler: ConnectionHandler) => {
      if (event === "connection") {
        connectionHandler = handler;
      }
      return wss;
    },
    connect: (socket: FakeSocket) => {
      if (connectionHandler) {
        connectionHandler(socket);
      }
    },
  };

  return wss;
}

function createSocket(readyState = 1): FakeSocket {
  return {
    OPEN: 1,
    readyState,
    send: vi.fn(),
  };
}

describe("RealtimeHub", () => {
  it("sends snapshot on new connection", () => {
    const wss = createFakeWss();
    const hub = new RealtimeHub(wss as never);
    const socket = createSocket();

    wss.connect(socket);

    expect(hub).toBeDefined();
    expect(socket.send).toHaveBeenCalledTimes(1);

    const message = JSON.parse(socket.send.mock.calls[0][0] as string);
    expect(message.type).toBe("snapshot");
    expect(message.payload.connectedAt).toBeTypeOf("string");
  });

  it("broadcasts bidCreated only to open clients", () => {
    const wss = createFakeWss();
    const hub = new RealtimeHub(wss as never);
    const openSocket = createSocket(1);
    const closedSocket = createSocket(3);

    wss.clients.add(openSocket);
    wss.clients.add(closedSocket);

    hub.broadcastBidCreated({
      id: "bid-1",
      slotId: "slot-1",
      ownerId: "owner-1",
      amount: 1000,
      escrowStatus: "LOCKED",
      createdAt: new Date("2026-02-15T00:00:00.000Z"),
    });

    expect(openSocket.send).toHaveBeenCalledTimes(1);
    expect(closedSocket.send).not.toHaveBeenCalled();

    const message = JSON.parse(openSocket.send.mock.calls[0][0] as string);
    expect(message.type).toBe("bidCreated");
    expect(message.payload.id).toBe("bid-1");
  });

  it("broadcasts auctionClosed event", () => {
    const wss = createFakeWss();
    const hub = new RealtimeHub(wss as never);
    const openSocket = createSocket(1);

    wss.clients.add(openSocket);

    hub.broadcastAuctionClosed({
      slotId: "slot-2",
      status: "IN_PROGRESS",
      contractId: "contract-1",
      winningBidId: "bid-2",
      clearingPrice: 900,
    });

    expect(openSocket.send).toHaveBeenCalledTimes(1);
    const message = JSON.parse(openSocket.send.mock.calls[0][0] as string);
    expect(message.type).toBe("auctionClosed");
    expect(message.payload.status).toBe("IN_PROGRESS");
    expect(message.payload.contractId).toBe("contract-1");
  });
});
