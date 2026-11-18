import {
  ActionRowBuilder,
  ApplicationCommandOptionType as Option,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  type ButtonInteraction,
  type ChatInputApplicationCommandData,
  type ChatInputCommandInteraction,
  type Client,
  DiscordAPIError,
  EmbedBuilder,
  type GuildMember,
  InteractionContextType,
  MessageFlags,
} from "discord.js";
import { config } from "../config";
import {
  acceptCardTrade,
  cardByName,
  CARD_PRIORITY_MS,
  claimCard,
  type CardDrop,
  type CardTrade,
  findCard,
  getCollectionLimits,
  proposeCardTrade,
  rollCard,
  setCardWish,
} from "./collection";
import type { ContestStore } from "./store";

const PREFIX = "pg-card:";
const PAGE_SIZE = 12;
const CARD_COLOR = 0x36b28c;

const guild = { contexts: [InteractionContextType.Guild] };
export const collectionCommands: ChatInputApplicationCommandData[] = [
  {
    ...guild,
    name: "losuj",
    description: "Wylosuj kartę Pokémona na kanale kolekcji.",
  },
  {
    ...guild,
    name: "kolekcja",
    description: "Pokaż karty i limity kolekcji.",
    options: [
      {
        name: "gracz",
        description: "Czyją kolekcję pokazać?",
        type: Option.User,
      },
      {
        name: "strona",
        description: "Numer strony kolekcji.",
        type: Option.Integer,
        minValue: 1,
      },
      {
        name: "pokemon",
        description: "Pokaż grafikę konkretnej karty z kolekcji.",
        type: Option.String,
        maxLength: 80,
      },
    ],
  },
  {
    ...guild,
    name: "zyczenia",
    description: "Pokaż lub zmień listę Pokémonów, na które polujesz.",
    options: [
      {
        name: "akcja",
        description: "Dodaj albo usuń Pokémona.",
        type: Option.String,
        choices: [
          { name: "Dodaj", value: "add" },
          { name: "Usuń", value: "remove" },
        ],
      },
      {
        name: "pokemon",
        description: "Nazwa Pokémona, np. Crystal Onix.",
        type: Option.String,
        maxLength: 80,
      },
    ],
  },
  {
    ...guild,
    name: "wymiana",
    description: "Zaproponuj wymianę kart innemu graczowi.",
    options: [
      {
        name: "gracz",
        description: "Z kim chcesz się wymienić?",
        type: Option.User,
        required: true,
      },
      {
        name: "oddaje",
        description: "Nazwa karty, którą dajesz.",
        type: Option.String,
        required: true,
        maxLength: 80,
      },
      {
        name: "za",
        description: "Nazwa karty, którą chcesz dostać.",
        type: Option.String,
        required: true,
        maxLength: 80,
      },
    ],
  },
];
const commandNames = new Set(collectionCommands.map(({ name }) => name));
const relative = (time: number) => `<t:${Math.ceil(time / 1000)}:R>`;
type CardAction = "drop" | "trade";

export function getCardImageUrl(name: string) {
  const path = cardByName.get(name)?.imagePath;
  return path ? new URL(path, config.POKEGLORY_PUBLIC_URL).href : undefined;
}

function cardEmbed(name: string) {
  const embed = new EmbedBuilder().setTitle(name).setColor(CARD_COLOR);
  const imageUrl = getCardImageUrl(name);
  if (imageUrl) embed.setImage(imageUrl);
  return embed;
}

function dropEmbed(drop: CardDrop, now = Date.now()) {
  const card = cardByName.get(drop.card);
  return cardEmbed(drop.card).setDescription(
    [
      card && `**${card.rarity}**`,
      drop.claimedBy
        ? `Złapany przez <@${drop.claimedBy}>.`
        : now >= drop.expiresAt
        ? "Pokémon uciekł."
        : `<@${drop.rollerId}> ma pierwszeństwo do ${relative(
            drop.createdAt + CARD_PRIORITY_MS
          )}. Karta znika ${relative(drop.expiresAt)}.`,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function tradeEmbed(trade: CardTrade, now = Date.now()) {
  return new EmbedBuilder()
    .setTitle(trade.accepted ? "Wymiana zakończona" : "Wymiana kart")
    .setColor(CARD_COLOR)
    .setDescription(
      `<@${trade.from}> oddaje **${trade.offer}**, a <@${trade.to}> oddaje **${trade.request}**.\n` +
        (trade.accepted
          ? "Karty trafiły do nowych kolekcji."
          : now >= trade.expiresAt
          ? "Oferta wygasła."
          : `Propozycja wygasa ${relative(trade.expiresAt)}.`)
    );
}

function actionButton(action: CardAction, id: string, label: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PREFIX}${action}:${id}`)
      .setLabel(label)
      .setStyle(ButtonStyle.Success)
  );
}

function trackedMessage(store: ContestStore, action: CardAction, id: string) {
  const state = store.read().collection;
  return action === "drop" ? state?.drops[id] : state?.trades[id];
}

function setMessageId(
  store: ContestStore,
  action: CardAction,
  id: string,
  messageId: string
) {
  if (trackedMessage(store, action, id)?.messageId === messageId) return;
  store.update((state) => {
    const message =
      action === "drop"
        ? state.collection?.drops[id]
        : state.collection?.trades[id];
    if (message) message.messageId = messageId;
  });
}

function forgetMessage(store: ContestStore, action: CardAction, id: string) {
  if (!trackedMessage(store, action, id)) return;
  store.update((state) => {
    if (action === "drop") delete state.collection?.drops[id];
    else delete state.collection?.trades[id];
  });
}

export function createCollectionHandlers(
  client: Client<true>,
  store: ContestStore,
  guildId: string,
  channelId: string,
  isVerified: (member: GuildMember | null) => boolean
) {
  async function command(interaction: ChatInputCommandInteraction<"cached">) {
    if (!commandNames.has(interaction.commandName)) return false;
    const me = interaction.user.id;
    const reply = (content: string) =>
      interaction.reply({
        content,
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    if (!isVerified(interaction.member)) {
      await reply("Połącz konto PokeGlory komendą /link.");
      return true;
    }
    if (
      interaction.channelId !== channelId &&
      interaction.commandName !== "kolekcja"
    ) {
      await reply(`Użyj tej komendy na <#${channelId}>.`);
      return true;
    }

    switch (interaction.commandName) {
      case "losuj": {
        const result = rollCard(store, interaction.id, channelId, me);
        if (result.status === "duplicate") {
          await reply("To losowanie zostało już obsłużone.");
          break;
        }
        if (result.status === "limit") {
          await reply(
            `Następne losowanie dostępne ${relative(result.availableAt)}.`
          );
          break;
        }
        const { drop } = result;
        const wishers = Object.entries(store.read().collection?.players ?? {})
          .filter(
            ([id, player]) =>
              id !== me &&
              player.wishes.includes(drop.card) &&
              isVerified(interaction.guild.members.cache.get(id) ?? null)
          )
          .slice(0, 10)
          .map(([id]) => id);
        const response = await interaction.reply({
          content: wishers.length
            ? `Na liście życzeń: ${wishers.map((id) => `<@${id}>`).join(" ")}`
            : undefined,
          embeds: [dropEmbed(drop)],
          components: [actionButton("drop", drop.id, "Złap")],
          allowedMentions: { parse: [], users: wishers },
          withResponse: true,
        });
        const message =
          response.resource?.message ?? (await interaction.fetchReply());
        setMessageId(store, "drop", drop.id, message.id);
        break;
      }
      case "kolekcja": {
        const user = interaction.options.getUser("gracz") ?? interaction.user;
        const inventory =
          store.read().collection?.players[user.id]?.cards ?? {};
        const name = interaction.options.getString("pokemon");
        if (name) {
          const card = findCard(name);
          const quantity = card ? inventory[card.name] : 0;
          if (!card || !quantity) {
            await reply("Nie ma tej karty w wybranej kolekcji.");
            break;
          }
          await interaction.reply({
            embeds: [
              cardEmbed(card.name).setDescription(
                `**${card.rarity}** · ${quantity} szt. w kolekcji gracza ${user.displayName}`
              ),
            ],
            flags: MessageFlags.Ephemeral,
          });
          break;
        }
        const cards = Object.entries(inventory).sort(([first], [second]) =>
          first.localeCompare(second, "pl")
        );
        const total = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
        const page = Math.min(
          total,
          interaction.options.getInteger("strona") ?? 1
        );
        const lines = cards
          .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
          .map(
            ([name, count]) =>
              `**${name}** · ${cardByName.get(name)?.rarity ?? "Karta"}${
                count > 1 ? ` ×${count}` : ""
              }`
          );
        if (user.id === me) {
          const { rollsLeft, nextRollAt, nextClaimAt } = getCollectionLimits(
            store,
            me
          );
          lines.push(
            "",
            nextRollAt
              ? `Następne losowanie ${relative(nextRollAt)}.`
              : `Losowania dostępne: **${rollsLeft}**.`,
            nextClaimAt
              ? `Następne złapanie ${relative(nextClaimAt)}.`
              : "Możesz złapać jedną kartę."
          );
        }
        if (cards.length === 0) lines.unshift("Kolekcja jest pusta.");
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(CARD_COLOR)
              .setTitle(`Kolekcja gracza ${user.displayName}`)
              .setDescription(lines.join("\n"))
              .setFooter({
                text: `Strona ${page}/${total} · ${cards.length}/${cardByName.size} różnych kart`,
              }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        break;
      }
      case "zyczenia": {
        const action = interaction.options.getString("akcja");
        if (!action) {
          const wishes = store.read().collection?.players[me]?.wishes ?? [];
          await reply(
            wishes.length
              ? `**Twoja lista życzeń**\n${wishes.join(", ")}`
              : "Lista życzeń jest pusta. Dodaj Pokémona komendą /zyczenia."
          );
          break;
        }
        const card = findCard(interaction.options.getString("pokemon") ?? "");
        if (!card) {
          await reply("Podaj nazwę Pokémona z puli kart.");
          break;
        }
        const enabled = action === "add";
        const status = setCardWish(store, me, card.name, enabled);
        await reply(
          status === "limit"
            ? "Na liście może być maksymalnie 10 Pokémonów."
            : status === "unchanged"
            ? "Lista życzeń już ma ten stan."
            : enabled
            ? `**${card.name}** na liście życzeń. Bot może oznaczyć Cię przy losowaniu tej karty.`
            : `**${card.name}** znika z listy życzeń.`
        );
        break;
      }
      case "wymiana": {
        const target = interaction.options.getUser("gracz", true);
        const offer = findCard(interaction.options.getString("oddaje", true));
        const request = findCard(interaction.options.getString("za", true));
        if (
          !offer ||
          !request ||
          !isVerified(interaction.options.getMember("gracz"))
        ) {
          await reply(
            "Wybierz gracza z połączonym kontem i podaj nazwy obu kart."
          );
          break;
        }
        const result = proposeCardTrade(store, {
          id: interaction.id,
          channelId,
          from: me,
          to: target.id,
          offer: offer.name,
          request: request.name,
        });
        if (result.status !== "created") {
          await reply(
            result.status === "pending"
              ? "Masz już otwartą wymianę."
              : result.status === "missing_card"
              ? "Jednej z kart brakuje w kolekcji graczy."
              : "Wybierz drugiego gracza i dwie różne karty."
          );
          break;
        }
        const { trade } = result;
        const response = await interaction.reply({
          content: `<@${target.id}>`,
          embeds: [tradeEmbed(trade)],
          components: [actionButton("trade", trade.id, "Akceptuj wymianę")],
          allowedMentions: { parse: [], users: [target.id] },
          withResponse: true,
        });
        const message =
          response.resource?.message ?? (await interaction.fetchReply());
        setMessageId(store, "trade", trade.id, message.id);
        break;
      }
    }
    return true;
  }

  async function button(interaction: ButtonInteraction<"cached">) {
    if (!interaction.customId.startsWith(PREFIX)) return false;
    const [, action, id] = interaction.customId.split(":");
    const reply = (content: string) =>
      interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (
      interaction.channelId !== channelId ||
      (action !== "drop" && action !== "trade")
    ) {
      await reply("Ten przycisk jest niedostępny.");
      return true;
    }
    const record = trackedMessage(store, action, id);
    if (
      interaction.message.author.id !== client.user.id ||
      (record?.messageId && interaction.message.id !== record.messageId)
    ) {
      await reply("Ten przycisk jest niedostępny.");
      return true;
    }
    if (!record || record.expiresAt <= Date.now()) {
      await reply("Czas na tę akcję minął.");
      if (!record)
        await interaction.message
          .edit({ components: [] })
          .catch(() => undefined);
      return true;
    }
    if (!isVerified(interaction.member)) {
      await reply("Połącz konto PokeGlory komendą /link.");
      return true;
    }

    const me = interaction.user.id;
    if (action === "drop") {
      const result = claimCard(store, id, me);
      if (result.status === "caught") {
        await interaction.update({
          embeds: [dropEmbed(result.drop)],
          components: [],
          allowedMentions: { parse: [] },
        });
        forgetMessage(store, action, id);
      } else {
        await reply(
          result.status === "limit"
            ? `Kolejną kartę możesz złapać ${relative(result.availableAt)}.`
            : result.status === "priority"
            ? `Pierwszeństwo losującego kończy się ${relative(
                result.availableAt
              )}.`
            : "Tej karty nie można już złapać."
        );
      }
    } else {
      const result = acceptCardTrade(store, id, me);
      if (result.status === "traded") {
        await interaction.update({
          content: null,
          embeds: [tradeEmbed(result.trade)],
          components: [],
          allowedMentions: { parse: [] },
        });
        forgetMessage(store, action, id);
      } else {
        await reply(
          result.status === "restricted"
            ? "Tylko zaproszony gracz może zaakceptować wymianę."
            : result.status === "missing_card"
            ? "Jednej z kart brakuje w kolekcji graczy."
            : "Ta wymiana jest już zamknięta."
        );
      }
    }
    return true;
  }

  async function expireMessages(now: number) {
    const set = store.read().collection;
    if (!set) return;
    const pending = [
      ...Object.values(set.drops)
        .filter((drop) => drop.claimedBy || drop.expiresAt <= now)
        .map((drop) => ({
          type: "drop" as const,
          entry: drop,
          embed: () => dropEmbed(drop, now),
        })),
      ...Object.values(set.trades)
        .filter((trade) => trade.accepted || trade.expiresAt <= now)
        .map((trade) => ({
          type: "trade" as const,
          entry: trade,
          embed: () => tradeEmbed(trade, now),
        })),
    ];
    for (const { type, entry, embed } of pending.slice(0, 20)) {
      if (!entry.messageId) {
        forgetMessage(store, type, entry.id);
        continue;
      }
      try {
        const channel = await client.channels.fetch(entry.channelId);
        if (
          channel?.type === ChannelType.GuildText &&
          channel.guildId === guildId
        ) {
          await channel.messages.edit(entry.messageId, {
            embeds: [embed()],
            components: [],
            allowedMentions: { parse: [] },
          });
        }
        forgetMessage(store, type, entry.id);
      } catch (error) {
        if (
          error instanceof DiscordAPIError &&
          [10003, 10008, 50001].includes(Number(error.code))
        ) {
          forgetMessage(store, type, entry.id);
        } else {
          console.error("[Kolekcja: zamykanie karty]", error);
        }
      }
    }
  }
  return { command, button, expireMessages };
}
