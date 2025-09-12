import { ChatInputCommandInteraction, GuildMember, PermissionFlagsBits } from "discord.js";

const unmuteCommand = {
  name: "unmute",
  description: "Odcisza użytkownika.",
  options: [
    {
      name: "user",
      description: "Użytkownik do odciszenia",
      type: 6, // USER type
      required: true,
    },
    {
      name: "reason",
      description: "Powód odciszenia",
      type: 3, // STRING type
      required: false,
    },
  ],
  async execute(interaction: ChatInputCommandInteraction) {
    // Sprawdź czy użytkownik ma uprawnienia do moderacji
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      return await interaction.reply({
        content: "❌ Nie masz uprawnień do odciszania użytkowników!",
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser("user");
    const reason = (interaction.options.get("reason")?.value as string) || "Brak podanego powodu";

    if (!user) {
      return await interaction.reply({
        content: "❌ Nie znaleziono użytkownika!",
        ephemeral: true,
      });
    }

    try {
      const member = interaction.guild?.members.cache.get(user.id) as GuildMember;
      
      if (!member) {
        return await interaction.reply({
          content: "❌ Użytkownik nie jest na tym serwerze!",
          ephemeral: true,
        });
      }

      // Sprawdź czy użytkownik jest wyciszony
      if (!member.isCommunicationDisabled()) {
        return await interaction.reply({
          content: "❌ Ten użytkownik nie jest wyciszony!",
          ephemeral: true,
        });
      }

      // Sprawdź czy można odciszyć tego użytkownika
      if (member.roles.highest.position >= (interaction.member as GuildMember).roles.highest.position) {
        return await interaction.reply({
          content: "❌ Nie możesz odciszyć użytkownika z równą lub wyższą rolą!",
          ephemeral: true,
        });
      }

      // Odcisz użytkownika
      await member.timeout(null, reason);

      await interaction.reply({
        content: `🔊 **${user.username}** został odciszony.\n**Powód:** ${reason}`,
      });

    } catch (error) {
      console.error("Błąd podczas odciszania użytkownika:", error);
      await interaction.reply({
        content: "❌ Wystąpił błąd podczas odciszania użytkownika!",
        ephemeral: true,
      });
    }
  },
};

export default unmuteCommand;
