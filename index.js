const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField, SlashCommandBuilder } = require('discord.js');
const fs = require('fs');

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildInvites
  ]
});

let giveaways = {};
let users = {};
let inviteFilterEnabled = true;
let config = { 
  giveawayChannelId: null, 
  winnersChannelId: null, 
  inviteRules: { invites: 3, tickets: 1 }
};

function saveData() {
  try {
    fs.writeFileSync('giveaways.json', JSON.stringify(giveaways, null, 2));
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
    fs.writeFileSync('config.json', JSON.stringify({ inviteFilterEnabled, ...config }, null, 2));
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

function loadData() {
  try {
    if (fs.existsSync('giveaways.json')) giveaways = JSON.parse(fs.readFileSync('giveaways.json', 'utf8'));
    if (fs.existsSync('users.json')) users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
    if (fs.existsSync('config.json')) {
      const loadedConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      inviteFilterEnabled = loadedConfig.inviteFilterEnabled;
      config.giveawayChannelId = loadedConfig.giveawayChannelId;
      config.winnersChannelId = loadedConfig.winnersChannelId;
      config.inviteRules = loadedConfig.inviteRules || { invites: 3, tickets: 1 };
    }
  } catch (err) {
    console.error('Error loading data:', err);
    giveaways = {};
    users = {};
    inviteFilterEnabled = true;
    config = { giveawayChannelId: null, winnersChannelId: null, inviteRules: { invites: 3, tickets: 1 } };
  }
  saveData();
}

loadData();

function cleanupExpiredGiveaways() {
  const now = Date.now();
  Object.entries(giveaways).forEach(([messageId, giveaway]) => {
    if (giveaway.endTime <= now) endGiveaway(messageId);
  });
}

client.on('guildMemberAdd', (member) => {
  member.guild.invites.fetch().then((guildInvites) => {
    const cachedInvites = client.invites?.get(member.guild.id) || new Map();
    guildInvites.forEach((invite) => {
      const oldInvite = cachedInvites.get(invite.code);
      if (oldInvite && invite.uses > oldInvite.uses && invite.inviter) {
        const inviterId = invite.inviter.id;
        users[inviterId] = users[inviterId] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null };
        if (!inviteFilterEnabled || !member.user.bot) {
          users[inviterId].invites++;
          updateTicketsFromInvites(inviterId);
        }
      }
    });
    client.invites?.set(member.guild.id, guildInvites);
  });
});

function updateTicketsFromInvites(userId) {
  const invites = users[userId].invites;
  const { invites: requiredInvites, tickets: rewardTickets } = config.inviteRules;
  const tickets = Math.floor(invites / requiredInvites) * rewardTickets;
  users[userId].tickets = Math.max(users[userId].tickets, tickets);
  saveData();
}

async function createInviteLink(guild, channel, userId) {
  try {
    const invite = await channel.createInvite({
      maxAge: 0,
      maxUses: 0,
      unique: true,
      reason: `Invite for user ${userId}`
    });
    return invite.url;
  } catch (err) {
    console.error('Error creating invite:', err);
    return null;
  }
}

client.once('ready', () => {
  console.log(`Bot ${client.user.tag} is online!`);
  client.invites = new Map();
  client.guilds.cache.forEach((guild) => {
    guild.invites.fetch().then((invites) => client.invites.set(guild.id, invites));
  });
  setInterval(cleanupExpiredGiveaways, 5 * 60 * 1000);

  const commands = [
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Start a new giveaway')
      .addIntegerOption(option => option.setName('hours').setDescription('Duration in hours').setRequired(true))
      .addIntegerOption(option => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addStringOption(option => option.setName('prize').setDescription('Prize description').setRequired(true)),
    new SlashCommandBuilder()
      .setName('setinvitetickets')
      .setDescription('Set invite-to-ticket ratio')
      .addIntegerOption(option => option.setName('invites').setDescription('Number of invites needed').setRequired(true))
      .addIntegerOption(option => option.setName('tickets').setDescription('Tickets to give').setRequired(true))
  ];

  client.application.commands.set(commands);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    if (interaction.commandName === 'giveaway') {
      const hours = interaction.options.getInteger('hours');
      const winners = interaction.options.getInteger('winners');
      const prize = interaction.options.getString('prize');

      const duration = hours * 60 * 60 * 1000;
      const endTime = Date.now() + duration;

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(`
Prize: ${prize}
Time: ${new Date(endTime).toLocaleString()}
Winners: ${winners}

Participants: 0
Total Tickets: 0

Get tickets:
• Invite friends (${config.inviteRules.invites} invites = ${config.inviteRules.tickets} ticket)
• Buy with CCOIN (/buy)
        `);

      const joinButton = new ButtonBuilder()
        .setCustomId('join_giveaway')
        .setLabel('Join Giveaway')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎉');

      const row = new ActionRowBuilder().addComponents(joinButton);
      const message = await interaction.channel.send({ embeds: [embed], components: [row] });

      giveaways[message.id] = {
        prize,
        endTime,
        winners,
        participants: [],
        messageId: message.id
      };

      interaction.reply({ content: 'Giveaway started!', flags: ['Ephemeral'] });
    }

    if (interaction.commandName === 'setinvitetickets') {
      const invites = interaction.options.getInteger('invites');
      const tickets = interaction.options.getInteger('tickets');

      config.inviteRules = { invites, tickets };
      saveData();

      interaction.reply(`Updated: ${invites} invites = ${tickets} tickets`);
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'join_giveaway') {
      const giveaway = giveaways[interaction.message.id];
      if (!giveaway) return;

      const userId = interaction.user.id;
      users[userId] = users[userId] || { tickets: 0, ccoin: 0, invites: 0 };

      if (users[userId].tickets === 0) {
        const buyButton = new ButtonBuilder()
          .setCustomId('buy_ticket')
          .setLabel('Buy Tickets')
          .setStyle(ButtonStyle.Primary);

        const inviteButton = new ButtonBuilder()
          .setCustomId('invite_friends')
          .setLabel('Invite Friends')
          .setStyle(ButtonStyle.Secondary);

        const row = new ActionRowBuilder().addComponents(buyButton, inviteButton);

        interaction.reply({
          content: 'You need tickets to join! Choose an option:',
          flags: ['Ephemeral'],
          components: [row]
        });
        return;
      }

      if (!giveaway.participants.includes(userId)) {
        giveaway.participants.push(userId);
        saveData();

        interaction.reply({
          content: `You joined with ${users[userId].tickets} tickets!`,
          ephemeral: true
        });
      }
    }

    if (interaction.customId === 'buy_ticket') {
      interaction.reply({
        content: 'Use /buy <amount> to purchase tickets\nExample: /buy 3',
        ephemeral: true
      });
    }

    if (interaction.customId === 'invite_friends') {
      const inviteLink = await createInviteLink(
        interaction.guild,
        interaction.channel,
        interaction.user.id
      );

      if (inviteLink) {
        interaction.reply({
          content: `Here's your invite link: ${inviteLink}\nInvite ${config.inviteRules.invites} friends to get ${config.inviteRules.tickets} tickets!`,
          ephemeral: true
        });
      } else {
        interaction.reply({
          content: 'Error creating invite link. Please try again later.',
          ephemeral: true
        });
      }
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    const { commandName, options, member } = interaction;

    if (commandName === 'ping') {
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setDescription(`🏓 Pong! ${client.ws.ping}ms`);
      await interaction.reply({ embeds: [embed] });
    }


    else if (commandName === 'invitefilter' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      inviteFilterEnabled = options.getString('state') === 'on';
      saveData();
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setDescription(`✅ Invite filter has been ${inviteFilterEnabled ? 'enabled' : 'disabled'}`);
      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'buy') {
      const amount = options.getInteger('amount');
      if (amount <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Amount must be positive');
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
      
      const cost = amount <= 2 ? amount * 1000 : amount === 3 ? 2800 : amount * 900;
      users[interaction.user.id] = users[interaction.user.id] || { tickets: 0, ccoin: 0, invites: 0 };
      
      if (users[interaction.user.id].ccoin < cost) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Not enough CCoins');
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
      users[interaction.user.id].ccoin -= cost;
      users[interaction.user.id].tickets += amount;
      saveData();

      const successEmbed = new EmbedBuilder()
        .setColor('#00ff00')
        .setDescription(`✅ Bought ${amount} tickets for ${cost} CCoins`);
      await interaction.reply({ embeds: [successEmbed] });
    }

    else if (commandName === 'stats') {
      users[interaction.user.id] = users[interaction.user.id] || { tickets: 0, ccoin: 0, invites: 0 };
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('📊 Your Stats')
        .setDescription(`
          🎫 Tickets: ${users[interaction.user.id].tickets}
          💰 CCoins: ${users[interaction.user.id].ccoin}
          📨 Invites: ${users[interaction.user.id].invites}
        `);
      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'setccoin' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const targetUser = options.getUser('user');
      const amount = options.getInteger('amount');
      users[targetUser.id] = users[targetUser.id] || { tickets: 0, ccoin: 0, invites: 0 };
      users[targetUser.id].ccoin = amount;
      saveData();
      
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setDescription(`✅ Set ${amount} CCoins for ${targetUser.tag}`);
      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === 'setchannel' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const type = options.getString('type');
      const channel = options.getChannel('channel');
      if (type === 'giveaway') config.giveawayChannelId = channel.id;
      else if (type === 'winners') config.winnersChannelId = channel.id;
      saveData();
      
      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setDescription(`✅ Set ${type} channel to ${channel}`);
      await interaction.reply({ embeds: [embed] });
    }
  }
});


async function endGiveaway(messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway) return;

  const entries = [];
  giveaway.participants.forEach((userId) => {
    for (let i = 0; i < users[userId].tickets; i++) entries.push(userId);
  });

  const channel = await client.channels.fetch(giveaway.channelId);
  if (!channel) return;

  if (entries.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('#ff0000')
      .setTitle('❌ Giveaway Cancelled')
      .setDescription(`No participants in giveaway for "${giveaway.prize}"`);
    channel.send({ embeds: [embed] });
  } else {
    const winners = new Set();
    while (winners.size < giveaway.winners && winners.size < entries.length) {
      winners.add(entries[Math.floor(Math.random() * entries.length)]);
    }

    const winnersArray = Array.from(winners);
    const winnersText = winnersArray.map((id, index) => `${index + 1}. <@${id}>`).join('\n');
    
    const embed = new EmbedBuilder()
      .setColor('#00ff00')
      .setTitle('🎉 Giveaway Winners!')
      .setDescription(`
        Prize: **${giveaway.prize}**
        Winners:
        ${winnersText}
      `);
    
    await channel.send({ embeds: [embed] });

    for (const winnerId of winnersArray) {
      try {
        const user = await client.users.fetch(winnerId);
        const dmEmbed = new EmbedBuilder()
          .setColor('#00ff00')
          .setDescription(`🎉 Congratulations! You won "${giveaway.prize}"!\nCheck the private channel.`);
        await user.send({ embeds: [dmEmbed] });
      } catch (err) {
        console.error(`Failed to DM ${winnerId}:`, err);
      }

      const winnerChannel = await channel.guild.channels.create({
        name: `winner-${winnerId}`,
        type: 0,
        permissionOverwrites: [
          { id: channel.guild.id, deny: ['ViewChannel'] },
          { id: winnerId, allow: ['ViewChannel', 'SendMessages'] },
          { id: channel.guild.roles.cache.find(r => r.permissions.has(PermissionsBitField.Flags.Administrator)).id, allow: ['ViewChannel', 'SendMessages'] }
        ]
      });

      const claimButton = new ButtonBuilder()
        .setCustomId('claim_prize')
        .setLabel('🎁 Prize Delivered')
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder().addComponents(claimButton);
      
      const instructionEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setDescription('Please confirm your prize! (Send proof or text)');
      
      await winnerChannel.send({ content: `<@${winnerId}>`, embeds: [instructionEmbed], components: [row] });
    }
  }

  delete giveaways[messageId];
  saveData();
}

client.login(process.env.TOKEN);