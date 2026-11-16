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
  type Message,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { config } from "../config";
import {
  CONTEST_RULES,
  type ContestKind,
  type ContestPlanKey,
  type DuelMatch,
  DUEL_XP,
  EMPTY_ACTIVITY,
  getContestEligibility,
  getContestLevel,
  getContestWeek,
  getDuelScheduleWindow,
  getScheduleSlot,
  getWeeklyXp,
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
  settleContest,
  type Reward,
} from "./store";

const PREFIX = "pg-contest:";
const DUEL_SIGNUP_LABEL = "Dołącz do turnieju";
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;
const kinds = Object.keys(CONTEST_RULES) as ContestKind[];
const formatNumber = new Intl.NumberFormat("pl-PL");

function readOptions() {
  if (!process.env.POKEGLORY_CONTESTS?.trim()) return null;
  const parsed = JSON.parse(process.env.POKEGLORY_CONTESTS) as {
    channels?: Partial<Record<ContestKind, string>>;
    levelRoles?: Record<string, string>;
    automatic?: boolean;
  };
  const isId = (id: unknown): id is string =>
    typeof id === "string" && /^\d{16,22}$/.test(id);
  if (
    !config.POKEGLORY_GUILD_ID ||
    !config.POKEGLORY_DISCORD_BOT_SECRET ||
    !parsed.channels ||
    !Object.keys(parsed.channels).length ||
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
  if (parsed.channels.daily && !parsed.channels.games) {
    throw new Error("Dzienne losowanie wymaga kanału pojedynków.");
  }
  return {
    guildId: config.POKEGLORY_GUILD_ID,
    channels: parsed.channels,
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
    description: "Pokaż poziom i XP zdobyte na Discordzie.",
  },
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
          .map((kind) => ({ name: CONTEST_RULES[kind].title, value: kind })),
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
  return reward
    ? `${formatNumber.format(reward.amount)} ${
        reward.currency === "yen" ? "¥" : "PZ"
      }`
    : "—";
}

function hasSignups(event: Contest) {
  return event.kind !== "numbers" && event.kind !== "pokemon";
}

function describeDuel(event: Contest, duel: DuelMatch, mentions: boolean) {
  const display = (id: string) => {
    const player = mentions ? `<@${id}>` : id;
    const pokemon = event.duelPokemon?.[id];
    if (!pokemon) return player;
    const label =
      typeof pokemon === "string"
        ? pokemon
        : `${pokemon.name}, ${pokemon.rarity}`;
    return `${player} (${label})`;
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
        ? "Do turnieju potrzeba co najmniej dwóch uczestników."
        : "Konkurs zakończony bez zwycięzcy."
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
          "RotomBot przydzieli Ci losowego Pokémona na cały turniej i dobierze pary 1 na 1.",
          `Rzadszy Pokémon ma większą szansę wygrać, maksymalnie ${MAX_DUEL_WIN_CHANCE}%. Zwycięzca przechodzi dalej.`,
          "Jeden rozegrany pojedynek odblokowuje dzienne losowania do końca tygodnia."
        );
      } else if (event.kind === "daily") {
        description.push(
          `Jeden pojedynek w tym tygodniu daje dostęp do losowania. Aby zawalczyć, kliknij **${DUEL_SIGNUP_LABEL}** pod ogłoszeniem **Turniej pojedynków**.`
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
        if (event.reward && event.winner && !event.paid) {
          try {
            await contestApi({
              action: "award",
              contestId: id,
              discordId: event.winner,
            });
            event = store.update((state) =>
              Object.assign(state.contests[id], { paid: true })
            );
          } catch (error) {
            await refresh(event).catch(() => undefined);
            throw error;
          }
        }
        await refresh(event);
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

  function getDuelSignupInstructions(now = Date.now()) {
    const channelId = options.channels.games;
    if (!channelId) return null;

    const tournament = findActive("games");
    const signup =
      tournament?.phase === "open" &&
      tournament.closesAt > now &&
      tournament.messageId
        ? `Kliknij **${DUEL_SIGNUP_LABEL}** w [otwartym turnieju](https://discord.com/channels/${options.guildId}/${tournament.channelId}/${tournament.messageId}).`
        : `Gdy pojawi się ogłoszenie **Turniej pojedynków** na <#${channelId}>, kliknij pod nim **${DUEL_SIGNUP_LABEL}**.`;
    return `${signup} Gdy zapiszą się co najmniej dwie osoby, RotomBot sam rozegra pojedynki po zamknięciu zapisów.`;
  }

  async function start(
    kind: ContestKind,
    max = 1000,
    scheduled?: ContestPlanKey
  ) {
    const channelId = options.channels[kind];
    if (!channelId)
      throw new Error("Brak ustawionego kanału dla tego konkursu.");
    const existing = findActive(kind);
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
      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "aktywnosc"
      ) {
        const activity = getActivity(interaction.user.id);
        const week = getContestWeek(Date.now());
        const weeklyXp = getWeeklyXp(activity, week);
        const playedDuel = activity.lastDuelWeek === week;
        const duelStatus = playedDuel ? "rozegrany" : "do rozegrania";
        const signupHelp = playedDuel ? null : getDuelSignupInstructions();
        await interaction.reply({
          content: `**Poziom Discorda** ${getContestLevel(
            activity.totalXp
          )}\n**Łączny XP** ${formatNumber.format(
            activity.totalXp
          )}\n**Poziom tygodniowy** ${getContestLevel(
            weeklyXp
          )}\n**Tygodniowy XP** ${formatNumber.format(
            weeklyXp
          )}\n**Pojedynek w tym tygodniu** ${duelStatus}${
            signupHelp ? `\n\n${signupHelp}` : ""
          }`,
          flags: MessageFlags.Ephemeral,
        });
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
          `Konkurs otwarty na <#${event.channelId}>.`
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
          else if (eligibility) {
            const signupHelp =
              event.kind === "daily" ? getDuelSignupInstructions() : null;
            reply = signupHelp
              ? `To są zapisy do losowania. ${eligibility}\n\n${signupHelp}`
              : eligibility;
          } else if (event.entries.includes(userId))
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

      if (options.automatic) {
        for (const kind of SCHEDULED_CONTESTS) {
          if (!options.channels[kind]) continue;
          const slot = getScheduleSlot(kind, now);
          if (!slot) continue;
          const duelWindow =
            kind === "games"
              ? getDuelScheduleWindow(slot.minuteOfDay)
              : undefined;
          if (
            kind === "games"
              ? !duelWindow
              : slot.minuteOfDay < 14 * 60 ||
                (slot.minuteOfDay >= 22 * 60 && kind !== "daily")
          )
            continue;

          const plans = store.read().plans;
          const tournament = plans.games;
          const daily = plans.daily;
          if (kind === "games" && daily?.key === slot.key && daily.started)
            continue;
          if (
            kind === "daily" &&
            (tournament?.key !== slot.key ||
              !tournament.started ||
              findActive("games"))
          )
            continue;

          const planKey = duelWindow?.key ?? kind;
          const current = plans[planKey];
          const minute =
            kind === "daily" && tournament ? tournament.minute : undefined;
          const plan =
            current?.key === slot.key &&
            (current.started ||
              !duelWindow ||
              (current.minute >= duelWindow.firstMinute &&
                current.minute <= duelWindow.lastMinute))
              ? current
              : store.update(
                  (state) =>
                    (state.plans[planKey] = {
                      key: slot.key,
                      minute:
                        minute ??
                        randomInt(
                          duelWindow?.firstMinute ?? 14 * 60,
                          (duelWindow?.lastMinute ?? 21 * 60) + 1
                        ),
                      started: false,
                    })
                );
          if (
            plan.started ||
            slot.minuteOfDay < (minute ?? plan.minute) ||
            findActive(kind)
          )
            continue;
          await start(kind, 1000, planKey).catch((error) =>
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
