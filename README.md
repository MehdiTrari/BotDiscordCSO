# 🎮 CSO SoloQ Leaderboard Bot

Bot Discord pour suivre le classement Solo/Duo League of Legends des membres de la CSO en temps réel.

## ✨ Fonctionnalités

- 📊 **Leaderboard automatique** - Classement des joueurs par rang et LP
- 🔄 **Mise à jour automatique** - Refresh toutes les 10 minutes
- 🔗 **Liens OP.GG** - Accès direct aux profils des joueurs
- 🎨 **Emojis de rang** - Affichage personnalisé avec les emblèmes de rang
- 📋 **Panel interactif** - Boutons pour lier/délier son compte
- 🔍 **Suivi des pseudos** - Détection automatique des changements de pseudo Riot
- 📝 **Logs en temps réel** - Panneau de logs auto-actualisé (admin)

## 🛠️ Prérequis

- Node.js 18+
- Un bot Discord avec les permissions appropriées
- Une clé API Riot Games

## ⚙️ Configuration

1. Copie le fichier `.env.example` vers `.env`
2. Remplis les variables :
   - `DISCORD_TOKEN` - Token du bot Discord
   - `DISCORD_CLIENT_ID` - ID de l'application Discord
   - `RIOT_API_KEY` - Clé API Riot Games
   - `DISCORD_GUILD_ID` (optionnel) - Pour enregistrer les commandes sur un serveur spécifique

## 📦 Installation

```bash
npm install
```

## 🚀 Utilisation

### Enregistrer les commandes slash
```bash
npm run register
```

### Lancer le bot
```bash
npm run start
```

## 📜 Commandes

### Leaderboard
| Commande | Description |
|----------|-------------|
| `/lolboard display` | Afficher le leaderboard épinglé |
| `/lolboard stop` | Retirer le leaderboard épinglé |
| `/lolboard add @membre Pseudo#Tag` | Lier un compte LoL à un membre |
| `/lolboard kick @membre` | Retirer un membre du leaderboard |

### Panel & Utilitaires
| Commande | Description |
|----------|-------------|
| `/panel` | Créer le panel de contrôle interactif |
| `/help` | Afficher l'aide du bot |
| `/logs display` | Afficher les logs du bot (admin) |
| `/logs stop` | Retirer le panneau de logs |
| `/logs clear` | Effacer tous les logs |

### Boutons du Panel
- 🔗 **Lier mon compte** - Associer son compte Riot via un modal
- ❌ **Délier mon compte** - Se retirer du leaderboard
- 🔄 **Rafraîchir** - Forcer une mise à jour des rangs
- 📊 **Voir le leaderboard** - Afficher le classement

## 📁 Structure du projet

```
src/
├── index.js              # Point d'entrée principal
├── config.js             # Configuration (env)
├── leaderboard.js        # Logique API Riot & données
├── logs-utils.js         # Système de logs
├── register-commands.js  # Enregistrement des commandes
├── commands/
│   ├── help.js           # Commande /help
│   ├── logs.js           # Commande /logs
│   ├── lolboard.js       # Commande /lolboard
│   └── panel.js          # Commande /panel
└── data/
    ├── leaderboard.json  # Données des joueurs
    ├── pin.json          # Message épinglé du leaderboard
    ├── logs-pin.json     # Message épinglé des logs
    └── rank-emojis.json  # Mapping des emojis de rang
```

## 🔗 Lien d'invitation

```
https://discord.com/oauth2/authorize?client_id=1461711254308651059&permissions=8&integration_type=0&scope=bot+applications.commands
```

## 📝 Notes

- Le bot utilise le **PUUID** de Riot pour tracker les joueurs, donc les changements de pseudo sont automatiquement détectés
- Les pseudos affichés sont les **pseudos du serveur Discord** (displayName), pas les noms d'utilisateur
- L'heure affichée est en fuseau horaire **Europe/Paris**
