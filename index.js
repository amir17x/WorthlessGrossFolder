
const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionsBitField } = require('discord.js');
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

const prefix = '!';
let giveaways = {};
let users = {};
let inviteFilterEnabled = true;

function saveData() {
  try {
    fs.writeFileSync('giveaways.json', JSON.stringify(giveaways, null, 2));
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
    fs.writeFileSync('config.json', JSON.stringify({ inviteFilterEnabled }, null, 2));
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

function loadData() {
  try {
    if (fs.existsSync('giveaways.json')) giveaways = JSON.parse(fs.readFileSync('giveaways.json', 'utf8'));
    if (fs.existsSync('users.json')) users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
    if (fs.existsSync('config.json')) {
      const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      inviteFilterEnabled = config.inviteFilterEnabled;
    }
  } catch (err) {
    console.error('Error loading data:', err);
    giveaways = {};
    users = {};
    inviteFilterEnabled = true;
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
});

client.on('messageCreate', async message => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'giveaway' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    const duration = args[0] ? parseInt(args[0]) * 60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000;
    const winnersCount = args[1] ? parseInt(args[1]) : 1;
    const prize = args.slice(2).join(' ');
    
    if (!prize) return message.reply('❌ Please specify the prize. Example: `!giveaway 24 2 Discord Nitro`');
    if (isNaN(duration)) return message.reply('❌ Invalid duration');
    
    const endTime = Date.now() + duration;

    const embed = new EmbedBuilder()
      .setTitle('🎉 New Giveaway!')
      .setDescription(`
        🎁 Prize: **${prize}**
        ⏳ Ends: <t:${Math.floor(endTime / 1000)}:R>
        👥 Participants: 0
        🎫 Total Tickets: 0
        🏆 Winners: ${winnersCount}
      `)
      .setColor('#FFD700')
      .setTimestamp();

    const joinButton = new ButtonBuilder()
      .setCustomId('join_giveaway')
      .setLabel('✅ Join Giveaway')
      .setStyle(ButtonStyle.Success);

    const buyButton = new ButtonBuilder()
      .setCustomId('buy_ticket')
      .setLabel('💰 Buy Tickets')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(joinButton, buyButton);
    const giveawayMsg = await message.channel.send({ embeds: [embed], components: [row] });
    
    giveaways[giveawayMsg.id] = { 
      prize, 
      endTime, 
      participants: {},
      winnersCount,
      channelId: message.channel.id
    };
    saveData();

    setTimeout(() => endGiveaway(giveawayMsg.id), duration);
  }

  else if (command === 'invitefilter' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    inviteFilterEnabled = args[0] === 'on';
    saveData();
    message.reply(`✅ Invite filter has been ${inviteFilterEnabled ? 'enabled' : 'disabled'}`);
  }

  else if (command === 'buy') {
    const amount = parseInt(args[0]) || 1;
    if (amount <= 0) return message.reply('❌ Amount must be positive');
    
    const cost = amount <= 2 ? amount * 1000 : amount === 3 ? 2800 : amount * 900;
    users[message.author.id] = users[message.author.id] || { tickets: 0, ccoin: 0, invites: 0 };
    
    if (users[message.author.id].ccoin < cost) {
      return message.reply('❌ Not enough CCoins');
    }

    users[message.author.id].ccoin -= cost;
    users[message.author.id].tickets += amount;
    saveData();
    message.reply(`✅ Bought ${amount} tickets for ${cost} CCoins`);
  }

  else if (command === 'stats') {
    users[message.author.id] = users[message.author.id] || { tickets: 0, ccoin: 0, invites: 0 };
    const embed = new EmbedBuilder()
      .setTitle('📊 Your Stats')
      .setDescription(`
        🎫 Tickets: ${users[message.author.id].tickets}
        💰 CCoins: ${users[message.author.id].ccoin}
        📨 Invites: ${users[message.author.id].invites}
      `)
      .setColor('#00FF00');
    message.reply({ embeds: [embed] });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const { customId, user, message } = interaction;

  if (customId === 'join_giveaway') {
    const giveaway = giveaways[message.id];
    if (!giveaway) return interaction.reply({ content: '❌ This giveaway has ended', ephemeral: true });
    
    users[user.id] = users[user.id] || { tickets: 0, ccoin: 0, invites: 0 };
    if (users[user.id].tickets === 0) {
      return interaction.reply({ content: '❌ You need tickets to join!', ephemeral: true });
    }

    if (giveaway.participants[user.id]) {
      return interaction.reply({ content: '❌ You have already joined!', ephemeral: true });
    }

    giveaway.participants[user.id] = users[user.id].tickets;
    saveData();

    const totalTickets = Object.values(giveaway.participants).reduce((a, b) => a + b, 0);
    const participantsCount = Object.keys(giveaway.participants).length;

    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
      .setDescription(`
        🎁 Prize: **${giveaway.prize}**
        ⏳ Ends: <t:${Math.floor(giveaway.endTime / 1000)}:R>
        👥 Participants: ${participantsCount}
        🎫 Total Tickets: ${totalTickets}
        🏆 Winners: ${giveaway.winnersCount}
      `);

    await message.edit({ embeds: [updatedEmbed] });
    interaction.reply({ content: `✅ Joined with ${users[user.id].tickets} tickets!`, ephemeral: true });
  }

  else if (customId === 'buy_ticket') {
    interaction.reply({ 
      content: '💰 Use `!buy <amount>` to purchase tickets\nExample: `!buy 3`', 
      ephemeral: true 
    });
  }
});

async function endGiveaway(messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway) return;

  const entries = [];
  Object.entries(giveaway.participants).forEach(([userId, tickets]) => {
    for (let i = 0; i < tickets; i++) entries.push(userId);
  });

  if (entries.length === 0) {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (channel) {
      channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ Giveaway Cancelled')
            .setDescription(`No participants in giveaway for "${giveaway.prize}"`)
            .setColor('#FF0000')
        ]
      });
    }
  } else {
    const winners = new Set();
    while (winners.size < giveaway.winnersCount && winners.size < entries.length) {
      winners.add(entries[Math.floor(Math.random() * entries.length)]);
    }

    const channel = await client.channels.fetch(giveaway.channelId);
    if (channel) {
      const winnersText = Array.from(winners).map(id => `<@${id}>`).join('\n');
      channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('🎉 Giveaway Winners!')
            .setDescription(`
              🎁 Prize: **${giveaway.prize}**
              👑 Winners:\n${winnersText}
            `)
            .setColor('#00FF00')
        ]
      });
    }
  }

  delete giveaways[messageId];
  saveData();
}

client.login(process.env.TOKEN);
