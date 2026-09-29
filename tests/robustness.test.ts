import { describe, it, expect, vi } from "vitest";
import { Rooms } from "../server/rooms.ts";
import { Store } from "../server/store.ts";
import { applyAction, createGame } from "../shared/engine.ts";
import { deck } from "../shared/cards.ts";
import type { GameAction } from "../shared/types.ts";

describe("Invalid protocol and failed persistence", () => {
  it.each([
    null,
    { type: "unknown" },
    { type: "bid", yes: "false" },
    { type: "double", yes: 2 },
    { type: "play", cardIds: ["3S"], as: "3" },
  ])("rejects malformed action without mutating state: %j", (action) => {
    const g = createGame("malformed", "standard", deck(), 0, null);
    const before = structuredClone(g);
    expect(() => applyAction(g, 0, action as unknown as GameAction)).toThrow();
    expect(g).toEqual(before);
  });
  it.each(["play", "leave"])(
    "allows retry after persistence failure during %s",
    (type) => {
      const store = new Store(":memory:");
      try {
        const account = store.createAccount().account;
        const rooms = new Rooms(store, () => {});
        rooms.connect(account.id, "socket");
        const room = rooms.create(account, "standard", "pve");
        room.game!.phase = "playing";
        room.game!.landlord = 0;
        room.game!.turn = 0;
        room.game!.doubles = [1, 1, 1];
        room.game!.hands[0] = [room.game!.hands[0][0]];
        const before = structuredClone(room.game),
          deadline = room.deadline;
        const fail = vi.spyOn(store, "settle").mockImplementationOnce(() => {
          throw new Error("disk unavailable");
        });
        const action =
          type === "play"
            ? {
                type: "game" as const,
                action: {
                  type: "play" as const,
                  cardIds: [room.game!.hands[0][0].id],
                },
              }
            : { type: "leave" as const };
        const retry = () =>
          rooms.command(account.id, room.version, "retry-same-id", action);
        expect(retry).toThrow("disk unavailable");
        expect(room.game).toEqual(before);
        expect(room.deadline).toBe(deadline);
        expect(room.result).toBeNull();
        expect(rooms.current(account.id)).toBe(room);
        expect(store.getAccount(account.id)?.balance).toBe("100000");
        fail.mockRestore();
        retry();
        expect(room.result).not.toBeNull();
        expect(store.getAccount(account.id)?.games).toBe(1);
      } finally {
        store.close();
      }
    },
  );
});
