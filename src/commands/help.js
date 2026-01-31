const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

const EMBED_COLOR = 0xb10f0f;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Afficher l'aide du bot"),
  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle("📊 Leaderboard LoL - CSO")
      .setDescription("Suivez le classement Solo/Duo des membres de la CSO en temps réel !")
      .addFields(
        {
          name: "🎮 Commandes",
          value: [
            "`/lolboard display` — Afficher le leaderboard épinglé",
            "`/lolboard stop` — Retirer le leaderboard épinglé",
            "`/lolboard add @membre Pseudo#Tag` — Lier un compte LoL à un membre",
            "`/lolboard kick @membre` — Retirer un membre du leaderboard",
            "`/panel` — Créer le panel de contrôle interactif",
          ].join("\n"),
        },
        {
          name: "🔗 Comment lier son compte ?",
          value: [
            "**Option 1:** Clique sur **🔗 Lier mon compte** dans le panel",
            "**Option 2:** Demande à un admin d'utiliser `/lolboard add`",
          ].join("\n"),
        },
        {
          name: "🎛️ Boutons du Panel",
          value: [
            "🔗 **Lier mon compte** — Associer ton compte Riot",
            "❌ **Délier mon compte** — Te retirer du leaderboard",
            "🔄 **Rafraîchir** — Forcer une mise à jour des rangs",
            "📊 **Voir le leaderboard** — Afficher le classement",
          ].join("\n"),
        },
        {
          name: "✨ Fonctionnalités",
          value: [
            "• Classement automatique par rang et LP",
            "• Lien direct vers ton profil OP.GG",
            "• Mise à jour automatique toutes les 10 minutes",
            "• Emojis de rang personnalisés",
          ].join("\n"),
        }
      );

    await interaction.reply({ embeds: [embed] });
  },
};
