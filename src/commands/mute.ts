import { ChatInputCommandInteraction, GuildMember, PermissionFlagsBits } from "discord.js";

const muteCommand = {
  name: "mute",
  description: "Wycisza użytkownika na określony czas.",
  options: [
    {
      name: "user",
      description: "Użytkownik do wyciszenia",
      type: 6, // USER type
      required: true,
    },
    {
      name: "duration",
      description: "Czas wyciszenia w minutach",
      type: 4, // INTEGER type
      required: true,
    },
    {
      name: "reason",
      description: "Powód wyciszenia",
      type: 3, // STRING type
      required: false,
    },
  ],
  async execute(interaction: ChatInputCommandInteraction) {
    // Sprawdź czy użytkownik ma uprawnienia do moderacji
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      return await interaction.reply({
        content: "❌ Nie masz uprawnień do wyciszania użytkowników!",
        ephemeral: true,
      });
    }

    const user = interaction.options.getUser("user");
    const duration = interaction.options.get("duration")?.value as number;
    const reason = (interaction.options.get("reason")?.value as string) || "Brak podanego powodu";

    if (!user) {
      return await interaction.reply({
        content: "❌ Nie znaleziono użytkownika!",
        ephemeral: true,
      });
    }

    if (duration <= 0 || duration > 40320) { // Max 28 dni
      return await interaction.reply({
        content: "❌ Czas wyciszenia musi być między 1 minutą a 28 dniami!",
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

      // Sprawdź czy można wyciszyć tego użytkownika
      if (member.roles.highest.position >= (interaction.member as GuildMember).roles.highest.position) {
        return await interaction.reply({
          content: "❌ Nie możesz wyciszyć użytkownika z równą lub wyższą rolą!",
          ephemeral: true,
        });
      }

      // Wycisz użytkownika
      await member.timeout(duration * 60 * 1000, reason); // Konwersja minut na milisekundy

      await interaction.reply({
        content: `🔇 **${user.username}** został wyciszony na **${duration} minut**.\n**Powód:** ${reason}`,
      });

    } catch (error) {
      console.error("Błąd podczas wyciszania użytkownika:", error);
      await interaction.reply({
        content: "❌ Wystąpił błąd podczas wyciszania użytkownika!",
        ephemeral: true,
      });
    }
  },
};

export default muteCommand;
