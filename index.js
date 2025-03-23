
const { Client, GatewayIntentBits, EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
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

// Save data to files
function saveData() {
  fs.writeFileSync('giveaways.json', JSON.stringify(giveaways, null, 2));
  fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
}

// Load data from files
try {
  giveaways = JSON.parse(fs.readFileSync('giveaways.json', 'utf8'));
  users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
} catch (err) {
  saveData();
}

client.once('ready', () => {
  console.log(`Bot ${client.user.tag} is ready!`);
  client.guilds.cache.forEach(guild => {
    guild.invites.fetch()
      .then(invites => client.invites.set(guild.id, invites))
      .catch(console.error);
  });
});

// Track invites
client.invites = new Map();

client.on('guildMemberAdd', async member => {
  const newInvites = await member.guild.invites.fetch();
  const oldInvites = client.invites.get(member.guild.id);
  
  const invite = newInvites.find(i => {
    const oldInvite = oldInvites.get(i.code);
    return oldInvite && (i.uses > oldInvite.uses);
  });

  if (invite) {
    const inviter = invite.inviter.id;
    users[inviter] = users[inviter] || { tickets: 0, ccoin: 0, invites: 0 };
    users[inviter].invites++;

    // Calculate tickets based on invites
    if (users[inviter].invites >= 20) {
      users[inviter].tickets = Math.floor(users[inviter].invites / 4);
    } else if (users[inviter].invites >= 10) {
      users[inviter].tickets = Math.floor(users[inviter].invites / 3.33);
    } else if (users[inviter].invites >= 5) {
      users[inviter].tickets = Math.floor(users[inviter].invites / 2.5);
    } else if (users[inviter].invites >= 3) {
      users[inviter].tickets = 1;
    }

    saveData();
  }

  client.invites.set(member.guild.id, newInvites);
});

client.on('messageCreate', async message => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'giveaway' && message.member.permissions.has('ADMINISTRATOR')) {
    const prize = args.join(' ');
    const duration = 3 * 24 * 60 * 60 * 1000; // 3 days
    const endTime = Date.now() + duration;

    const embed = new EmbedBuilder()
      .setTitle('🎉 قرعه کشی جدید!')
      .setDescription(`جایزه: ${prize}\nزمان باقی مانده: <t:${Math.floor(endTime/1000)}:R>`)
      .setColor('#00FF00');

    const joinButton = new ButtonBuilder()
      .setCustomId('join_giveaway')
      .setLabel('✅ شرکت در قرعه کشی')
      .setStyle(ButtonStyle.Success);

    const buyButton = new ButtonBuilder()
      .setCustomId('buy_ticket')
      .setLabel('💰 خرید بلیط')
      .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder().addComponents(joinButton, buyButton);
    
    const giveawayMsg = await message.channel.send({ embeds: [embed], components: [row] });
    giveaways[giveawayMsg.id] = {
      prize,
      endTime,
      participants: {}
    };
    saveData();

    setTimeout(() => endGiveaway(giveawayMsg.id), duration);
  }

  if (command === 'buy') {
    const amount = parseInt(args[0]) || 1;
    const cost = amount <= 2 ? amount * 1000 : amount === 3 ? 2800 : amount * 900;
    
    try {
      // ارسال درخواست به API ربات CCOIN
      const response = await fetch('https://api.ccoin.com/v1/transfer', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.CCOIN_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          userId: message.author.id,
          amount: cost,
          description: `خرید ${amount} بلیط قرعه کشی`
        })
      });

      const data = await response.json();
      
      if (data.success) {
        users[message.author.id] = users[message.author.id] || { tickets: 0, ccoin: 0, invites: 0 };
        users[message.author.id].tickets += amount;
        saveData();
        message.reply(`✅ ${amount} بلیط خریداری شد!`);
      } else {
        message.reply('❌ خطا در پردازش تراکنش. لطفاً موجودی خود را بررسی کنید.');
      }
    } catch (error) {
      console.error('CCOIN API Error:', error);
      message.reply('❌ خطا در ارتباط با سیستم مالی. لطفاً بعداً تلاش کنید.');
    }
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'join_giveaway') {
    const giveaway = giveaways[interaction.message.id];
    if (!giveaway) return interaction.reply({ content: '❌ این قرعه کشی تمام شده است!', ephemeral: true });

    users[interaction.user.id] = users[interaction.user.id] || { tickets: 0, ccoin: 0, invites: 0 };
    
    if (users[interaction.user.id].tickets === 0) {
      return interaction.reply({ content: '❌ شما بلیط ندارید!', ephemeral: true });
    }

    giveaway.participants[interaction.user.id] = users[interaction.user.id].tickets;
    saveData();

    interaction.reply({ content: '✅ با موفقیت در قرعه کشی شرکت کردید!', ephemeral: true });
  }
});

async function endGiveaway(messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway) return;

  const entries = [];
  for (const [userId, tickets] of Object.entries(giveaway.participants)) {
    for (let i = 0; i < tickets; i++) {
      entries.push(userId);
    }
  }

  if (entries.length === 0) return;

  const winnerId = entries[Math.floor(Math.random() * entries.length)];
  const message = await client.channels.cache.get(messageId.split('-')[0]).messages.fetch(messageId);
  
  const winEmbed = new EmbedBuilder()
    .setTitle('🎉 برنده قرعه کشی!')
    .setDescription(`برنده: <@${winnerId}>\nجایزه: ${giveaway.prize}`)
    .setColor('#0000FF');

  message.channel.send({ embeds: [winEmbed] });
  delete giveaways[messageId];
  saveData();
}

client.login(process.env.TOKEN);
