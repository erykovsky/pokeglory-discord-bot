import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  creditMessage,
  drawDuels,
  EMPTY_ACTIVITY,
  getContestEligibility,
  getContestLevel,
  getScheduleSlot,
  normalizePokemonGuess,
  numberHint,
} from "./rules";
import { ContestStore, settleContest } from "./store";

test("chat XP counts once a minute and ignores short or repeated messages", () => {
  const activity = creditMessage(
    EMPTY_ACTIVITY,
    "Prawidłowa wiadomość",
    90_000
  );
  assert.equal(activity.totalXp, 5);
  assert.equal(activity.weeklyXp, 5);
  assert.equal(
    creditMessage(activity, "Nowa wiadomość użytkownika", 149_999),
    activity
  );
  assert.equal(
    creditMessage(activity, "PRAWIDŁOWA  wiadomość ", 150_000),
    activity
  );
  assert.equal(creditMessage(activity, "hej", 150_000), activity);
  assert.equal(
    creditMessage(activity, "Nowa wiadomość użytkownika", 150_000).totalXp,
    10
  );
  assert.equal(getContestLevel(160), 3);
  assert.ok(getContestEligibility("weekly", { ...activity, totalXp: 200 }));
  assert.equal(
    getContestEligibility("weekly", {
      ...activity,
      totalXp: 200,
      weeklyXp: 60,
    }),
    null
  );
});

test("a saved weekly draw resets weekly XP once and preserves the winner through restart", () => {
  const folder = mkdtempSync(join(tmpdir(), "pg-contest-test-"));
  try {
    const filepath = join(folder, "contests.json");
    const store = new ContestStore(filepath);
    store.update((state) => {
      state.activity["winner"] = {
        ...EMPTY_ACTIVITY,
        totalXp: 250,
        weeklyXp: 60,
      };
      state.contests.week = {
        id: "week",
        kind: "weekly",
        channelId: "test",
        phase: "open",
        entries: ["winner"],
        closesAt: 0,
      };
    });
    assert.equal(settleContest(store, "week").winner, "winner");
    const restarted = new ContestStore(filepath);
    assert.equal(restarted.read().activity.winner.weeklyXp, 0);
    assert.equal(restarted.read().activity.winner.totalXp, 250);
    restarted.update((state) => {
      state.activity.winner.weeklyXp = 5;
    });
    assert.equal(settleContest(restarted, "week").winner, "winner");
    assert.equal(restarted.read().activity.winner.weeklyXp, 5);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("duels eliminate every entrant except the winner, including odd groups", () => {
  const entries = ["one", "two", "three", "four", "five"];
  const { winner, rounds } = drawDuels(entries, () => 0);
  const eliminated = rounds.flat().map((duel) => duel.eliminated);
  assert.equal(eliminated.length, entries.length - 1);
  assert.deepEqual(new Set([...eliminated, winner]), new Set(entries));
});

test("guess normalization, hint boundaries and Warsaw schedule", () => {
  assert.equal(normalizePokemonGuess("  FARFETCH’D  "), "farfetchd");
  assert.deepEqual(numberHint(500, 1000), [1, 500]);
  assert.deepEqual(numberHint(501, 1000), [501, 1000]);
  const now = Date.parse("2026-10-31T23:30:00Z");
  assert.equal(getScheduleSlot("weekly", now)?.key, "2026-11-01");
  assert.equal(getScheduleSlot("monthly", now), null);
});
