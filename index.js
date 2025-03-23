
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
let config = { giveawayChannelId: null, winnersChannelId: null };

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
    }
  } catch (err) {
    console.error('Error loading data:', err);
    giveaways = {};
    users = {};
    inviteFilterEnabled = true;
    config = { giveawayChannelId: null, winnersChannelId: null };
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
        users[inviterId] = users[inviterId] || { tickets: 0, ccoin: 0, invites: 0 };
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
  let tickets = 0;
  if (invites >= 20) tickets = 5;
  else if (invites >= 10) tickets = 3;
  else if (invites >= 5) tickets = 2;
  else if (invites >= 3) tickets = 1;
  users[userId].tickets = Math.max(users[userId].tickets, tickets);
  saveData();
}

client.once('ready', () => {
  console.log(`✅ Bot ${client.user.tag} is online!`);
  client.invites = new Map();
  client.guilds.cache.forEach((guild) => {
    guild.invites.fetch().then((invites) => client.invites.set(guild.id, invites));
  });
  setInterval(cleanupExpiredGiveaways, 5 * 60 * 1000);

  const commands = [
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Check bot latency'),
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Start a new giveaway (Admin only)')
      .addIntegerOption(option => option.setName('hours').setDescription('Duration in hours').setRequired(true))
      .addIntegerOption(option => option.setName('winners').setDescription('Number of winners').setRequired(true))
      .addStringOption(option => option.setName('prize').setDescription('Prize description').setRequired(true)),
    new SlashCommandBuilder()
      .setName('invitefilter')
      .setDescription('Toggle invite filter (Admin only)')
      .addStringOption(option => option.setName('state').setDescription('on/off').setRequired(true).addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' })),
    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('Buy tickets with CCOIN')
      .addIntegerOption(option => option.setName('amount').setDescription('Number of tickets').setRequired(true)),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('View your stats'),
    new SlashCommandBuilder()
      .setName('setccoin')
      .setDescription('Set CCOIN for a user (Admin only)')
      .addUserOption(option => option.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(option => option.setName('amount').setDescription('CCOIN amount').setRequired(true)),
    new SlashCommandBuilder()
      .setName('setchannel')
      .setDescription('Set giveaway or winners channel (Admin only)')
      .addStringOption(option => option.setName('type').setDescription('Channel type').setRequired(true).addChoices({ name: 'Giveaway', value: 'giveaway' }, { name: 'Winners', value: 'winners' }))
      .addChannelOption(option => option.setName('channel').setDescription('Target channel').setRequired(true))
  ];

  client.application.commands.set(commands);
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

    else if (commandName === 'giveaway' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const hours = options.getInteger('hours');
      const winnersCount = options.getInteger('winners');
      const prize = options.getString('prize');
      
      if (hours <= 0 || winnersCount <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Hours and winners count must be positive!');
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      if (!config.giveawayChannelId) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ Please set giveaway channel first with /setchannel!');
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      const duration = hours * 60 * 60 * 1000;
      const endTime = Date.now() + duration;
      
      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(`
          Prize: **${prize}**
          Time: <t:${Math.floor(endTime / 1000)}:R>
          Winners: ${winnersCount}
          
          Participants: 0
          Total Tickets: 0
          
          Get tickets:
          • Invite friends (3 invites = 1 ticket)
          • Buy with CCOIN (/buy)
        `)
        .setTimestamp();

      const joinButton = new ButtonBuilder()
        .setCustomId('join_giveaway')
        .setLabel('Join Giveaway')
        .setEmoji('🎉')
        .setStyle(ButtonStyle.Success);

      const buyButton = new ButtonBuilder()
        .setCustomId('buy_ticket')
        .setLabel('Buy Tickets')
        .setEmoji('🎫')
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(joinButton, buyButton);
      const giveawayMsg = await client.channels.cache.get(config.giveawayChannelId).send({ embeds: [embed], components: [row] });
      
      giveaways[giveawayMsg.id] = { 
        prize, 
        endTime, 
        participants: {},
        winnersCount,
        channelId: config.giveawayChannelId
      };
      saveData();

      setTimeout(() => endGiveaway(giveawayMsg.id), duration);
      
      const successEmbed = new EmbedBuilder()
        .setColor('#00ff00')
        .setDescription('✅ Giveaway started successfully!');
      await interaction.reply({ embeds: [successEmbed] });
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

  else if (interaction.isButton()) {
    const { customId, user, message } = interaction;
    users[user.id] = users[user.id] || { tickets: 0, ccoin: 0, invites: 0 };

    if (customId === 'join_giveaway') {
      const giveaway = giveaways[message.id];
      if (!giveaway) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ This giveaway has ended');
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
      
      if (users[user.id].tickets === 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ You need tickets to join!\n• Invite friends (3 invites = 1 ticket)\n• Use /buy to purchase tickets');
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      if (giveaway.participants[user.id]) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#ff0000')
          .setDescription('❌ You have already joined!');
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      giveaway.participants[user.id] = users[user.id].tickets;
      saveData();

      const totalTickets = Object.values(giveaway.participants).reduce((a, b) => a + b, 0);
      const participantsCount = Object.keys(giveaway.participants).length;

      const updatedEmbed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉 GIVEAWAY 🎉')
        .setDescription(`
          Prize: **${giveaway.prize}**
          Time: <t:${Math.floor(giveaway.endTime / 1000)}:R>
          Winners: ${giveaway.winnersCount}
          
          Participants: ${participantsCount}
          Total Tickets: ${totalTickets}
          
          Get tickets:
          • Invite friends (3 invites = 1 ticket)
          • Buy with CCOIN (/buy)
        `)
        .setTimestamp();

      await message.edit({ embeds: [updatedEmbed] });
      
      const successEmbed = new EmbedBuilder()
        .setColor('#00ff00')
        .setDescription(`✅ Joined with ${users[user.id].tickets} tickets!`);
      await interaction.reply({ embeds: [successEmbed], ephemeral: true });
    }

    else if (customId === 'buy_ticket') {
      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setDescription('💰 Use `/buy <amount>` to purchase tickets\nExample: `/buy 3`');
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }
});

async function endGiveaway(messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway) return;

  const entries = [];
  Object.entries(giveaway.participants).forEach(([userId, tickets]) => {
    for (let i = 0; i < tickets; i++) entries.push(userId);
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
    while (winners.size < giveaway.winnersCount && winners.size < entries.length) {
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
