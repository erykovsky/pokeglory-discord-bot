import { randomInt } from "node:crypto";
import { duelPokemonTiers } from "./duel-pokemon-pool";
import cardImages from "./card-images.json";
import { drawDuelPokemon, normalizePokemonGuess } from "./rules";
import type { ContestStore } from "./store";

export const CARD_WINDOW_MS = 4 * 60 * 60_000;
export const CARD_ROLL_LIMIT = 3;
export const CARD_PRIORITY_MS = 10_000;
export const CARD_DROP_MS = 90_000;
export const CARD_TRADE_MS = 10 * 60_000;

const images: Record<string, string> = cardImages;
const cards = duelPokemonTiers.flatMap(({ rarity, species }) =>
  [...species].map((name) => ({ name, rarity, imagePath: images[name] }))
);
type Card = (typeof cards)[number];
export const cardByName = new Map<string, Card>(
  cards.map((card) => [card.name, card])
);
const cardByGuess = new Map(
  cards.map((card) => [normalizePokemonGuess(card.name), card])
);
export function findCard(name: string) {
  return cardByGuess.get(normalizePokemonGuess(name));
}

type Collector = {
  cards: Record<string, number>;
  wishes: string[];
  rolls: number[];
  lastClaimAt?: number;
};

type CardMessage = {
  id: string;
  channelId: string;
  messageId?: string;
  expiresAt: number;
};

export type CardDrop = CardMessage & {
  rollerId: string;
  card: string;
  createdAt: number;
  claimedBy?: string;
};

export type CardTrade = CardMessage & {
  from: string;
  to: string;
  offer: string;
  request: string;
  accepted?: true;
};

export type CollectionState = {
  players: Record<string, Collector>;
  drops: Record<string, CardDrop>;
  trades: Record<string, CardTrade>;
};

export function getOwnedCards(
  state: CollectionState | undefined,
  playerId: string
) {
  const owned: Card[] = [];
  for (const [name, quantity] of Object.entries(
    state?.players[playerId]?.cards ?? {}
  )) {
    const card = cardByName.get(name);
    if (quantity > 0 && card) owned.push(card);
  }
  return owned;
}

function collection(state: { collection?: CollectionState }) {
  return (state.collection ??= { players: {}, drops: {}, trades: {} });
}

function collector(state: CollectionState, playerId: string) {
  return (state.players[playerId] ??= { cards: {}, wishes: [], rolls: [] });
}

function recentRolls(player: Collector | undefined, now: number) {
  return (player?.rolls ?? []).filter((time) => time + CARD_WINDOW_MS > now);
}

export function getCollectionLimits(
  store: ContestStore,
  playerId: string,
  now = Date.now()
) {
  const player = store.read().collection?.players[playerId];
  const rolls = recentRolls(player, now);
  return {
    rollsLeft: Math.max(0, CARD_ROLL_LIMIT - rolls.length),
    nextRollAt:
      rolls.length >= CARD_ROLL_LIMIT ? rolls[0] + CARD_WINDOW_MS : null,
    nextClaimAt:
      player?.lastClaimAt !== undefined &&
      player.lastClaimAt + CARD_WINDOW_MS > now
        ? player.lastClaimAt + CARD_WINDOW_MS
        : null,
  };
}

export function rollCard(
  store: ContestStore,
  id: string,
  channelId: string,
  rollerId: string,
  now = Date.now(),
  random = randomInt
) {
  const existing = store.read().collection?.drops[id];
  if (existing) return { status: "duplicate" as const };
  const limits = getCollectionLimits(store, rollerId, now);
  if (limits.nextRollAt !== null)
    return { status: "limit" as const, availableAt: limits.nextRollAt };

  const card = drawDuelPokemon(random);
  const drop: CardDrop = {
    id,
    channelId,
    rollerId,
    card: card.name,
    createdAt: now,
    expiresAt: now + CARD_DROP_MS,
  };
  store.update((state) => {
    const set = collection(state);
    const player = collector(set, rollerId);
    player.rolls = [...recentRolls(player, now), now];
    set.drops[id] = drop;
  });
  return { status: "rolled" as const, drop };
}

export function claimCard(
  store: ContestStore,
  id: string,
  playerId: string,
  now = Date.now()
) {
  const drop = store.read().collection?.drops[id];
  if (!drop || now >= drop.expiresAt) return { status: "closed" as const };
  if (drop.claimedBy) return { status: "claimed" as const };
  const priorityEndsAt = drop.createdAt + CARD_PRIORITY_MS;
  if (playerId !== drop.rollerId && now < priorityEndsAt)
    return { status: "priority" as const, availableAt: priorityEndsAt };
  const { nextClaimAt } = getCollectionLimits(store, playerId, now);
  if (nextClaimAt !== null)
    return { status: "limit" as const, availableAt: nextClaimAt };

  return store.update((state) => {
    const set = collection(state);
    const current = set.drops[id];
    const player = collector(set, playerId);
    player.cards[current.card] = (player.cards[current.card] ?? 0) + 1;
    player.lastClaimAt = now;
    current.claimedBy = playerId;
    return { status: "caught" as const, drop: current };
  });
}

export function setCardWish(
  store: ContestStore,
  playerId: string,
  card: string,
  enabled: boolean
) {
  const wishes = store.read().collection?.players[playerId]?.wishes ?? [];
  if (wishes.includes(card) === enabled) return "unchanged";
  if (enabled && wishes.length >= 10) return "limit";
  store.update((state) => {
    collector(collection(state), playerId).wishes = enabled
      ? [...wishes, card]
      : wishes.filter((wish) => wish !== card);
  });
  return "saved";
}

function ownsCard(store: ContestStore, playerId: string, card: string) {
  return (store.read().collection?.players[playerId]?.cards[card] ?? 0) > 0;
}

export function proposeCardTrade(
  store: ContestStore,
  trade: Pick<
    CardTrade,
    "id" | "channelId" | "from" | "to" | "offer" | "request"
  >,
  now = Date.now()
) {
  if (trade.from === trade.to || trade.offer === trade.request)
    return { status: "invalid" as const };
  if (
    !ownsCard(store, trade.from, trade.offer) ||
    !ownsCard(store, trade.to, trade.request)
  )
    return { status: "missing_card" as const };
  const active = Object.values(store.read().collection?.trades ?? {}).some(
    (other) =>
      other.from === trade.from && !other.accepted && other.expiresAt > now
  );
  if (active) return { status: "pending" as const };
  const offer = { ...trade, expiresAt: now + CARD_TRADE_MS };
  store.update((state) => {
    collection(state).trades[offer.id] = offer;
  });
  return { status: "created" as const, trade: offer };
}

export function acceptCardTrade(
  store: ContestStore,
  id: string,
  playerId: string,
  now = Date.now()
) {
  const trade = store.read().collection?.trades[id];
  if (!trade || trade.expiresAt <= now || trade.accepted)
    return { status: "closed" as const };
  if (trade.to !== playerId) return { status: "restricted" as const };
  if (
    !ownsCard(store, trade.from, trade.offer) ||
    !ownsCard(store, trade.to, trade.request)
  )
    return { status: "missing_card" as const };
  return store.update((state) => {
    const set = collection(state);
    const from = collector(set, trade.from).cards;
    const to = collector(set, trade.to).cards;
    if (--from[trade.offer] === 0) delete from[trade.offer];
    if (--to[trade.request] === 0) delete to[trade.request];
    from[trade.request] = (from[trade.request] ?? 0) + 1;
    to[trade.offer] = (to[trade.offer] ?? 0) + 1;
    set.trades[id].accepted = true;
    return { status: "traded" as const, trade: set.trades[id] };
  });
}
