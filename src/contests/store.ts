import { randomInt } from "node:crypto";
import {
  addContestXp,
  drawDuels,
  EMPTY_ACTIVITY,
  getContestWeek,
  getDuelWinChance,
  POKEMON_XP,
  recordDuelResult,
  PLAYER_DUEL_COOLDOWN,
} from "./rules";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { type CollectionState, getOwnedCards } from "./collection";
import type {
  Activity,
  ContestKind,
  ScheduledContest,
  DuelMatch,
  DuelPokemon,
} from "./rules";

export type Reward =
  | { currency: "yen" | "pz"; amount: number }
  | {
      currency: "bundle";
      name: string;
      items: Array<{ name: string; quantity: number }>;
    };

export type Contest = {
  id: string;
  kind: ContestKind;
  channelId: string;
  phase: "draft" | "open" | "closed";
  closesAt: number;
  entries: string[];
  messageId?: string;
  reward?: Reward;
  number?: {
    target: number;
    max: number;
    hintsAt: number;
    guesses: Record<string, number>;
  };
  pokemon?: { name: string; imageUrl: string };
  winner?: string | null;
  rounds?: DuelMatch[][];
  duelPokemon?: Record<string, DuelPokemon | string>;
  paid?: boolean;
  automaticDraw?: true;
  published?: boolean;
  displayedEntries?: number;
  hintShown?: boolean;
  lastAttemptAt?: number;
};

type ContestState = {
  version: 1;
  activity: Record<string, Activity>;
  contests: Record<string, Contest>;
  enrolledPlayers?: Record<string, true>;
  collection?: CollectionState;
  plans: Partial<
    Record<ScheduledContest, { key: string; minute: number; started: boolean }>
  >;
};

export class ContestStore {
  private state: ContestState;
  constructor(private readonly path: string) {
    try {
      const saved = JSON.parse(readFileSync(path, "utf8")) as ContestState;
      if (
        saved.version !== 1 ||
        !saved.activity ||
        !saved.contests ||
        !saved.plans
      ) {
        throw new Error("Nieprawidłowy plik stanu konkursów.");
      }
      this.state = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.state = { version: 1, activity: {}, contests: {}, plans: {} };
    }
  }

  read() {
    return this.state;
  }

  update<T>(mutate: (draft: ContestState) => T) {
    const draft = structuredClone(this.state);
    const result = mutate(draft);
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(draft), { mode: 0o600 });
    renameSync(temporaryPath, this.path);
    this.state = draft;
    return result;
  }
}

export function setContestParticipation(
  store: ContestStore,
  playerId: string,
  enabled: boolean
) {
  if (Boolean(store.read().enrolledPlayers?.[playerId]) === enabled)
    return false;
  store.update((state) => {
    const players = (state.enrolledPlayers ??= {});
    if (enabled) players[playerId] = true;
    else delete players[playerId];
  });
  return true;
}

function getDuelAvailableAt(store: ContestStore, playerId: string) {
  const lastDuelAt = store.read().activity[playerId]?.lastPlayerDuelAt;
  return lastDuelAt === undefined ? 0 : lastDuelAt + PLAYER_DUEL_COOLDOWN;
}

export function getDuelPool(
  store: ContestStore,
  playerId: string,
  now = Date.now()
) {
  const { enrolledPlayers, collection } = store.read();
  return Object.keys(enrolledPlayers ?? {}).filter(
    (id) =>
      id !== playerId &&
      getDuelAvailableAt(store, id) <= now &&
      getOwnedCards(collection, id).length > 0
  );
}

export function playPlayerDuel(
  store: ContestStore,
  challengerId: string,
  opponentId: string,
  now = Date.now(),
  roll = randomInt
) {
  if (opponentId === challengerId) return { status: "self" as const };
  const players = [challengerId, opponentId];
  for (const playerId of players) {
    if (!store.read().enrolledPlayers?.[playerId])
      return { status: "not_joined" as const, playerId };
    const availableAt = getDuelAvailableAt(store, playerId);
    if (availableAt > now)
      return { status: "cooldown" as const, playerId, availableAt };
  }

  const { collection } = store.read();
  const challengerCards = getOwnedCards(collection, challengerId);
  if (!challengerCards.length)
    return { status: "no_cards" as const, playerId: challengerId };
  const opponentCards = getOwnedCards(collection, opponentId);
  if (!opponentCards.length)
    return { status: "no_cards" as const, playerId: opponentId };

  const challengerPokemon = challengerCards[roll(challengerCards.length)];
  const opponentPokemon = opponentCards[roll(opponentCards.length)];
  const challengerChance = getDuelWinChance(challengerPokemon, opponentPokemon);
  const winnerId = roll(100) < challengerChance ? challengerId : opponentId;
  const week = getContestWeek(now);
  store.update((state) => {
    for (const playerId of players) {
      const previous = state.activity[playerId] ?? EMPTY_ACTIVITY;
      state.activity[playerId] = {
        ...recordDuelResult(previous, week, playerId === winnerId),
        lastPlayerDuelAt: now,
      };
    }
  });
  return {
    status: "played" as const,
    challengerId,
    opponentId,
    challengerPokemon,
    opponentPokemon,
    challengerChance,
    winnerId,
  };
}

export function settleAutomaticDraw(
  store: ContestStore,
  id: string,
  eligiblePlayers: string[],
  now = Date.now(),
  random = randomInt
) {
  return store.update((state) => {
    const draw = state.contests[id];
    if (draw.phase !== "draft") return draw;
    if (draw.kind !== "daily" || !draw.automaticDraw)
      throw new Error("Nieprawidłowy typ losowania automatycznego.");

    draw.entries = [...new Set(eligiblePlayers)].filter(
      (player) => state.enrolledPlayers?.[player]
    );
    draw.winner = draw.entries.length
      ? draw.entries[random(draw.entries.length)]
      : null;
    draw.closesAt = now;
    draw.phase = "closed";
    return draw;
  });
}

export function redrawUnlinkedWinner(
  store: ContestStore,
  id: string,
  winnerId: string,
  random = randomInt
) {
  return store.update((state) => {
    const draw = state.contests[id];
    if (!draw.automaticDraw || draw.paid || draw.winner !== winnerId)
      return draw;
    draw.entries = draw.entries.filter((player) => player !== winnerId);
    draw.winner = draw.entries.length
      ? draw.entries[random(draw.entries.length)]
      : null;
    return draw;
  });
}

export function settleContest(
  store: ContestStore,
  id: string,
  winner?: string,
  now = Date.now()
) {
  return store.update((state) => {
    const event = state.contests[id];
    if (event.phase !== "open") return event;
    const week = getContestWeek(now);
    event.phase = "closed";
    if (event.kind === "games") {
      const pokemon: Record<string, DuelPokemon> = {};
      for (const playerId of event.entries) {
        const cards = getOwnedCards(state.collection, playerId);
        if (cards.length) pokemon[playerId] = cards[randomInt(cards.length)];
      }
      const result = drawDuels(Object.keys(pokemon).length > 1 ? pokemon : {});
      event.winner = result.winner;
      event.rounds = result.rounds;
      event.duelPokemon = result.pokemon;
      for (const round of result.rounds) {
        for (const duel of round) {
          for (const participant of [duel.winner, duel.eliminated]) {
            state.activity[participant] = recordDuelResult(
              state.activity[participant] ?? EMPTY_ACTIVITY,
              week,
              participant === duel.winner
            );
          }
        }
      }
    } else {
      event.winner =
        winner ??
        (event.entries.length
          ? event.entries[randomInt(event.entries.length)]
          : null);
    }
    if (event.kind === "weekly") {
      for (const activity of Object.values(state.activity))
        activity.weeklyXp = 0;
    }
    if (event.kind === "pokemon" && winner) {
      state.activity[winner] = addContestXp(
        state.activity[winner] ?? EMPTY_ACTIVITY,
        POKEMON_XP,
        week
      );
    }
    return event;
  });
}
