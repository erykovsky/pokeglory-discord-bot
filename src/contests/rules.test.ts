import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { duelPokemonTiers } from "./duel-pokemon-pool";
import {
  addContestXp,
  drawDuelPokemon,
  drawDuels,
  EMPTY_ACTIVITY,
  getContestEligibility,
  getContestLevel,
  getContestWeek,
  getDuelScheduleWindow,
  getDuelWinChance,
  getScheduleSlot,
  getWeeklyXp,
  normalizePokemonGuess,
  numberHint,
  PLAYER_DUEL_COOLDOWN,
} from "./rules";
import {
  acceptDuelChallenge,
  ContestStore,
  openDuelChallenge,
  settleContest,
} from "./store";

test("a duel unlocks daily draws until Monday in Warsaw, independently of other XP", () => {
  const sunday = Date.parse("2026-11-15T22:59:59Z");
  const monday = Date.parse("2026-11-15T23:00:00Z");
  const week = getContestWeek(sunday);
  const nextWeek = getContestWeek(monday);
  assert.equal(week, "2026-11-09");
  assert.equal(nextWeek, "2026-11-16");
  assert.equal(getContestLevel(160), 3);
  const legacy = { ...EMPTY_ACTIVITY, totalXp: 50, weeklyXp: 50 };
  assert.equal(getWeeklyXp(legacy, week), 0);
  const triviaWinner = addContestXp(legacy, 15, week);
  assert.ok(getContestEligibility("daily", triviaWinner, week));
  const duelist = {
    ...addContestXp(triviaWinner, 10, week),
    lastDuelWeek: week,
  };
  assert.equal(getContestEligibility("daily", duelist, week), null);
  assert.ok(getContestEligibility("daily", duelist, nextWeek));
  assert.equal(getWeeklyXp(duelist, nextWeek), 0);
  assert.equal(addContestXp(duelist, 10, nextWeek).totalXp, 85);
});

test("both sides receive 10 XP per matchup exactly once and each keeps their Pokémon", () => {
  const folder = mkdtempSync(join(tmpdir(), "pg-duel-test-"));
  try {
    const file = join(folder, "contests.json");
    const store = new ContestStore(file);
    const now = Date.parse("2026-11-16T16:00:00Z");
    const players = ["one", "two", "three"];
    store.update((state) => {
      state.contests.duels = {
        id: "duels",
        kind: "games",
        channelId: "test",
        phase: "open",
        entries: players,
        closesAt: now,
      };
      state.contests.noOpponent = {
        id: "noOpponent",
        kind: "games",
        channelId: "test",
        phase: "open",
        entries: ["alone"],
        closesAt: now,
      };
    });
    const event = settleContest(store, "duels", undefined, now);
    const rounds = event.rounds!.flat();
    assert.equal(rounds.length, 2);
    assert.deepEqual(
      Object.keys(event.duelPokemon!).sort(),
      [...players].sort()
    );
    for (const player of players) {
      const fights = rounds.filter((duel) =>
        [duel.winner, duel.eliminated].includes(player)
      ).length;
      assert.equal(store.read().activity[player].weeklyXp, 10 * fights);
      assert.equal(store.read().activity[player].totalXp, 10 * fights);
      const wins = rounds.filter((duel) => duel.winner === player).length;
      const losses = rounds.filter((duel) => duel.eliminated === player).length;
      assert.equal(store.read().activity[player].duelWins, wins);
      assert.equal(store.read().activity[player].duelLosses, losses);
      assert.equal(
        getContestEligibility(
          "daily",
          store.read().activity[player],
          getContestWeek(now)
        ),
        null
      );
    }
    const empty = settleContest(store, "noOpponent", undefined, now);
    assert.equal(empty.winner, null);
    assert.equal(store.read().activity.alone, undefined);
    const restarted = new ContestStore(file);
    assert.deepEqual(settleContest(restarted, "duels", undefined, now), event);
    assert.deepEqual(restarted.read().activity, store.read().activity);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("a player challenge awards both players once and preserves cooldown across restart", () => {
  const folder = mkdtempSync(join(tmpdir(), "pg-player-duel-"));
  try {
    const path = join(folder, "contests.json");
    const store = new ContestStore(path);
    const now = Date.parse("2026-11-15T22:40:00Z");
    assert.equal(
      openDuelChallenge(store, "self", "one", "one", now).status,
      "self"
    );
    assert.equal(
      openDuelChallenge(store, "invite", "one", "two", now).status,
      "created"
    );
    assert.equal(
      openDuelChallenge(store, "duplicate", "one", "three", now).status,
      "pending"
    );
    assert.deepEqual(store.read().activity, {});
    assert.equal(
      acceptDuelChallenge(store, "invite", "one", now).status,
      "self"
    );
    assert.equal(
      acceptDuelChallenge(store, "invite", "three", now).status,
      "reserved"
    );

    const restarted = new ContestStore(path);
    const match = acceptDuelChallenge(
      restarted,
      "invite",
      "two",
      now,
      (max) => max - 1
    );
    assert.equal(match.status, "played");
    if (match.status !== "played") return;
    assert.equal(match.winnerId, "two");
    for (const player of ["one", "two"]) {
      const activity = restarted.read().activity[player];
      assert.equal(activity.totalXp, 10);
      assert.equal(
        getContestEligibility("daily", activity, getContestWeek(now)),
        null
      );
    }
    const recovered = new ContestStore(path);
    assert.equal(recovered.read().activity.one.duelWins, 0);
    assert.equal(recovered.read().activity.one.duelLosses, 1);
    assert.equal(recovered.read().activity.two.duelWins, 1);
    assert.equal(recovered.read().activity.two.duelLosses, 0);
    assert.equal(
      acceptDuelChallenge(recovered, "invite", "two", now).status,
      "closed"
    );
    assert.deepEqual(
      openDuelChallenge(
        recovered,
        "other",
        "three",
        "two",
        now + PLAYER_DUEL_COOLDOWN - 1
      ),
      {
        status: "cooldown",
        playerId: "two",
        availableAt: now + PLAYER_DUEL_COOLDOWN,
      }
    );
    assert.equal(
      openDuelChallenge(recovered, "open", "three", undefined, now).status,
      "created"
    );
    assert.equal(
      acceptDuelChallenge(recovered, "open", "two", now).status,
      "cooldown"
    );
    assert.equal(
      acceptDuelChallenge(recovered, "open", "four", now, () => 0).status,
      "played"
    );

    const next = now + PLAYER_DUEL_COOLDOWN;
    assert.equal(
      openDuelChallenge(recovered, "next", "one", "two", next).status,
      "created"
    );
    assert.equal(
      acceptDuelChallenge(recovered, "next", "two", next, () => 0).status,
      "played"
    );
    assert.equal(recovered.read().activity.one.totalXp, 20);
    assert.equal(recovered.read().activity.one.weeklyXp, 10);
    assert.equal(recovered.read().activity.one.duelWins, 1);
    assert.equal(recovered.read().activity.one.duelLosses, 1);
    assert.equal(
      getContestEligibility(
        "daily",
        recovered.read().activity.one,
        getContestWeek(next)
      ),
      null
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
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

test("the duel pool has distinct Kanto species and Orange Islands entries", () => {
  const pokemon = duelPokemonTiers.flatMap((tier) => [...tier.species]);
  assert.equal(pokemon.length, 224);
  const unique = new Set<string>(pokemon);
  assert.equal(unique.size, pokemon.length);
  for (const name of [
    "Nidoran♀",
    "Farfetch’d",
    "Mew",
    "Marill",
    "Pinkan Nidoran♂",
    "Crystal Steelix",
    "Valencian Victreebel",
  ]) {
    assert.ok(unique.has(name), name);
  }
});

test("rarity tiers are drawn at the intended rates", () => {
  const totals: Record<string, number> = {};
  for (let ticket = 0; ticket < 1000; ticket++) {
    const pokemon = drawDuelPokemon((limit) => (limit === 1000 ? ticket : 0));
    totals[pokemon.rarity] = (totals[pokemon.rarity] ?? 0) + 1;
  }
  assert.deepEqual(totals, {
    Common: 620,
    Uncommon: 230,
    Rare: 90,
    "Ultra Rare": 40,
    Epic: 14,
    Legendary: 5,
    Mythical: 1,
  });
});

test("rarer Pokémon have an advantage and the underdog can still win", () => {
  const common = drawDuelPokemon(() => 0);
  const rare = drawDuelPokemon((limit) => (limit === 1000 ? 850 : 0));
  const mythical = drawDuelPokemon((limit) => (limit === 1000 ? 999 : 0));
  assert.equal(getDuelWinChance(common, common), 50);
  assert.equal(getDuelWinChance(rare, common), 60);
  assert.equal(getDuelWinChance(mythical, common), 75);
  assert.equal(getDuelWinChance(common, mythical), 25);

  const match = (result: number) => {
    const rolls = [0, 0, 850, 0, 1, result];
    const duel = drawDuels(["one", "two"], () => rolls.shift()!);
    assert.deepEqual(duel.pokemon, { one: common, two: rare });
    assert.equal(rolls.length, 0);
    return duel.rounds[0][0];
  };
  assert.deepEqual(match(39), {
    winner: "one",
    eliminated: "two",
    winnerWinChance: 40,
  });
  assert.deepEqual(match(40), {
    winner: "two",
    eliminated: "one",
    winnerWinChance: 60,
  });
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

test("eight duel windows have independent plan keys and non-overlapping start times", () => {
  const windowStarts = [7, 8, 10, 12, 14, 16, 18, 20];
  const windows = windowStarts.map((hour) => getDuelScheduleWindow(hour * 60)!);
  assert.deepEqual(
    windows.map((window) => window.key),
    [
      "games:early-morning",
      "games:late-morning",
      "games:morning",
      "games:midday",
      "games:early-afternoon",
      "games:afternoon",
      "games:early-evening",
      "games",
    ]
  );
  for (const [index, window] of windows.entries()) {
    assert.equal(window.firstMinute, windowStarts[index] * 60);
    assert.equal(getDuelScheduleWindow(window.lastMinute), window);
    if (index < windows.length - 1)
      assert.equal(window.lastMinute + 1, windows[index + 1].firstMinute);
  }
  assert.equal(windows[7].lastMinute, 21 * 60);
  assert.equal(getDuelScheduleWindow(7 * 60 - 1), undefined);
  assert.equal(getDuelScheduleWindow(22 * 60), undefined);
});
