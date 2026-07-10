import type {
  Client,
  Message,
  MessageReaction,
  ThreadChannel,
  User,
} from "discord.js";

import { config } from "./config";

const IDEA_REACTIONS = ["👍", "👎"] as const;
const STARTER_MESSAGE_RETRY_COUNT = 8;
const STARTER_MESSAGE_RETRY_DELAY_MS = 750;
const IDEA_EMBED_FOOTER_TEXT = "PokeGlory - Pomysły graczy";
const importingIdeaThreadIds = new Set<string>();

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDiscordChannelName(value: string) {
  return value.trim().toLowerCase();
}

function isIdeaChannelName(value: string) {
  const normalizedName = normalizeDiscordChannelName(value);
  const configuredName = normalizeDiscordChannelName(
    config.POKEGLORY_IDEAS_CHANNEL_NAME
  );

  return normalizedName === configuredName || normalizedName.includes("pomys");
}

function getDiscordAuthorName(message: Message) {
  return message.member?.displayName ?? message.author.username;
}

function isIdeaBotMessage(message: Message) {
  return message.embeds.some(
    (embed) => embed.footer?.text === IDEA_EMBED_FOOTER_TEXT
  );
}

async function isIdeaThread(thread: ThreadChannel) {
  const parent =
    thread.parent ??
    (thread.parentId
      ? await thread.client.channels.fetch(thread.parentId).catch(() => null)
      : null);
  const parentName =
    parent !== null && "name" in parent && typeof parent.name === "string"
      ? parent.name
      : null;
  const matchesConfiguredId =
    Boolean(config.POKEGLORY_IDEAS_CHANNEL_ID) &&
    thread.parentId === config.POKEGLORY_IDEAS_CHANNEL_ID;
  const matchesConfiguredName = parentName
    ? isIdeaChannelName(parentName)
    : false;

  if (matchesConfiguredId || matchesConfiguredName) {
    if (
      config.POKEGLORY_IDEAS_CHANNEL_ID &&
      !matchesConfiguredId &&
      matchesConfiguredName
    ) {
      console.warn(
        `[ideas] Post ${thread.id} pasuje po nazwie kanału, ale nie po POKEGLORY_IDEAS_CHANNEL_ID. parentId=${thread.parentId}, configured=${config.POKEGLORY_IDEAS_CHANNEL_ID}, parentName=${parentName}`
      );
    }

    return true;
  }

  console.info(
    `[ideas] Pominięto post ${thread.id}: parentId=${
      thread.parentId ?? "brak"
    }, parentName=${parentName ?? "brak"}, configuredId=${
      config.POKEGLORY_IDEAS_CHANNEL_ID ?? "brak"
    }, configuredName=${config.POKEGLORY_IDEAS_CHANNEL_NAME}`
  );

  return false;
}

async function fetchStarterMessage(thread: ThreadChannel) {
  for (let attempt = 1; attempt <= STARTER_MESSAGE_RETRY_COUNT; attempt += 1) {
    const starterMessage = await thread.fetchStarterMessage().catch(() => null);

    if (starterMessage) {
      return starterMessage;
    }

    if (attempt < STARTER_MESSAGE_RETRY_COUNT) {
      await wait(STARTER_MESSAGE_RETRY_DELAY_MS);
    }
  }

  return null;
}

async function addVotingReactions(message: Message) {
  console.info("[ideas] Automatyczne reakcje głosowania są wyłączone.");

  return message;
}

async function deleteUserStarterMessage(starterMessage: Message) {
  if (starterMessage.author.bot) {
    return;
  }

  await starterMessage
    .delete()
    .then(() => {
      console.info(
        `[ideas] Usunięto wiadomość startową użytkownika ${starterMessage.id}.`
      );
    })
    .catch((error: unknown) => {
      console.warn(
        `[ideas] Nie udało się usunąć wiadomości startowej użytkownika ${starterMessage.id}:`,
        error
      );
    });
}

async function createCanonicalIdeaMessage(
  thread: ThreadChannel,
  starterMessage: Message
) {
  return addVotingReactions(starterMessage);
}

async function addIdeaReactions(thread: ThreadChannel) {
  if (!(await isIdeaThread(thread))) {
    return null;
  }

  const starterMessage = await fetchStarterMessage(thread);

  if (!starterMessage) {
    console.warn(
      `[ideas] Nie udało się pobrać wiadomości startowej tematu ${thread.id}.`
    );
    return null;
  }

  return createCanonicalIdeaMessage(thread, starterMessage);
}

async function importIdeaThread(
  thread: ThreadChannel,
  starterMessage: Message,
  ideaMessage: Message
) {
  if (importingIdeaThreadIds.has(thread.id)) {
    console.info(
      `[ideas] Import posta ${thread.id} już trwa; pomijam zdublowany event.`
    );
    return true;
  }

  if (starterMessage.author.bot) {
    return false;
  }

  const description = starterMessage.content.trim();

  if (!description) {
    return false;
  }

  importingIdeaThreadIds.add(thread.id);

  try {
    const response = await fetch(
      `${config.POKEGLORY_API_URL}/api/discord/ideas`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET ?? "",
        },
        body: JSON.stringify({
          threadId: thread.id,
          messageId: ideaMessage.id,
          threadUrl: ideaMessage.url,
          title: thread.name,
          description,
          discordAuthorId: starterMessage.author.id,
          discordAuthorName: getDiscordAuthorName(starterMessage),
        }),
      }
    ).catch((error: unknown) => {
      console.warn("[ideas] Nie udało się wysłać pomysłu do gry:", error);
      return null;
    });

    if (!response?.ok) {
      const responseText = await response?.text().catch(() => "");

      console.warn(
        `[ideas] Gra nie przyjęła pomysłu z Discorda (${
          response?.status ?? "brak odpowiedzi"
        }): ${responseText}`
      );
      return false;
    }

    console.info(
      `[ideas] Pomysł z Discorda zapisany w grze: thread=${thread.id}, botMessage=${ideaMessage.id}`
    );

    return true;
  } finally {
    importingIdeaThreadIds.delete(thread.id);
  }
}

async function importIdeaOpinionMessage(message: Message) {
  if (message.author.bot) {
    return;
  }

  if (!message.channel.isThread()) {
    return;
  }

  const thread = message.channel;
  console.info(
    `[ideas] Otrzymano wiadomość w poście ${thread.id}; parent=${thread.parentId}; author=${message.author.id}; contentLength=${message.content.length}`
  );

  if (!(await isIdeaThread(thread))) {
    console.info(
      `[ideas] Pominięto wiadomość z posta ${thread.id}, bo to nie kanał pomysłów.`
    );
    return;
  }

  const starterMessage = await fetchStarterMessage(thread);

  if (starterMessage?.id === message.id) {
    const ideaMessage = await createCanonicalIdeaMessage(thread, message);
    const imported = await importIdeaThread(thread, message, ideaMessage);

    if (!imported) {
      console.warn(
        `[ideas] Starter message posta ${thread.id} nie został zapisany jako pomysł w grze.`
      );
    }

    return;
  }

  const content = message.content.trim();

  if (!content) {
    console.info(`[ideas] Pominięto pustą wiadomość w poście ${thread.id}.`);
    return;
  }

  console.info(
    `[ideas] Wysyłam opinię z Discorda do gry: thread=${thread.id}, message=${message.id}`
  );

  const response = await fetch(
    `${config.POKEGLORY_API_URL}/api/discord/ideas/opinions`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET ?? "",
      },
      body: JSON.stringify({
        threadId: thread.id,
        messageId: message.id,
        threadTitle: thread.name,
        threadUrl: message.url,
        content,
        discordAuthorId: message.author.id,
        discordAuthorName:
          message.member?.displayName ?? message.author.username,
      }),
    }
  ).catch((error: unknown) => {
    console.warn("[ideas] Nie udało się wysłać opinii do gry:", error);
    return null;
  });

  if (!response?.ok) {
    const responseText = await response?.text().catch(() => "");

    console.warn(
      `[ideas] Gra nie przyjęła opinii z Discorda (${
        response?.status ?? "brak odpowiedzi"
      }): ${responseText}`
    );
  }
}

async function syncIdeaOpinionMessageUpdate(message: Message) {
  if (message.author.bot) {
    return;
  }

  if (!message.channel.isThread()) {
    return;
  }

  const thread = message.channel;

  if (!(await isIdeaThread(thread))) {
    return;
  }

  const starterMessage = await fetchStarterMessage(thread);

  if (starterMessage?.id === message.id) {
    await importIdeaThread(thread, message, message);
    return;
  }

  const content = message.content.trim();

  if (!content) {
    return;
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL}/api/discord/ideas/opinions`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET ?? "",
      },
      body: JSON.stringify({
        threadId: thread.id,
        messageId: message.id,
        threadTitle: thread.name,
        threadUrl: message.url,
        content,
        discordAuthorId: message.author.id,
        discordAuthorName:
          message.member?.displayName ?? message.author.username,
      }),
    }
  ).catch((error: unknown) => {
    console.warn("[ideas] Nie udało się wysłać edycji opinii do gry:", error);
    return null;
  });

  if (!response?.ok) {
    const responseText = await response?.text().catch(() => "");

    console.warn(
      `[ideas] Gra nie przyjęła edycji opinii z Discorda (${
        response?.status ?? "brak odpowiedzi"
      }): ${responseText}`
    );
  }
}

async function syncIdeaOpinionMessageDelete(message: Message) {
  if (!message.channel.isThread()) {
    return;
  }

  const thread = message.channel;

  if (!(await isIdeaThread(thread))) {
    return;
  }

  const starterMessage = await fetchStarterMessage(thread);

  if (starterMessage?.id === message.id) {
    await syncIdeaThreadDelete(thread);
    return;
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL}/api/discord/ideas/opinions`,
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET ?? "",
      },
      body: JSON.stringify({
        threadId: thread.id,
        messageId: message.id,
      }),
    }
  ).catch((error: unknown) => {
    console.warn(
      "[ideas] Nie udało się wysłać usunięcia opinii do gry:",
      error
    );
    return null;
  });

  if (!response?.ok) {
    const responseText = await response?.text().catch(() => "");

    console.warn(
      `[ideas] Gra nie przyjęła usunięcia opinii z Discorda (${
        response?.status ?? "brak odpowiedzi"
      }): ${responseText}`
    );
  }
}

async function syncIdeaThreadDelete(thread: ThreadChannel) {
  if (!(await isIdeaThread(thread))) {
    return;
  }

  const response = await fetch(
    `${config.POKEGLORY_API_URL}/api/discord/ideas`,
    {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET ?? "",
      },
      body: JSON.stringify({
        threadId: thread.id,
      }),
    }
  ).catch((error: unknown) => {
    console.warn(
      "[ideas] Nie udało się wysłać usunięcia pomysłu do gry:",
      error
    );
    return null;
  });

  if (!response?.ok) {
    const responseText = await response?.text().catch(() => "");

    console.warn(
      `[ideas] Gra nie przyjęła usunięcia pomysłu z Discorda (${
        response?.status ?? "brak odpowiedzi"
      }): ${responseText}`
    );
  }
}

async function syncIdeaReaction(reaction: MessageReaction, user: User) {
  if (
    user.bot ||
    !IDEA_REACTIONS.includes(reaction.emoji.name as "👍" | "👎")
  ) {
    return;
  }

  const message = reaction.message.partial
    ? await reaction.message.fetch().catch(() => null)
    : reaction.message;

  if (!message?.channel?.isThread()) {
    return;
  }

  const thread = message.channel;

  if (!(await isIdeaThread(thread))) {
    return;
  }

  const starterMessage = await fetchStarterMessage(thread);
  const endpoint =
    starterMessage?.id === message.id || isIdeaBotMessage(message as Message)
      ? "/api/discord/ideas/reactions"
      : "/api/discord/ideas/opinions/reactions";
  const response = await fetch(`${config.POKEGLORY_API_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-discord-bot-secret": config.POKEGLORY_DISCORD_BOT_SECRET ?? "",
    },
    body: JSON.stringify({
      threadId: thread.id,
      messageId: message.id,
    }),
  }).catch((error: unknown) => {
    console.warn("[ideas] Nie udało się zsynchronizować reakcji z grą:", error);
    return null;
  });

  if (!response?.ok) {
    const responseText = await response?.text().catch(() => "");

    console.warn(
      `[ideas] Gra nie przyjęła synchronizacji reakcji (${
        response?.status ?? "brak odpowiedzi"
      }): ${responseText}`
    );
  }
}

export function startPlayerIdeaReactions(client: Client) {
  console.info(
    `[ideas] Start synchronizacji pomysłów. channelId=${
      config.POKEGLORY_IDEAS_CHANNEL_ID ?? "brak"
    }, channelName=${config.POKEGLORY_IDEAS_CHANNEL_NAME}, api=${
      config.POKEGLORY_API_URL
    }, secret=${config.POKEGLORY_DISCORD_BOT_SECRET ? "ustawiony" : "brak"}`
  );

  client.on("threadCreate", async (thread) => {
    console.info(
      `[ideas] threadCreate: id=${thread.id}, name=${thread.name}, parentId=${
        thread.parentId ?? "brak"
      }`
    );

    if (!(await isIdeaThread(thread))) {
      return;
    }

    const starterMessage = await fetchStarterMessage(thread).catch(() => null);

    if (!starterMessage) {
      console.warn(
        `[ideas] Nie udało się pobrać wiadomości startowej tematu ${thread.id}.`
      );
      return;
    }

    const ideaMessage = await createCanonicalIdeaMessage(
      thread,
      starterMessage
    ).catch((error: unknown) => {
      console.error("[ideas] Błąd obsługi nowego tematu pomysłu:", error);
      return null;
    });

    if (ideaMessage) {
      const imported = await importIdeaThread(
        thread,
        starterMessage,
        ideaMessage
      ).catch((error: unknown) => {
        console.error("[ideas] Błąd importu tematu pomysłu do gry:", error);
        return false;
      });

      if (!imported) {
        console.warn(
          `[ideas] Pomysł z Discorda nie został zapisany w grze: thread=${thread.id}`
        );
      }
    }
  });

  console.info("[ideas] Synchronizacja reakcji pomysłów i opinii jest wyłączona.");

  client.on("messageCreate", async (message) => {
    await importIdeaOpinionMessage(message).catch((error: unknown) => {
      console.error("[ideas] Błąd importu opinii z Discorda:", error);
    });
  });

  client.on("messageUpdate", async (_oldMessage, newMessage) => {
    const message = newMessage.partial
      ? await newMessage.fetch().catch(() => null)
      : newMessage;

    if (!message) {
      return;
    }

    await syncIdeaOpinionMessageUpdate(message as Message).catch(
      (error: unknown) => {
        console.error("[ideas] Błąd aktualizacji opinii z Discorda:", error);
      }
    );
  });

  client.on("messageDelete", async (deletedMessage) => {
    const message = deletedMessage.partial
      ? await deletedMessage.fetch().catch(() => deletedMessage)
      : deletedMessage;

    await syncIdeaOpinionMessageDelete(message as Message).catch(
      (error: unknown) => {
        console.error("[ideas] Błąd usunięcia opinii z Discorda:", error);
      }
    );
  });

  client.on("threadDelete", async (thread) => {
    await syncIdeaThreadDelete(thread as ThreadChannel).catch(
      (error: unknown) => {
        console.error("[ideas] Błąd usunięcia pomysłu z Discorda:", error);
      }
    );
  });
}
