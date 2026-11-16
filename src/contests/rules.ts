import { createHash, randomInt } from "node:crypto";

const minute = 60_000;
export const CONTEST_RULES = {
  daily: {
    title: "Losowanie dzienne",
    duration: 5 * minute,
    level: 1,
    weeklyXp: 10,
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
  lastMessageAt: number;
  lastFingerprint?: string;
};

export const EMPTY_ACTIVITY: Activity = {
  totalXp: 0,
  weeklyXp: 0,
  lastMessageAt: 0,
};
export const GUESS_COOLDOWN = 7_000;
export const NUMBER_HINT_AFTER = 5 * minute;
export const POKEMON_XP = 15;

export function getContestLevel(xp: number) {
  return 1 + Math.floor(Math.sqrt(xp / 40));
}

export function creditMessage(
  previous: Activity,
  text: string,
  now: number
): Activity {
  const normalized = text
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (
    normalized.replace(/[^\p{L}\p{N}]/gu, "").length < 12 ||
    normalized.startsWith("/") ||
    now - previous.lastMessageAt < minute
  ) {
    return previous;
  }

  const fingerprint = createHash("sha256").update(normalized).digest("hex");
  if (fingerprint === previous.lastFingerprint) return previous;

  return {
    totalXp: previous.totalXp + 5,
    weeklyXp: previous.weeklyXp + 5,
    lastMessageAt: now,
    lastFingerprint: fingerprint,
  };
}

export function getContestEligibility(kind: ContestKind, activity: Activity) {
  const rule = CONTEST_RULES[kind];
  if (getContestLevel(activity.totalXp) < rule.level)
    return `Wymagany poziom Discorda ${rule.level}.`;
  if (activity.weeklyXp < rule.weeklyXp)
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

  return { winner: remaining[0] ?? null, rounds };
}

export const SCHEDULED_CONTESTS = [
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

export function getScheduleSlot(kind: ScheduledContest, now: number) {
  const parts = Object.fromEntries(
    warsawClock.formatToParts(now).map(({ type, value }) => [type, value])
  );
  const dayKey = `${parts.year}-${parts.month}-${parts.day}`;
  const date = new Date(`${dayKey}T12:00:00Z`);
  const monthEnd = new Date(
    Date.UTC(+parts.year, +parts.month, 0)
  ).getUTCDate();
  if (kind === "weekly" && date.getUTCDay() !== 0) return null;
  if (kind === "monthly" && date.getUTCDate() !== monthEnd) return null;
  return { key: dayKey, minuteOfDay: +parts.hour * 60 + +parts.minute };
}
