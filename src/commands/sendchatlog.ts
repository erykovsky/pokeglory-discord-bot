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

    const chatLogMessage = `:speech_balloon: **Chat log z PokeGlory** :speech_balloon:

***test*** \`18:30\`  
content

***test*** \`18:31\`  
content

***test*** \`18:32\`  
content

***test*** \`18:33\`  
content

***test*** \`18:34\`  
content`;

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

