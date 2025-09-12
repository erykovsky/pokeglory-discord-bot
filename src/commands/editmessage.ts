import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

const editMessageCommand = {
  name: "editmessage",
  description:
    "Edytuje konkretną wiadomość w logu czatu na podstawie ID wiadomości i numeru wiadomości w logu.",
  options: [
    {
      name: "message_id",
      description: "ID wiadomości z logiem czatu do edycji",
      type: 3, // STRING type
      required: true,
    },
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

    const messageId = interaction.options.getString("message_id");
    const messageNumber = interaction.options.getInteger("message_number");
    const newContent = interaction.options.getString("new_content");

    if (!messageId || !messageNumber || !newContent) {
      return await interaction.reply({
        content:
          "❌ Musisz podać ID wiadomości, numer wiadomości i nową treść!",
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
      // Pobierz kanał
      const channel = interaction.channel as TextChannel;
      if (!channel) {
        return await interaction.reply({
          content:
            "❌ Ta komenda może być używana tylko na kanałach tekstowych!",
          ephemeral: true,
        });
      }

      // Pobierz wiadomość
      const message = await channel.messages.fetch(messageId);

      if (!message) {
        return await interaction.reply({
          content: "❌ Nie znaleziono wiadomości o podanym ID!",
          ephemeral: true,
        });
      }

      // Sprawdź czy wiadomość należy do bota
      if (message.author.id !== interaction.client.user?.id) {
        return await interaction.reply({
          content:
            "❌ Możesz edytować tylko wiadomości wysłane przez tego bota!",
          ephemeral: true,
        });
      }

      // Pobierz obecną treść wiadomości
      const currentContent = message.content;

      // Podziel wiadomość na linie
      const lines = currentContent.split("\n");

      // Znajdź sekcję z wiadomością do edycji
      let messageStartIndex = -1;
      let messageEndIndex = -1;
      let currentMessageNumber = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Sprawdź czy to początek nowej wiadomości (zaczyna się od "> 👤" lub "> 🤖")
        if (line.match(/^> (👤|🤖) \*\*.*\*\*$/)) {
          currentMessageNumber++;

          if (currentMessageNumber === messageNumber) {
            messageStartIndex = i;
            // Znajdź koniec tej wiadomości (następna linia z "> 👤" lub "> 🤖" lub koniec)
            for (let j = i + 1; j < lines.length; j++) {
              if (
                lines[j].match(/^> (👤|🤖) \*\*.*\*\*$/) ||
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

      // Znajdź typ użytkownika (👤 lub 🤖) z oryginalnej wiadomości
      const originalLine = lines[messageStartIndex];
      const userTypeMatch = originalLine.match(/^> (👤|🤖) \*\*(.*?)\*\*$/);
      const userType = userTypeMatch ? userTypeMatch[1] : "👤";
      const userName = userTypeMatch ? userTypeMatch[2] : "test1";

      // Zastąp wiadomość nową treścią
      newLines[messageStartIndex] = `> ${userType} **${userName}**`;
      newLines[messageStartIndex + 1] = `> ${newContent}`;

      // Usuń stare linie wiadomości (jeśli nowa wiadomość ma inną liczbę linii)
      const oldMessageLines = messageEndIndex - messageStartIndex;
      if (oldMessageLines > 1) {
        newLines.splice(messageStartIndex + 2, oldMessageLines - 1);
      }

      // Połącz linie z powrotem
      const newMessageContent = newLines.join("\n");

      // Edytuj wiadomość
      await message.edit(newMessageContent);

      await interaction.reply({
        content: `✅ Wiadomość numer ${messageNumber} została pomyślnie edytowana!`,
        ephemeral: true,
      });
    } catch (error) {
      console.error("Błąd podczas edytowania wiadomości:", error);

      if (error instanceof Error && error.message.includes("Unknown Message")) {
        return await interaction.reply({
          content: "❌ Nie znaleziono wiadomości o podanym ID!",
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: "❌ Wystąpił błąd podczas edytowania wiadomości!",
        ephemeral: true,
      });
    }
  },
};

export default editMessageCommand;

