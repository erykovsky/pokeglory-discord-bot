import { ChatInputCommandInteraction, PermissionFlagsBits } from "discord.js";

const sendchatlogCommand = {
  name: "sendchatlog",
  description: "Wysyła przykładowy log czatu na kanał.",
  async execute(interaction: ChatInputCommandInteraction) {
    // Sprawdź czy użytkownik ma uprawnienia do wysyłania wiadomości
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.SendMessages)) {
      return await interaction.reply({
        content: "❌ Nie masz uprawnień do wysyłania wiadomości!",
        ephemeral: true,
      });
    }

    const chatLogMessage = `💬 **Chat log**

> **test1**  
> test
---
> **test2**  
> test
---
> **test3**  
> test
---
> **test4**  
> test ⚽
---
> **test5**  
> test`;

    try {
      await interaction.reply({
        content: "✅ Wiadomość została wysłana na kanał!",
        ephemeral: true,
      });

      // Wyślij wiadomość na kanał
      const channel = interaction.guild?.channels.cache.get(
        "1416080627081412659"
      );
      if (channel && channel.isTextBased()) {
        await channel.send(chatLogMessage);
      } else {
        await interaction.followUp({
          content: "❌ Nie można znaleźć kanału o podanym ID!",
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error("Błąd podczas wysyłania wiadomości:", error);
      await interaction.reply({
        content: "❌ Wystąpił błąd podczas wysyłania wiadomości!",
        ephemeral: true,
      });
    }
  },
};

export default sendchatlogCommand;

