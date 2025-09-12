import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

const editCommand = {
  name: "edit",
  description: "Edytuje wiadomość bota na podstawie ID wiadomości.",
  options: [
    {
      name: "message_id",
      description: "ID wiadomości do edycji",
      type: 3, // STRING type
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
    const newContent = interaction.options.getString("new_content");

    if (!messageId || !newContent) {
      return await interaction.reply({
        content: "❌ Musisz podać ID wiadomości i nową treść!",
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

      // Edytuj wiadomość
      await message.edit(newContent);

      await interaction.reply({
        content: "✅ Wiadomość została pomyślnie edytowana!",
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

export default editCommand;

