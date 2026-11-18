import { randomInt, randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ChatInputApplicationCommandData,
  type Client,
  EmbedBuilder,
  Events,
  type GuildMember,
  type Guild,
  type GuildTextBasedChannel,
  InteractionContextType,
  type Message,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { config } from "../config";
import { getOwnedCards } from "./collection";
import {
  collectionCommands,
  createCollectionHandlers,
  getCardImageUrl,
} from "./collection-discord";
import {
  CONTEST_RULES,
  type ContestKind,
  type ScheduledContest,
  type DuelMatch,
  type DuelPokemon,
  DUEL_XP,
  EMPTY_ACTIVITY,
  getContestEligibility,
  getContestLevel,
  getContestWeek,
  DAILY_DRAW_START_MINUTE,
  PLAYER_DUEL_COOLDOWN,
  getScheduleSlot,
  GUESS_COOLDOWN,
  MAX_DUEL_WIN_CHANCE,
  normalizePokemonGuess,
  NUMBER_HINT_AFTER,
  numberHint,
  POKEMON_XP,
  SCHEDULED_CONTESTS,
} from "./rules";
import {
  type Contest,
  ContestStore,
  getDuelPool,
  playPlayerDuel,
  redrawUnlinkedWinner,
  setContestParticipation,
  settleAutomaticDraw,
  settleContest,
  type Reward,
} from "./store";

const PREFIX = "pg-contest:";
const DUEL_CHALLENGE_PREFIX = "pg-duel:";
const DUEL_SIGNUP_LABEL = "Dołącz do turnieju";
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;
const kinds = Object.keys(CONTEST_RULES) as ContestKind[];
const formatNumber = new Intl.NumberFormat("pl-PL");

function readOptions() {
  if (!process.env.POKEGLORY_CONTESTS?.trim()) return null;
  const parsed = JSON.parse(process.env.POKEGLORY_CONTESTS) as {
    channels?: Partial<Record<ContestKind, string>>;
    duelChannel?: string;
    collectionChannel?: string;
    levelRoles?: Record<string, string>;
    automatic?: boolean;
  };
  const isId = (id: unknown): id is string =>
    typeof id === "string" && /^\d{16,22}$/.test(id);
  if (
    !config.POKEGLORY_GUILD_ID ||
    !config.POKEGLORY_DISCORD_BOT_SECRET ||
    !parsed.channels ||
    (!Object.keys(parsed.channels).length &&
      !parsed.duelChannel &&
      !parsed.collectionChannel) ||
    (parsed.duelChannel !== undefined && !isId(parsed.duelChannel)) ||
    (parsed.collectionChannel !== undefined &&
      !isId(parsed.collectionChannel)) ||
    !Object.entries(parsed.channels).every(
      ([kind, id]) => kinds.includes(kind as ContestKind) && isId(id)
    ) ||
    !Object.entries(parsed.levelRoles ?? {}).every(
      ([level, id]) => /^\d{1,3}$/.test(level) && Number(level) >= 2 && isId(id)
    )
  ) {
    throw new Error(
      "Sprawdź POKEGLORY_CONTESTS, serwer Discord i sekret integracji."
    );
  }
  if (
    parsed.channels.numbers &&
    parsed.channels.numbers === parsed.channels.pokemon
  ) {
    throw new Error("Zgadywanie liczby i Pokémona wymagają osobnych kanałów.");
  }
  return {
    guildId: config.POKEGLORY_GUILD_ID,
    channels: parsed.channels,
    duelChannel: parsed.duelChannel,
    collectionChannel: parsed.collectionChannel,
    levelRoles: Object.entries(parsed.levelRoles ?? {}).map(([level, id]) => ({
      level: Number(level),
      id,
    })),
    automatic: parsed.automatic === true,
  };
}

export const contestOptions = config.POKEGLORY_LOCAL_IDEAS_ONLY
  ? null
  : readOptions();

export const contestCommands: ChatInputApplicationCommandData[] = [
  {
    name: "aktywnosc",
    description: "Pokaż wyniki pojedynków i udział w losowaniach.",
  },
  ...(contestOptions?.collectionChannel ? collectionCommands : []),
  ...(contestOptions?.duelChannel || contestOptions?.channels.daily
    ? [
        {
          name: "dolacz",
          description: "Zapisz się do pojedynków i codziennego losowania.",
          contexts: [InteractionContextType.Guild],
        },
        {
          name: "opusc",
          description: "Wypisz się z pojedynków i codziennego losowania.",
          contexts: [InteractionContextType.Guild],
        },
      ]
    : []),
  ...(contestOptions?.duelChannel
    ? [
        {
          name: "pojedynek",
          description: "Rozegraj pojedynek kartami z własnej kolekcji.",
          contexts: [InteractionContextType.Guild],
          options: [
            {
              name: "gracz",
              description:
                "Wpisz nick i wybierz gracza albo zostaw puste, by losować.",
              type: ApplicationCommandOptionType.User as const,
            },
          ],
        },
      ]
    : []),
  ...(Object.keys(contestOptions?.channels ?? {}).length
    ? ([
        {
          name: "konkurs",
          description: "Rozpocznij konkurs na wyznaczonym kanale.",
          defaultMemberPermissions: PermissionFlagsBits.ManageGuild,
          options: [
            {
              name: "rodzaj",
              description: "Wybierz konkurs.",
              required: true,
              type: ApplicationCommandOptionType.String,
              choices: kinds
                .filter((kind) => contestOptions?.channels[kind])
                .map((kind) => ({
                  name: CONTEST_RULES[kind].title,
                  value: kind,
                })),
            },
            ...(contestOptions?.channels.numbers
              ? [
                  {
                    name: "zakres",
                    description: "Górna granica w konkursie Zgadnij liczbę.",
                    type: ApplicationCommandOptionType.Integer as const,
                    choices: [1000, 2000].map((value) => ({
                      name: `1–${value}`,
                      value,
                    })),
                  },
                ]
              : []),
          ],
        },
      ] satisfies ChatInputApplicationCommandData[])
    : []),
];

function isVerified(member: GuildMember | null) {
  if (!member || member.user.bot) return false;
  const roleId = config.POKEGLORY_VERIFIED_ROLE_ID;
  return roleId
    ? member.roles.cache.has(roleId)
    : member.roles.cache.some(
        (role) => role.name === config.POKEGLORY_VERIFIED_ROLE_NAME
      );
}

function firstCardHint(channelId?: string) {
  return channelId
    ? `Najpierw złap kartę poleceniem /losuj na <#${channelId}>.`
    : "Pojedynki wymagają karty. Kanał kolekcji nie jest jeszcze podpięty.";
}

function describeDuelFailure(
  failure: Exclude<ReturnType<typeof playPlayerDuel>, { status: "played" }>,
  playerId: string,
  collectionChannel?: string
) {
  if (failure.status === "self") return "Wybierz innego gracza.";
  if (failure.status === "not_joined")
    return failure.playerId === playerId
      ? "Wpisz /dolacz, żeby wejść do puli pojedynków."
      : "Ten gracz nie jest w puli pojedynków.";
  if (failure.status === "no_cards")
    return failure.playerId === playerId
      ? firstCardHint(collectionChannel)
      : "Ten gracz nie ma jeszcze żadnej karty.";
  return failure.playerId === playerId
    ? `Następny pojedynek możesz rozegrać <t:${Math.ceil(
        failure.availableAt / 1000
      )}:R>.`
    : "Ten gracz jest jeszcze w przerwie po poprzednim pojedynku.";
}

async function findRandomOpponent(guild: Guild, candidates: string[]) {
  while (candidates.length) {
    const [id] = candidates.splice(randomInt(candidates.length), 1);
    const member =
      guild.members.cache.get(id) ??
      (await guild.members.fetch(id).catch(() => null));
    if (isVerified(member)) return member;
  }
  return null;
}

async function getVerifiedParticipants(guild: Guild, players: string[]) {
  const verified: string[] = [];
  for (let from = 0; from < players.length; from += 100) {
    const members = await guild.members.fetch({
      user: players.slice(from, from + 100),
      time: 15_000,
    });
    for (const member of members.values()) {
      if (isVerified(member)) verified.push(member.id);
    }
  }
  return verified;
}

async function clearLegacyChallengeButtons(
  channel: GuildTextBasedChannel,
  botId: string
) {
  const messages = await channel.messages.fetch({ limit: 100 });
  for (const message of messages.values()) {
    if (
      message.author.id !== botId ||
      !message.components.some(
        (row) =>
          "components" in row &&
          row.components.some(
            (part) =>
              "customId" in part &&
              part.customId?.startsWith(DUEL_CHALLENGE_PREFIX)
          )
      )
    )
      continue;
    await message.edit({ components: [] }).catch(() => undefined);
  }
}

class ContestApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

async function contestApi<T>(payload: object): Promise<T> {
  const response = await fetch(
    new URL("/api/discord/contests", config.POKEGLORY_API_URL),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET ?? "",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    }
  );
  const body = (await response.json().catch(() => null)) as
    | (T & { code?: string })
    | null;
  if (!response.ok || !body)
    throw new ContestApiError(body?.code ?? `http_${response.status}`);
  return body;
}

function contestPrize(event: Contest) {
  if (event.kind === "pokemon") return `${POKEMON_XP} XP na Discordzie`;
  const reward = event.reward;
  if (reward?.currency === "bundle")
    return `**${reward.name}**\n${reward.items
      .map(({ quantity, name }) => `• ${quantity} × ${name}`)
      .join("\n")}`;
  return reward
    ? `${formatNumber.format(reward.amount)} ${
        reward.currency === "yen" ? "¥" : "PZ"
      }`
    : "—";
}

function hasSignups(event: Contest) {
  return (
    !event.automaticDraw && event.kind !== "numbers" && event.kind !== "pokemon"
  );
}

function formatDuelPokemon(pokemon: DuelPokemon | string) {
  return typeof pokemon === "string"
    ? pokemon
    : `${pokemon.name}, ${pokemon.rarity}`;
}

function describeDuel(event: Contest, duel: DuelMatch, mentions: boolean) {
  const display = (id: string) => {
    const player = mentions ? `<@${id}>` : id;
    const pokemon = event.duelPokemon?.[id];
    if (!pokemon) return player;
    return `${player} (${formatDuelPokemon(pokemon)})`;
  };
  const chance = duel.winnerWinChance;
  const odds = chance === undefined ? "" : ` · ${chance}% do ${100 - chance}%`;
  return `${display(duel.winner)} pokonał ${display(duel.eliminated)}${odds}.`;
}

function describeDuelRounds(event: Contest, mentions: boolean) {
  return (event.rounds ?? []).flatMap((round, index) => [
    mentions ? `**Runda ${index + 1}**` : `Runda ${index + 1}`,
    ...round.map((duel) => describeDuel(event, duel, mentions)),
  ]);
}

function buildCard(event: Contest, now: number) {
  const rule = CONTEST_RULES[event.kind];
  const closed = event.phase === "closed";
  const files: AttachmentBuilder[] = [];
  const description =
    event.kind === "games" && !event.reward
      ? [
          `**${DUEL_XP} XP** za każdy rozegrany pojedynek. XP dostają obaj gracze.`,
        ]
      : [`**Nagroda** ${contestPrize(event)}`];
  if (closed) {
    description.push(
      event.winner
        ? `**Wygrywa** <@${event.winner}>`
        : event.kind === "games"
        ? "Do turnieju potrzeba co najmniej dwóch uczestników z kartami."
        : "Konkurs zakończony bez zwycięzcy."
    );
    if (event.automaticDraw)
      description.push(
        `**Uczestnicy** ${event.entries.length} · wpisz /dolacz, aby brać udział codziennie, lub /opusc, aby się wypisać.`
      );
    if (event.winner && event.reward && !event.paid)
      description.push("Wypłata nagrody w toku.");
    if (event.number)
      description.push(`**Szukana liczba** ${event.number.target}`);
    if (event.pokemon) description.push(`**To był** ${event.pokemon.name}`);
    if (event.rounds?.length) {
      description.push(`**Uczestnicy** ${event.entries.length}`);
      const rounds = describeDuelRounds(event, true);
      if (
        [...description, ...rounds].join("\n").length <=
        MAX_EMBED_DESCRIPTION_LENGTH
      ) {
        description.push(...rounds);
      } else {
        description.push("Lista uczestników i wyniki rund są w załączniku.");
        const report = [
          "Identyfikatory Discord zapisanych uczestników",
          ...event.entries,
          "",
          ...describeDuelRounds(event, false),
        ].join("\n");
        files.push(
          new AttachmentBuilder(Buffer.from(report), { name: "pojedynki.txt" })
        );
      }
    }
  } else {
    description.push(`**Koniec** <t:${Math.floor(event.closesAt / 1000)}:R>`);
    if (hasSignups(event)) {
      if (event.kind === "games") {
        description.push(
          "RotomBot wybierze jedną kartę z Twojej kolekcji na cały turniej i dobierze pary 1 na 1.",
          `Rzadszy Pokémon ma większą szansę wygrać, maksymalnie ${MAX_DUEL_WIN_CHANCE}%. Zwycięzca przechodzi dalej.`,
          "Wyniki walk znajdziesz w komendzie /aktywnosc."
        );
      } else if (event.kind === "daily") {
        description.push(
          "W tym losowaniu obowiązuje udział po rozegraniu pojedynku w bieżącym tygodniu."
        );
      } else {
        description.push(`**Wymagany poziom** ${rule.level}`);
        if (rule.weeklyXp)
          description.push(`**Wymagany tygodniowy XP** ${rule.weeklyXp}`);
      }
      description.push(`**Zapisani** ${event.entries.length}`);
    } else if (event.number) {
      description.push(
        `Wpisz liczbę od **1** do **${event.number.max}**. Kolejna próba po 7 sekundach.`
      );
      if (now >= event.number.hintsAt) {
        const [low, high] = numberHint(event.number.target, event.number.max);
        description.push(
          `**Podpowiedź** Szukana liczba jest w przedziale ${low}–${high}.`
        );
      }
    } else {
      description.push("Wpisz nazwę Pokémona na tym kanale.");
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(rule.title)
    .setColor(closed ? 0x607493 : 0x36b28c)
    .setDescription(description.join("\n"));
  if (event.pokemon) embed.setImage("attachment://zagadka.png");
  const components =
    !closed && hasSignups(event)
      ? [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(`${PREFIX}join:${event.id}`)
              .setLabel(
                event.kind === "games"
                  ? DUEL_SIGNUP_LABEL
                  : event.kind === "daily"
                  ? "Zapisz się do losowania"
                  : "Zapisz się"
              )
              .setStyle(
                event.kind === "daily"
                  ? ButtonStyle.Primary
                  : ButtonStyle.Success
              ),
            new ButtonBuilder()
              .setCustomId(`${PREFIX}entries:${event.id}`)
              .setLabel("Uczestnicy")
              .setStyle(ButtonStyle.Secondary)
          ),
        ]
      : [];
  return {
    embeds: [embed],
    components,
    files,
    allowedMentions: { parse: [] as never[] },
  };
}

async function getPokemonAttachment(imageUrl: string) {
  const publicUrl = new URL(config.POKEGLORY_PUBLIC_URL);
  const asset = new URL(imageUrl, publicUrl);
  if (
    asset.origin !== publicUrl.origin ||
    !asset.pathname.startsWith("/img/")
  ) {
    throw new Error("Nieprawidłowy adres ilustracji Pokémona.");
  }
  const response = await fetch(asset, {
    signal: AbortSignal.timeout(8_000),
    redirect: "error",
  });
  if (!response.ok)
    throw new Error(`Nie pobrano ilustracji, HTTP ${response.status}.`);
  return new AttachmentBuilder(Buffer.from(await response.arrayBuffer()), {
    name: "zagadka.png",
  });
}

export function startContestSystem(
  client: Client<true>,
  options: NonNullable<typeof contestOptions>
) {
  const store = new ContestStore(
    process.env.POKEGLORY_CONTEST_STATE_PATH || "data/contests.json"
  );
  const processing = new Set<string>();
  const collection = options.collectionChannel
    ? createCollectionHandlers(
        client,
        store,
        options.guildId,
        options.collectionChannel,
        isVerified
      )
    : null;

  const getActivity = (id: string) =>
    store.read().activity[id] ?? EMPTY_ACTIVITY;
  const syncLevelRoles = async (
    member: GuildMember,
    activity = getActivity(member.id)
  ) => {
    const level = getContestLevel(activity.totalXp);
    const roles = options.levelRoles
      .filter((role) => level >= role.level && !member.roles.cache.has(role.id))
      .map((role) => role.id);
    if (roles.length)
      await member.roles.add(roles, "Poziom aktywności na Discordzie");
  };

  const getChannel = async (id: string) => {
    const channel = await client.channels.fetch(id);
    if (
      channel?.type !== ChannelType.GuildText ||
      channel.guildId !== options.guildId
    ) {
      throw new Error(
        "Kanał konkursowy musi być kanałem tekstowym na skonfigurowanym serwerze."
      );
    }
    return channel;
  };

  if (options.duelChannel) {
    void getChannel(options.duelChannel)
      .then((channel) => clearLegacyChallengeButtons(channel, client.user.id))
      .catch((error) => console.error("[Pojedynki: stare przyciski]", error));
  }

  async function refresh(event: Contest) {
    if (!event.messageId) return;
    const channel = await getChannel(event.channelId);
    const current = store.read().contests[event.id];
    const { files, ...card } = buildCard(current, Date.now());
    await channel.messages.edit(
      event.messageId,
      files.length ? { ...card, attachments: [], files } : card
    );
  }

  async function processEvent(id: string) {
    if (processing.has(id)) return;
    processing.add(id);
    try {
      let event = store.read().contests[id];
      if (event.phase === "draft" && event.automaticDraw) {
        if (!event.reward) {
          const reward = await contestApi<Reward>({
            action: "reserve",
            contestId: id,
            kind: "daily",
            supportsBundles: true,
          });
          event = store.update((state) =>
            Object.assign(state.contests[id], { reward })
          );
        }
        const channel = await getChannel(event.channelId);
        const players = Object.keys(store.read().enrolledPlayers ?? {});
        const eligible = await getVerifiedParticipants(channel.guild, players);
        event = settleAutomaticDraw(store, id, eligible);
      }
      if (event.phase === "draft") {
        if (event.kind === "pokemon" && !event.pokemon) {
          const pokemon = await contestApi<NonNullable<Contest["pokemon"]>>({
            action: "pokemon",
          });
          event = store.update((state) =>
            Object.assign(state.contests[id], { pokemon })
          );
        } else if (
          event.kind !== "pokemon" &&
          event.kind !== "games" &&
          !event.reward
        ) {
          const reward = await contestApi<Reward>({
            action: "reserve",
            contestId: id,
            kind: event.kind,
          });
          event = store.update((state) =>
            Object.assign(state.contests[id], { reward })
          );
        }

        const channel = await getChannel(event.channelId);
        const file = event.pokemon
          ? await getPokemonAttachment(event.pokemon.imageUrl)
          : null;
        const now = Date.now();
        const closesAt = now + CONTEST_RULES[event.kind].duration;
        const number = event.number
          ? { ...event.number, hintsAt: now + NUMBER_HINT_AFTER }
          : undefined;
        const message = await channel.send({
          ...buildCard({ ...event, closesAt, number }, now),
          nonce: id.replace(/-/g, "").slice(0, 24),
          enforceNonce: true,
          files: file ? [file] : [],
        });
        store.update((state) =>
          Object.assign(state.contests[id], {
            phase: "open",
            messageId: message.id,
            closesAt,
            number,
          })
        );
      } else {
        const now = Date.now();
        if (event.phase === "open" && event.closesAt <= now)
          event = settleContest(store, id, undefined, now);
        if (event.phase !== "closed" || event.published) return;
        while (event.reward && event.winner && !event.paid) {
          const winner = event.winner;
          try {
            await contestApi({
              action: "award",
              contestId: id,
              discordId: winner,
            });
            event = store.update((state) =>
              Object.assign(state.contests[id], { paid: true })
            );
          } catch (error) {
            if (
              event.automaticDraw &&
              error instanceof ContestApiError &&
              error.code === "winner_not_linked"
            ) {
              event = redrawUnlinkedWinner(store, id, winner);
            } else {
              await refresh(event).catch(() => undefined);
              throw error;
            }
          }
        }
        if (event.automaticDraw && !event.messageId) {
          const channel = await getChannel(event.channelId);
          const { files, ...card } = buildCard(event, now);
          const message = await channel.send({
            ...card,
            files,
            nonce: id.replace(/-/g, "").slice(0, 24),
            enforceNonce: true,
          });
          event = store.update((state) =>
            Object.assign(state.contests[id], { messageId: message.id })
          );
        } else {
          await refresh(event);
        }
        if (
          event.kind === "games" &&
          event.rounds?.length &&
          options.levelRoles.length
        ) {
          const channel = await getChannel(event.channelId);
          for (const id of event.entries) {
            try {
              const member = await channel.guild.members.fetch(id);
              if (isVerified(member)) await syncLevelRoles(member);
            } catch (error) {
              console.error("[Konkursy: role]", error);
            }
          }
        }
        store.update((state) => {
          state.contests[id].published = true;
        });
      }
    } finally {
      processing.delete(id);
    }
  }

  function findActive(kind: ContestKind) {
    return Object.values(store.read().contests).find(
      (event) => event.kind === kind && event.phase !== "closed"
    );
  }

  async function start(
    kind: ContestKind,
    max = 1000,
    scheduled?: ScheduledContest
  ) {
    const channelId = options.channels[kind];
    if (!channelId)
      throw new Error("Brak ustawionego kanału dla tego konkursu.");
    const existing = findActive(kind);
    const slot = kind === "daily" ? getScheduleSlot("daily", Date.now()) : null;
    const dailyPlan = store.read().plans.daily;
    if (!existing && slot && dailyPlan?.key === slot.key && dailyPlan.started)
      throw new Error("Dzisiejsze losowanie zostało już rozliczone.");
    if (existing?.phase === "open") throw new Error("Ten konkurs już trwa.");
    const event =
      existing ??
      store.update((state) => {
        const draft: Contest = {
          id: randomUUID(),
          kind,
          channelId,
          phase: "draft",
          closesAt: 0,
          entries: [],
          automaticDraw: kind === "daily" ? true : undefined,
        };
        if (kind === "numbers")
          draft.number = {
            max,
            target: randomInt(1, max + 1),
            hintsAt: 0,
            guesses: {},
          };
        state.contests[draft.id] = draft;
        const plan = scheduled ? state.plans[scheduled] : null;
        if (plan) plan.started = true;
        if (slot)
          state.plans.daily = {
            key: slot.key,
            minute: slot.minuteOfDay,
            started: true,
          };
        return draft;
      });
    if (processing.has(event.id))
      throw new Error("Bot już przygotowuje ten konkurs.");
    await processEvent(event.id);
    return store.read().contests[event.id];
  }

  async function readGuess(message: Message<true>, event: Contest) {
    const id = message.author.id;
    const now = Date.now();
    const answer = message.content.trim();
    if (event.closesAt <= now) return;
    if (event.number) {
      if (
        !/^\d{1,4}$/.test(answer) ||
        Number(answer) < 1 ||
        Number(answer) > event.number.max ||
        now - (event.number.guesses[id] ?? 0) < GUESS_COOLDOWN
      )
        return;
      store.update((state) => {
        state.contests[event.id].number!.guesses[id] = now;
      });
      if (Number(answer) !== event.number.target) return;
    } else if (
      !event.pokemon ||
      normalizePokemonGuess(answer) !==
        normalizePokemonGuess(event.pokemon.name)
    ) {
      return;
    }
    settleContest(store, event.id, id, now);
    if (event.pokemon && message.member) {
      void syncLevelRoles(message.member).catch((error) =>
        console.error("[Konkursy: role]", error)
      );
    }
    await processEvent(event.id);
  }

  client.on(Events.MessageCreate, async (message) => {
    if (
      !message.inGuild() ||
      message.guildId !== options.guildId ||
      !isVerified(message.member)
    )
      return;
    try {
      const event = Object.values(store.read().contests).find(
        (contest) =>
          contest.channelId === message.channelId &&
          contest.phase === "open" &&
          (contest.number || contest.pokemon)
      );
      if (event) await readGuess(message, event);
    } catch (error) {
      console.error("[Konkursy: wiadomość]", error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.guildId !== options.guildId) return;
    try {
      if (interaction.inCachedGuild() && collection) {
        if (
          interaction.isChatInputCommand() &&
          (await collection.command(interaction))
        )
          return;
        if (interaction.isButton() && (await collection.button(interaction)))
          return;
      }
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "aktywnosc"
      ) {
        const activity = getActivity(interaction.user.id);
        const enrolled = Boolean(
          store.read().enrolledPlayers?.[interaction.user.id]
        );
        await interaction.reply({
          content: [
            `**Wygrane** ${formatNumber.format(
              activity.duelWins ?? 0
            )} · **Przegrane** ${formatNumber.format(
              activity.duelLosses ?? 0
            )}`,
            `**Pula pojedynków i losowań** ${
              enrolled ? "bierzesz udział" : "wpisz /dolacz, aby dołączyć"
            }`,
          ].join("\n"),
          flags: MessageFlags.Ephemeral,
        });
      } else if (
        interaction.isChatInputCommand() &&
        ["dolacz", "opusc"].includes(interaction.commandName)
      ) {
        const joining = interaction.commandName === "dolacz";
        if (
          joining &&
          (!interaction.inCachedGuild() || !isVerified(interaction.member))
        ) {
          await interaction.reply({
            content: "Połącz konto PokeGlory komendą /link.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        setContestParticipation(store, interaction.user.id, joining);
        await interaction.reply({
          content: joining
            ? "Jesteś w puli pojedynków i codziennego losowania. Udział możesz wyłączyć komendą /opusc."
            : "Wypisano Cię z puli pojedynków i codziennego losowania.",
          flags: MessageFlags.Ephemeral,
        });
      } else if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "pojedynek"
      ) {
        const me = interaction.user.id;
        const reply = (content: string) =>
          interaction.deferred
            ? interaction.editReply(content)
            : interaction.reply({ content, flags: MessageFlags.Ephemeral });
        if (
          !options.duelChannel ||
          interaction.channelId !== options.duelChannel
        ) {
          if (options.duelChannel)
            await reply(`Wpisz /pojedynek na <#${options.duelChannel}>.`);
          return;
        }
        if (!interaction.inCachedGuild() || !isVerified(interaction.member)) {
          await reply("Połącz konto PokeGlory komendą /link.");
          return;
        }
        if (!store.read().enrolledPlayers?.[me]) {
          await reply("Najpierw wpisz /dolacz, żeby wejść do puli pojedynków.");
          return;
        }
        if (!getOwnedCards(store.read().collection, me).length) {
          await reply(firstCardHint(options.collectionChannel));
          return;
        }
        const lastDuel = getActivity(me).lastPlayerDuelAt;
        if (
          lastDuel !== undefined &&
          lastDuel + PLAYER_DUEL_COOLDOWN > Date.now()
        ) {
          await reply(
            describeDuelFailure(
              {
                status: "cooldown",
                playerId: me,
                availableAt: lastDuel + PLAYER_DUEL_COOLDOWN,
              },
              me
            )
          );
          return;
        }
        const target = interaction.options.getUser("gracz");
        let opponent = target ? interaction.options.getMember("gracz") : null;
        if (!target) {
          const candidates = getDuelPool(store, me);
          if (candidates.length) {
            await interaction.deferReply();
            opponent = await findRandomOpponent(interaction.guild, candidates);
          }
        }
        if (!opponent || !isVerified(opponent)) {
          await reply(
            target
              ? "Wybierz gracza z połączonym kontem."
              : "Brak dostępnego przeciwnika z kartą w puli. Spróbuj później."
          );
          return;
        }
        const duel = playPlayerDuel(store, me, opponent.id);
        if (duel.status !== "played") {
          await reply(describeDuelFailure(duel, me, options.collectionChannel));
          return;
        }
        const embed = new EmbedBuilder()
          .setTitle("Wynik pojedynku")
          .setColor(0x36b28c)
          .setDescription(
            `**Wygrywa <@${duel.winnerId}>.**\nSzanse w kolejności graczy: ${
              duel.challengerChance
            }% do ${100 - duel.challengerChance}%.`
          );
        const fighterCards = (
          [
            [duel.challengerId, duel.challengerPokemon],
            [duel.opponentId, duel.opponentPokemon],
          ] as const
        ).map(([id, pokemon]) => {
          const fighter = new EmbedBuilder()
            .setColor(0x36b28c)
            .setTitle(pokemon.name)
            .setDescription(`<@${id}> · ${pokemon.rarity}`);
          const imageUrl = getCardImageUrl(pokemon.name);
          if (imageUrl) fighter.setThumbnail(imageUrl);
          return fighter;
        });
        const result = {
          embeds: [embed, ...fighterCards],
          allowedMentions: { parse: [] as never[] },
        };
        if (interaction.deferred) await interaction.editReply(result);
        else await interaction.reply(result);
        for (const member of [interaction.member, opponent])
          void syncLevelRoles(member).catch((error) =>
            console.error("[Konkursy: role]", error)
          );
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith(DUEL_CHALLENGE_PREFIX)
      ) {
        await interaction.reply({
          content:
            "To wyzwanie jest zamknięte. Wpisz /dolacz, a potem użyj /pojedynek.",
          flags: MessageFlags.Ephemeral,
        });
        if (interaction.message.author.id === client.user.id)
          await interaction.message
            .edit({ components: [] })
            .catch(() => undefined);
      } else if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "konkurs"
      ) {
        if (
          !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)
        ) {
          await interaction.reply({
            content: "Ta komenda jest dostępna dla administracji.",
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        const kind = interaction.options.getString(
          "rodzaj",
          true
        ) as ContestKind;
        if (!kinds.includes(kind)) return;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const event = await start(
          kind,
          interaction.options.getInteger("zakres") ?? 1000
        );
        await interaction.editReply(
          kind === "daily"
            ? `Losowanie rozliczone na <#${event.channelId}>.`
            : `Konkurs otwarty na <#${event.channelId}>.`
        );
      } else if (
        interaction.isButton() &&
        interaction.customId.startsWith(PREFIX)
      ) {
        const [, action, id] = interaction.customId.split(":");
        const event = store.read().contests[id];
        let reply: string;
        let participants: AttachmentBuilder | null = null;
        if (
          !event ||
          event.messageId !== interaction.message.id ||
          event.channelId !== interaction.channelId
        ) {
          reply = "Nie znaleziono tego konkursu.";
        } else if (action === "entries") {
          reply = event.entries.length
            ? event.entries.map((user) => `<@${user}>`).join(", ")
            : "Brak zapisanych uczestników.";
          if (reply.length > 2000) {
            participants = new AttachmentBuilder(
              Buffer.from(event.entries.join("\n")),
              { name: "uczestnicy.txt" }
            );
            reply = `**Zapisani** ${event.entries.length}. Identyfikatory Discord są w załączniku.`;
          }
        } else if (event.phase !== "open" || Date.now() >= event.closesAt) {
          reply = "Zapisy są już zamknięte.";
        } else {
          const member = interaction.inCachedGuild()
            ? interaction.member
            : null;
          const userId = interaction.user.id;
          const eligibility = getContestEligibility(
            event.kind,
            getActivity(userId),
            getContestWeek(Date.now())
          );
          if (!isVerified(member))
            reply = "Połącz konto PokeGlory komendą /link.";
          else if (
            event.kind === "games" &&
            !getOwnedCards(store.read().collection, userId).length
          )
            reply = firstCardHint(options.collectionChannel);
          else if (eligibility) reply = eligibility;
          else if (event.entries.includes(userId))
            reply = "Masz już zapis na ten konkurs.";
          else {
            store.update((state) => {
              state.contests[id].entries.push(userId);
            });
            reply =
              event.kind === "games"
                ? "Dołączyłeś do turnieju. RotomBot rozegra pojedynki po zamknięciu zapisów."
                : event.kind === "daily"
                ? "Zapisano Cię do dziennego losowania."
                : "Zapisano Cię na konkurs.";
          }
        }
        await interaction.reply({
          content: reply,
          flags: MessageFlags.Ephemeral,
          files: participants ? [participants] : [],
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      console.error("[Konkursy: interakcja]", error);
      if (interaction.isRepliable()) {
        const content =
          error instanceof ContestApiError &&
          error.code === "reward_not_configured"
            ? "Ustaw nagrodę dla tego konkursu w konfiguracji gry."
            : "Nie udało się obsłużyć konkursu. Spróbuj ponownie lub sprawdź logi bota.";
        if (interaction.deferred)
          await interaction.editReply(content).catch(() => undefined);
        else if (!interaction.replied)
          await interaction
            .reply({ content, flags: MessageFlags.Ephemeral })
            .catch(() => undefined);
      }
    }
  });

  let ticking = false;
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      for (const event of Object.values(store.read().contests)) {
        try {
          if (event.phase === "open" && event.closesAt > now) {
            const showEntries =
              hasSignups(event) &&
              event.entries.length !== (event.displayedEntries ?? 0);
            const showHint =
              event.number && now >= event.number.hintsAt && !event.hintShown;
            if (showEntries || showHint) {
              await refresh(event);
              store.update((state) => {
                state.contests[event.id].displayedEntries =
                  event.entries.length;
                if (showHint) state.contests[event.id].hintShown = true;
              });
            }
          } else if (
            !event.published &&
            now - (event.lastAttemptAt ?? 0) >= 60_000
          ) {
            store.update((state) => {
              state.contests[event.id].lastAttemptAt = now;
            });
            await processEvent(event.id);
          }
        } catch (error) {
          console.error(`[Konkursy: ${event.kind}]`, error);
        }
      }

      const oldResults = Object.values(store.read().contests).filter(
        (event) => event.published && now - event.closesAt > 30 * 86_400_000
      );
      if (oldResults.length) {
        store.update((state) => {
          for (const event of oldResults) delete state.contests[event.id];
        });
      }

      await collection?.expireMessages(now);
      if (options.automatic) {
        for (const kind of SCHEDULED_CONTESTS) {
          if (!options.channels[kind]) continue;
          const slot = getScheduleSlot(kind, now);
          if (!slot || slot.minuteOfDay < 14 * 60) continue;
          if (kind === "daily" && slot.minuteOfDay < DAILY_DRAW_START_MINUTE)
            continue;
          if (kind !== "daily" && slot.minuteOfDay >= 22 * 60) continue;

          const current = store.read().plans[kind];
          const plan =
            current?.key === slot.key
              ? current
              : store.update(
                  (state) =>
                    (state.plans[kind] = {
                      key: slot.key,
                      minute:
                        kind === "daily"
                          ? DAILY_DRAW_START_MINUTE
                          : randomInt(14 * 60, 21 * 60 + 1),
                      started: false,
                    })
                );
          if (
            plan.started ||
            (kind !== "daily" && slot.minuteOfDay < plan.minute) ||
            findActive(kind)
          )
            continue;
          await start(kind, 1000, kind).catch((error) =>
            console.error(`[Konkursy: harmonogram ${kind}]`, error)
          );
        }
      }
    } finally {
      ticking = false;
    }
  }

  const runTick = () => {
    void tick().catch((error) =>
      console.error("[Konkursy: harmonogram]", error)
    );
  };
  runTick();
  setInterval(runTick, 15_000).unref();
}
