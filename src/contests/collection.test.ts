import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  acceptCardTrade,
  cardByName,
  CARD_DROP_MS,
  CARD_PRIORITY_MS,
  CARD_ROLL_WINDOW_MS,
  claimCard,
  findCard,
  getCollectionLimits,
  proposeCardTrade,
  rollCard,
} from "./collection";
import { ContestStore, playPlayerDuel, setContestParticipation } from "./store";

function withStore(run: (store: ContestStore, path: string) => void) {
  const folder = mkdtempSync(join(tmpdir(), "pg-card-test-"));
  try {
    const path = join(folder, "contests.json");
    run(new ContestStore(path), path);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

test("the 224 cards reuse valid PokeGlory image paths", () => {
  assert.equal(cardByName.size, 224);
  assert.ok(
    [...cardByName.values()].every((card) =>
      card.imagePath.startsWith("/img/pokemons/")
    )
  );
  assert.equal(findCard("Crystal onix")?.rarity, "Epic");
});

test("card limits persist after restart and reset independently", () =>
  withStore((store, path) => {
    const now = 1_000_000;
    for (const id of ["1", "2", "3"])
      assert.equal(
        rollCard(store, id, "room", "a", now, () => 0).status,
        "rolled"
      );
    assert.equal(
      rollCard(store, "4", "room", "a", now, () => 0).status,
      "limit"
    );
    assert.equal(
      claimCard(store, "1", "b", now + CARD_PRIORITY_MS - 1).status,
      "priority"
    );
    assert.equal(
      claimCard(store, "1", "b", now + CARD_PRIORITY_MS).status,
      "caught"
    );
    assert.equal(
      claimCard(store, "1", "a", now + CARD_PRIORITY_MS).status,
      "claimed"
    );
    const restarted = new ContestStore(path);
    const nextClaimAt = now + CARD_PRIORITY_MS + 60 * 60_000;
    assert.deepEqual(
      claimCard(restarted, "2", "b", now + CARD_PRIORITY_MS),
      { status: "limit", availableAt: nextClaimAt }
    );
    assert.equal(
      getCollectionLimits(restarted, "b", nextClaimAt - 1).nextClaimAt,
      nextClaimAt
    );
    assert.equal(
      rollCard(restarted, "fresh", "room", "b", nextClaimAt - 1, () => 0)
        .status,
      "rolled"
    );
    assert.equal(
      claimCard(restarted, "fresh", "b", nextClaimAt - 1).status,
      "limit"
    );
    assert.equal(
      claimCard(restarted, "fresh", "b", nextClaimAt).status,
      "caught"
    );
    assert.equal(
      rollCard(restarted, "4", "room", "a", nextClaimAt, () => 0).status,
      "limit"
    );
    assert.equal(
      claimCard(restarted, "2", "a", now + CARD_DROP_MS).status,
      "closed"
    );
    assert.equal(
      rollCard(restarted, "4", "room", "a", now + CARD_ROLL_WINDOW_MS, () => 0)
        .status,
      "rolled"
    );
    assert.equal(restarted.read().collection?.players.b.cards.Bulbasaur, 2);
  }));

test("only the named trade partner can atomically swap a pair of cards once", () =>
  withStore((store) => {
    const now = 1_000_000;
    rollCard(store, "r1", "room", "a", now, () => 0);
    rollCard(store, "r2", "room", "b", now, (max) => max - 1);
    claimCard(store, "r1", "a", now);
    claimCard(store, "r2", "b", now);
    assert.equal(
      proposeCardTrade(
        store,
        {
          id: "swap",
          channelId: "room",
          from: "a",
          to: "b",
          offer: "Bulbasaur",
          request: "Mew",
        },
        now
      ).status,
      "created"
    );
    assert.equal(acceptCardTrade(store, "swap", "c", now).status, "restricted");
    assert.equal(acceptCardTrade(store, "swap", "b", now).status, "traded");
    assert.equal(acceptCardTrade(store, "swap", "b", now).status, "closed");
    assert.deepEqual(store.read().collection?.players.a.cards, { Mew: 1 });
    assert.deepEqual(store.read().collection?.players.b.cards, {
      Bulbasaur: 1,
    });
    setContestParticipation(store, "a", true);
    setContestParticipation(store, "b", true);
    const duel = playPlayerDuel(store, "a", "b", now, () => 0);
    assert.equal(duel.status, "played");
    if (duel.status === "played") {
      assert.equal(duel.challengerPokemon.name, "Mew");
      assert.equal(duel.opponentPokemon.name, "Bulbasaur");
    }
  }));
