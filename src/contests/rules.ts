import { randomInt } from "node:crypto";

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

const duelPokemon = [
  "Bulbasaur",
  "Charmander",
  "Squirtle",
  "Pikachu",
  "Eevee",
  "Jigglypuff",
  "Psyduck",
  "Meowth",
  "Growlithe",
  "Machop",
  "Poliwag",
  "Abra",
  "Geodude",
  "Gastly",
  "Cubone",
  "Staryu",
  "Dratini",
  "Snorlax",
];

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
  const players = [...entries];
  for (let index = players.length - 1; index > 0; index--) {
    const other = roll(index + 1);
    [players[index], players[other]] = [players[other], players[index]];
  }

  const rounds: Array<Array<{ winner: string; eliminated: string }>> = [];
  let remaining = players;
  while (remaining.length > 1) {
    const round: (typeof rounds)[number] = [];
    const advanced: string[] = [];
    for (let index = 0; index < remaining.length; index += 2) {
      const pair = remaining.slice(index, index + 2);
      if (pair.length === 1) {
        advanced.push(pair[0]);
      } else {
        const picked = roll(2);
        advanced.push(pair[picked]);
        round.push({ winner: pair[picked], eliminated: pair[1 - picked] });
      }
    }
    rounds.push(round);
    remaining = advanced;
  }

  return {
    winner: remaining[0] ?? null,
    rounds,
    pokemon: Object.fromEntries(
      entries.map((player) => [player, duelPokemon[roll(duelPokemon.length)]])
    ),
  };
}

export const SCHEDULED_CONTESTS = [
  "games",
  "daily",
  "weekly",
  "monthly",
  "pokemon",
] as const;
export type ScheduledContest = (typeof SCHEDULED_CONTESTS)[number];
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
