import { randomInt } from "node:crypto";
import { duelPokemonTiers } from "./duel-pokemon-pool";

const minute = 60_000;
export const CONTEST_RULES = {
  daily: {
    title: "Losowanie dzienne",
    duration: 5 * minute,
    level: 1,
    weeklyXp: 0,
  },
  weekly: {
    title: "Losowanie tygodniowe",
    duration: 60 * minute,
    level: 2,
    weeklyXp: 60,
  },
  monthly: {
    title: "Losowanie miesięczne",
    duration: 90 * minute,
    level: 3,
    weeklyXp: 0,
  },
  games: {
    title: "Turniej pojedynków",
    duration: 5 * minute,
    level: 1,
    weeklyXp: 0,
  },
  numbers: {
    title: "Zgadnij liczbę",
    duration: 20 * minute,
    level: 1,
    weeklyXp: 0,
  },
  pokemon: {
    title: "Jaki to Pokémon?",
    duration: 15 * minute,
    level: 1,
    weeklyXp: 0,
  },
} as const;

export type ContestKind = keyof typeof CONTEST_RULES;

export type Activity = {
  totalXp: number;
  weeklyXp: number;
  xpWeek?: string;
  lastDuelWeek?: string;
};

export const EMPTY_ACTIVITY: Activity = {
  totalXp: 0,
  weeklyXp: 0,
};
export const GUESS_COOLDOWN = 7_000;
export const NUMBER_HINT_AFTER = 5 * minute;
export const POKEMON_XP = 15;
export const DUEL_XP = 10;

type DuelRarity = (typeof duelPokemonTiers)[number]["rarity"];

export type DuelPokemon = {
  name: string;
  rarity: DuelRarity;
};

export type DuelMatch = {
  winner: string;
  eliminated: string;
  winnerWinChance?: number;
};

const duelRarityWeight = duelPokemonTiers.reduce(
  (sum, tier) => sum + tier.weight,
  0
);

export function drawDuelPokemon(roll = randomInt): DuelPokemon {
  let ticket = roll(duelRarityWeight);
  for (const tier of duelPokemonTiers) {
    if (ticket < tier.weight) {
      return {
        name: tier.species[roll(tier.species.length)],
        rarity: tier.rarity,
      };
    }
    ticket -= tier.weight;
  }
  throw new RangeError("Nieprawidłowy wynik losowania Pokémona.");
}

export const MAX_DUEL_WIN_CHANCE = 75;

export function getDuelWinChance(first: DuelPokemon, second: DuelPokemon) {
  const firstRank = duelPokemonTiers.findIndex(
    (tier) => tier.rarity === first.rarity
  );
  const secondRank = duelPokemonTiers.findIndex(
    (tier) => tier.rarity === second.rarity
  );
  const chance = 50 + (firstRank - secondRank) * 5;
  return Math.min(
    MAX_DUEL_WIN_CHANCE,
    Math.max(100 - MAX_DUEL_WIN_CHANCE, chance)
  );
}

export function getContestLevel(xp: number) {
  return 1 + Math.floor(Math.sqrt(xp / 40));
}

export function getWeeklyXp(activity: Activity, week: string) {
  return activity.xpWeek === week ? activity.weeklyXp : 0;
}

export function addContestXp(
  previous: Activity,
  amount: number,
  week: string
): Activity {
  return {
    ...previous,
    totalXp: previous.totalXp + amount,
    weeklyXp: getWeeklyXp(previous, week) + amount,
    xpWeek: week,
  };
}

export function getContestEligibility(
  kind: ContestKind,
  activity: Activity,
  week: string
) {
  if (kind === "daily" && activity.lastDuelWeek !== week)
    return "Rozegraj co najmniej jeden pojedynek w tym tygodniu.";
  const rule = CONTEST_RULES[kind];
  if (getContestLevel(activity.totalXp) < rule.level)
    return `Wymagany poziom Discorda ${rule.level}.`;
  if (getWeeklyXp(activity, week) < rule.weeklyXp)
    return `Wymagany tygodniowy XP ${rule.weeklyXp}.`;
  return null;
}

export function normalizePokemonGuess(name: string) {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}♀♂]/gu, "");
}

export function numberHint(target: number, max: number) {
  const half = Math.floor(max / 2);
  return target <= half ? [1, half] : [half + 1, max];
}

export function drawDuels(entries: string[], roll = randomInt) {
  const pokemon = Object.fromEntries(
    entries.map((player) => [player, drawDuelPokemon(roll)])
  );
  const players = [...entries];
  for (let index = players.length - 1; index > 0; index--) {
    const other = roll(index + 1);
    [players[index], players[other]] = [players[other], players[index]];
  }

  const rounds: DuelMatch[][] = [];
  let remaining = players;
  while (remaining.length > 1) {
    const round: (typeof rounds)[number] = [];
    const advanced: string[] = [];
    for (let index = 0; index < remaining.length; index += 2) {
      const pair = remaining.slice(index, index + 2);
      if (pair.length === 1) {
        advanced.push(pair[0]);
      } else {
        const firstChance = getDuelWinChance(
          pokemon[pair[0]],
          pokemon[pair[1]]
        );
        const firstWins = roll(100) < firstChance;
        const winner = firstWins ? pair[0] : pair[1];
        const eliminated = firstWins ? pair[1] : pair[0];
        advanced.push(winner);
        round.push({
          winner,
          eliminated,
          winnerWinChance: firstWins ? firstChance : 100 - firstChance,
        });
      }
    }
    rounds.push(round);
    remaining = advanced;
  }

  return { winner: remaining[0] ?? null, rounds, pokemon };
}

export const SCHEDULED_CONTESTS = [
  "games",
  "daily",
  "weekly",
  "monthly",
  "pokemon",
] as const;
export type ScheduledContest = (typeof SCHEDULED_CONTESTS)[number];
const duelScheduleWindows = [
  {
    key: "games:morning",
    firstMinute: 10 * 60,
    lastMinute: 12 * 60 - 1,
    expiresAt: 12 * 60,
  },
  {
    key: "games:midday",
    firstMinute: 12 * 60,
    lastMinute: 14 * 60 - 1,
    expiresAt: 14 * 60,
  },
  {
    key: "games:early-afternoon",
    firstMinute: 14 * 60,
    lastMinute: 16 * 60 - 1,
    expiresAt: 16 * 60,
  },
  {
    key: "games:afternoon",
    firstMinute: 16 * 60,
    lastMinute: 18 * 60 - 1,
    expiresAt: 18 * 60,
  },
  {
    key: "games:early-evening",
    firstMinute: 18 * 60,
    lastMinute: 20 * 60 - 1,
    expiresAt: 20 * 60,
  },
  {
    key: "games",
    firstMinute: 20 * 60,
    lastMinute: 21 * 60,
    expiresAt: 22 * 60,
  },
] as const;

export type ContestPlanKey =
  | ScheduledContest
  | (typeof duelScheduleWindows)[number]["key"];

export function getDuelScheduleWindow(minuteOfDay: number) {
  return duelScheduleWindows.find(
    ({ firstMinute, expiresAt }) =>
      minuteOfDay >= firstMinute && minuteOfDay < expiresAt
  );
}

const warsawClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Warsaw",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function getWarsawDate(now: number) {
  const parts = Object.fromEntries(
    warsawClock.formatToParts(now).map(({ type, value }) => [type, value])
  );
  const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
  return { dayKey, minuteOfDay: +parts.hour * 60 + +parts.minute };
}

export function getContestWeek(now: number) {
  const { dayKey } = getWarsawDate(now);
  const monday = new Date(`${dayKey}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export function getScheduleSlot(kind: ScheduledContest, now: number) {
  const { dayKey, minuteOfDay } = getWarsawDate(now);
  const date = new Date(`${dayKey}T12:00:00Z`);
  const monthEnd = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  if (kind === "weekly" && date.getUTCDay() !== 0) return null;
  if (kind === "monthly" && date.getUTCDate() !== monthEnd) return null;
  return { key: dayKey, minuteOfDay };
}
