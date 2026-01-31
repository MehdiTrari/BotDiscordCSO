const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const EMBED_COLOR = 0xb10f0f;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Créer le panel de contrôle du leaderboard LoL")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("🎮 CSO League of Legends")
      .setDescription(
        "Bienvenue sur le leaderboard SoloQ de la CSO !\n\n" +
        "**Comment ça marche ?**\n" +
        "• Cliquez sur **🔗 Lier mon compte** pour associer votre compte Riot\n" +
        "• Votre rang sera automatiquement mis à jour toutes les 10 minutes\n" +
        "• Cliquez sur **📊 Voir le leaderboard** pour afficher le classement\n" +
        "• Vous pouvez vous délier à tout moment avec **❌ Délier mon compte**\n\n" +
        "⚠️ Entrez votre Riot ID au format : `Pseudo#TAG`"
      )
      .setFooter({ text: "CSO SoloQ Leaderboard • Auto-refresh 10 min" })
      .setTimestamp();

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("lol_link")
        .setLabel("Lier mon compte")
        .setEmoji("🔗")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("lol_unlink")
        .setLabel("Délier mon compte")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("lol_refresh")
        .setLabel("Rafraîchir")
        .setEmoji("🔄")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("lol_leaderboard")
        .setLabel("Voir le leaderboard")
        .setEmoji("📊")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.reply({ content: "Panel créé !", ephemeral: true });
    await interaction.channel.send({ embeds: [embed], components: [row1, row2] });
  },
};
