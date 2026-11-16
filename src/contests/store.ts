import { randomInt } from "node:crypto";
import {
  addContestXp,
  drawDuels,
  DUEL_XP,
  EMPTY_ACTIVITY,
  getContestWeek,
  POKEMON_XP,
} from "./rules";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Activity, ContestKind, ScheduledContest } from "./rules";

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
  rounds?: ReturnType<typeof drawDuels>["rounds"];
  duelPokemon?: Record<string, string>;
  paid?: boolean;
  published?: boolean;
  displayedEntries?: number;
  hintShown?: boolean;
  lastAttemptAt?: number;
};

type ContestState = {
  version: 1;
  activity: Record<string, Activity>;
  contests: Record<string, Contest>;
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
            state.activity[participant] = {
              ...addContestXp(
                state.activity[participant] ?? EMPTY_ACTIVITY,
                DUEL_XP,
                week
              ),
              lastDuelWeek: week,
            };
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
