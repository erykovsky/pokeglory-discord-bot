import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
} from "discord.js";

const clearCommand = {
  name: "clear",
  description: "Czyści określoną liczbę wiadomości z kanału.",
  options: [
    {
      name: "amount",
      description: "Liczba wiadomości do usunięcia (1-100)",
      type: 4, // INTEGER type
      required: true,
    },
    {
      name: "user",
      description: "Usuń wiadomości tylko od konkretnego użytkownika",
      type: 6, // USER type
      required: false,
    },
  ],
  async execute(interaction: ChatInputCommandInteraction) {
    // Sprawdź czy użytkownik ma uprawnienia do zarządzania wiadomościami
    if (
      !interaction.memberPermissions?.has(
        PermissionFlagsBits.ManageMessages
      )
    ) {
      return await interaction.reply({
        content: "❌ Nie masz uprawnień do zarządzania wiadomościami!",
        ephemeral: true,
      });
    }

    const amount = interaction.options.get("amount")?.value as number;
    const targetUser = interaction.options.getUser("user");

    if (!amount) {
      return await interaction.reply({
        content: "❌ Musisz podać liczbę wiadomości do usunięcia!",
        ephemeral: true,
      });
    }

    if (amount <= 0 || amount > 100) {
      return await interaction.reply({
        content: "❌ Liczba wiadomości musi być między 1 a 100!",
        ephemeral: true,
      });
    }

    const channel = interaction.channel as TextChannel;
    if (!channel) {
      return await interaction.reply({
        content: "❌ Ta komenda może być używana tylko na kanałach tekstowych!",
        ephemeral: true,
      });
    }

    try {
      // Pobierz wiadomości
      const messages = await channel.messages.fetch({ limit: amount });
      
      let messagesToDelete = messages;
      
      // Jeśli podano konkretnego użytkownika, filtruj wiadomości
      if (targetUser) {
        messagesToDelete = messages.filter(
          (message) => message.author.id === targetUser.id
        );
      }

      // Usuń wiadomości starsze niż 14 dni (limit Discord API)
      const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const recentMessages = messagesToDelete.filter(
        (message) => message.createdTimestamp > twoWeeksAgo
      );

      if (recentMessages.size === 0) {
        return await interaction.reply({
          content: "❌ Nie znaleziono wiadomości do usunięcia (lub są starsze niż 14 dni)!",
          ephemeral: true,
        });
      }

      // Usuń wiadomości
      if (recentMessages.size === 1) {
        await recentMessages.first()?.delete();
      } else {
        await channel.bulkDelete(recentMessages);
      }

      const deletedCount = recentMessages.size;
      const userInfo = targetUser ? ` od użytkownika **${targetUser.username}**` : "";
      
      await interaction.reply({
        content: `✅ Usunięto **${deletedCount}** wiadomości${userInfo}!`,
        ephemeral: true,
      });

      // Usuń wiadomość potwierdzenia po 5 sekundach
      setTimeout(async () => {
        try {
          await interaction.deleteReply();
        } catch (error) {
          // Ignoruj błędy przy usuwaniu wiadomości potwierdzenia
        }
      }, 5000);

    } catch (error) {
      console.error("Błąd podczas czyszczenia wiadomości:", error);
      
      // Sprawdź czy to błąd związany z limitem czasu
      if (error instanceof Error && error.message.includes("time")) {
        return await interaction.reply({
          content: "❌ Nie można usunąć wiadomości starszych niż 14 dni!",
          ephemeral: true,
        });
      }

      await interaction.reply({
        content: "❌ Wystąpił błąd podczas czyszczenia wiadomości!",
        ephemeral: true,
      });
    }
  },
};

export default clearCommand;
