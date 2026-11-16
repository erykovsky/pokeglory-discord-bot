import { randomInt } from "node:crypto";
import {
  addContestXp,
  addDuelXp,
  drawDuelPokemon,
  drawDuels,
  EMPTY_ACTIVITY,
  getContestWeek,
  getDuelWinChance,
  POKEMON_XP,
  PLAYER_DUEL_COOLDOWN,
  DUEL_CHALLENGE_DURATION,
} from "./rules";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Activity,
  ContestKind,
  ContestPlanKey,
  DuelMatch,
  DuelPokemon,
} from "./rules";

export type Reward = { currency: "yen" | "pz"; amount: number };

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
  published?: boolean;
  displayedEntries?: number;
  hintShown?: boolean;
  lastAttemptAt?: number;
};

type DuelChallenge = {
  challengerId: string;
  invitedId?: string;
  expiresAt: number;
};

type ContestState = {
  version: 1;
  activity: Record<string, Activity>;
  contests: Record<string, Contest>;
  duelChallenges?: Record<string, DuelChallenge>;
  plans: Partial<
    Record<ContestPlanKey, { key: string; minute: number; started: boolean }>
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

function findDuelCooldown(store: ContestStore, players: string[], now: number) {
  for (const playerId of players) {
    const lastDuelAt = store.read().activity[playerId]?.lastPlayerDuelAt;
    if (lastDuelAt === undefined) continue;
    const availableAt = lastDuelAt + PLAYER_DUEL_COOLDOWN;
    if (availableAt > now)
      return { status: "cooldown" as const, playerId, availableAt };
  }
  return null;
}

export function openDuelChallenge(
  store: ContestStore,
  id: string,
  challengerId: string,
  invitedId?: string,
  now = Date.now()
) {
  if (invitedId === challengerId) return { status: "self" as const };
  const cooldown = findDuelCooldown(
    store,
    invitedId ? [challengerId, invitedId] : [challengerId],
    now
  );
  if (cooldown) return cooldown;
  const active = Object.entries(store.read().duelChallenges ?? {}).filter(
    ([, challenge]) => challenge.expiresAt > now
  );
  const pending = active.find(
    ([, challenge]) => challenge.challengerId === challengerId
  );
  if (pending)
    return { status: "pending" as const, expiresAt: pending[1].expiresAt };

  const challenge: DuelChallenge = {
    challengerId,
    invitedId,
    expiresAt: now + DUEL_CHALLENGE_DURATION,
  };
  store.update((state) => {
    state.duelChallenges = Object.fromEntries([...active, [id, challenge]]);
  });
  return { status: "created" as const, challenge };
}

export function acceptDuelChallenge(
  store: ContestStore,
  id: string,
  opponentId: string,
  now = Date.now(),
  roll = randomInt
) {
  const challenge = store.read().duelChallenges?.[id];
  if (!challenge || challenge.expiresAt <= now)
    return { status: "closed" as const };
  const { challengerId, invitedId } = challenge;
  if (challengerId === opponentId) return { status: "self" as const };
  if (invitedId && invitedId !== opponentId)
    return { status: "reserved" as const };
  const players = [challengerId, opponentId];
  const cooldown = findDuelCooldown(store, players, now);
  if (cooldown) return cooldown;

  const challengerPokemon = drawDuelPokemon(roll);
  const opponentPokemon = drawDuelPokemon(roll);
  const challengerChance = getDuelWinChance(challengerPokemon, opponentPokemon);
  const winnerId = roll(100) < challengerChance ? challengerId : opponentId;
  const week = getContestWeek(now);
  store.update((state) => {
    delete state.duelChallenges?.[id];
    for (const playerId of players) {
      const previous = state.activity[playerId] ?? EMPTY_ACTIVITY;
      state.activity[playerId] = {
        ...addDuelXp(previous, week),
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
      const result = drawDuels(event.entries.length > 1 ? event.entries : []);
      event.winner = result.winner;
      event.rounds = result.rounds;
      event.duelPokemon = result.pokemon;
      for (const round of result.rounds) {
        for (const duel of round) {
          for (const participant of [duel.winner, duel.eliminated]) {
            state.activity[participant] = addDuelXp(
              state.activity[participant] ?? EMPTY_ACTIVITY,
              week
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
