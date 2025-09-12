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

> 👤 **test1**  
> Hej, ktoś gra dzisiaj? 🎮
---
> 👤 **test2**  
> Ja mogę na Valo po 21 😎
---
> 👤 **test3**  
> To może Among Us? 😂
---
> 👤 **test4**  
> Turniej w sobotę? ⚽
---
> 🤖 **test5**  
> 🔔 Spotkanie zarządu jutro 19:00!`;

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

