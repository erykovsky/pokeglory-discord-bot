import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

const editchatlogCommand = {
  name: "editchatlog",
  description: "Edytuje konkretną wiadomość w ostatnim logu czatu na kanale.",
  options: [
    {
      name: "message_number",
      description: "Numer wiadomości w logu (1, 2, 3, 4, 5)",
      type: 4, // INTEGER type
      required: true,
    },
    {
      name: "new_content",
      description: "Nowa treść wiadomości",
      type: 3, // STRING type
      required: true,
    },
  ],
  async execute(interaction: ChatInputCommandInteraction) {
    // Sprawdź czy użytkownik ma uprawnienia do zarządzania wiadomościami
    if (
      !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)
    ) {
      return await interaction.reply({
        content: "❌ Nie masz uprawnień do edytowania wiadomości!",
        ephemeral: true,
      });
    }

    const messageNumber = interaction.options.getInteger("message_number");
    const newContent = interaction.options.getString("new_content");

    if (!messageNumber || !newContent) {
      return await interaction.reply({
        content: "❌ Musisz podać numer wiadomości i nową treść!",
        ephemeral: true,
      });
    }

    if (messageNumber < 1 || messageNumber > 5) {
      return await interaction.reply({
        content: "❌ Numer wiadomości musi być między 1 a 5!",
        ephemeral: true,
      });
    }

    try {
      // Pobierz kanał o ID 1416080627081412659
      const channel = interaction.guild?.channels.cache.get(
        "1416080627081412659"
      ) as TextChannel;
      if (!channel) {
        return await interaction.reply({
          content: "❌ Nie można znaleźć kanału o podanym ID!",
          ephemeral: true,
        });
      }

      // Pobierz ostatnie 10 wiadomości z kanału
      const messages = await channel.messages.fetch({ limit: 10 });

      // Znajdź ostatnią wiadomość bota z "Chat log"
      let targetMessage = null;
      for (const message of messages.values()) {
        if (
          message.author.id === interaction.client.user?.id &&
          message.content.includes("💬 **Chat log**")
        ) {
          targetMessage = message;
          break;
        }
      }

      if (!targetMessage) {
        return await interaction.reply({
          content: "❌ Nie znaleziono wiadomości z chat log na tym kanale!",
          ephemeral: true,
        });
      }

      // Pobierz obecną treść wiadomości
      const currentContent = targetMessage.content;

      // Podziel wiadomość na linie
      const lines = currentContent.split("\n");

      // Znajdź sekcję z wiadomością do edycji
      let messageStartIndex = -1;
      let messageEndIndex = -1;
      let currentMessageNumber = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Sprawdź czy to początek nowej wiadomości (zaczyna się od "> **")
        if (line.match(/^> \*\*.*\*\*\s*$/)) {
          currentMessageNumber++;

          if (currentMessageNumber === messageNumber) {
            messageStartIndex = i;
            // Znajdź koniec tej wiadomości (następna linia z "> **" lub koniec)
            for (let j = i + 1; j < lines.length; j++) {
              if (
                lines[j].match(/^> \*\*.*\*\*$/) ||
                lines[j].startsWith("---")
              ) {
                messageEndIndex = j - 1;
                break;
              }
            }
            if (messageEndIndex === -1) {
              messageEndIndex = lines.length - 1;
            }
            break;
          }
        }
      }

      if (messageStartIndex === -1) {
        return await interaction.reply({
          content: `❌ Nie znaleziono wiadomości numer ${messageNumber} w logu!`,
          ephemeral: true,
        });
      }

      // Zbuduj nową treść wiadomości
      const newLines = [...lines];

      // Znajdź nazwę użytkownika z oryginalnej wiadomości
      const originalLine = lines[messageStartIndex];
      const userNameMatch = originalLine.match(/^> \*\*(.*?)\*\*$/);
      const userName = userNameMatch ? userNameMatch[1] : "test1";

      // Zastąp wiadomość nową treścią
      newLines[messageStartIndex] = `> **${userName}**`;
      newLines[messageStartIndex + 1] = `> ${newContent}`;

      // Usuń stare linie wiadomości (jeśli nowa wiadomość ma inną liczbę linii)
      const oldMessageLines = messageEndIndex - messageStartIndex;
      if (oldMessageLines > 1) {
        newLines.splice(messageStartIndex + 2, oldMessageLines - 1);
      }

      // Połącz linie z powrotem
      const newMessageContent = newLines.join("\n");

      // Edytuj wiadomość
      await targetMessage.edit(newMessageContent);

      await interaction.reply({
        content: `✅ Wiadomość numer ${messageNumber} została pomyślnie edytowana!`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Błąd podczas edytowania wiadomości:", error);

      await interaction.reply({
        content: "❌ Wystąpił błąd podczas edytowania wiadomości!",
        ephemeral: true,
      });
    }
  },
};

export default editchatlogCommand;

