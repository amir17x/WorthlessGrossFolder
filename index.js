
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

// ذخیره‌سازی داده‌ها با error handling
function saveData() {
  try {
    fs.writeFileSync('giveaways.json', JSON.stringify(giveaways, null, 2));
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Error saving data:', err);
  }
}

// بارگذاری داده‌ها با error handling بهتر
function loadData() {
  try {
    if (fs.existsSync('giveaways.json')) {
      giveaways = JSON.parse(fs.readFileSync('giveaways.json', 'utf8'));
    }
    if (fs.existsSync('users.json')) {
      users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
    }
  } catch (err) {
    console.error('Error loading data:', err);
    giveaways = {};
    users = {};
  }
  saveData();
}

loadData();

// تابع برای بررسی و پاکسازی قرعه‌کشی‌های منقضی شده
function cleanupExpiredGiveaways() {
  const now = Date.now();
  Object.entries(giveaways).forEach(([messageId, giveaway]) => {
    if (giveaway.endTime <= now) {
      endGiveaway(messageId);
    }
  });
}

client.once('ready', () => {
  console.log(`✅ Bot ${client.user.tag} is online!`);
  // بررسی دوره‌ای قرعه‌کشی‌های منقضی شده
  setInterval(cleanupExpiredGiveaways, 5 * 60 * 1000); // هر 5 دقیقه
});

client.on('messageCreate', async message => {
  if (!message.content.startsWith(prefix) || message.author.bot) return;
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === 'giveaway' && message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
    const duration = args[0] ? parseInt(args[0]) * 60 * 60 * 1000 : 3 * 24 * 60 * 60 * 1000; // ساعت به میلی‌ثانیه
    const prize = args.slice(1).join(' ');
    
    if (!prize) return message.reply('❌ لطفاً جایزه قرعه‌کشی را مشخص کنید. مثال: `!giveaway 24 نیترو دیسکورد`');
    if (isNaN(duration)) return message.reply('❌ مدت زمان نامعتبر است. مثال: `!giveaway 24 نیترو دیسکورد`');
    
    const endTime = Date.now() + duration;

    const embed = new EmbedBuilder()
      .setTitle('🎉 قرعه‌کشی جدید!')
      .setDescription(`
        🎁 جایزه: **${prize}**
        ⏳ پایان: <t:${Math.floor(endTime / 1000)}:R>
        👥 شرکت‌کنندگان: 0
        🎫 مجموع بلیط‌ها: 0
      `)
      .setColor('#FFD700')
      .setTimestamp();

    const joinButton = new ButtonBuilder()
      .setCustomId('join_giveaway')
      .setLabel('✅ شرکت در قرعه‌کشی')
      .setStyle(ButtonStyle.Success);

    const buyButton = new ButtonBuilder()
      .setCustomId('buy_ticket')
      .setLabel('💰 خرید بلیط')
      .setStyle(ButtonStyle.Primary);

    const infoButton = new ButtonBuilder()
      .setCustomId('giveaway_info')
      .setLabel('ℹ️ اطلاعات')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(joinButton, buyButton, infoButton);
    const giveawayMsg = await message.channel.send({ embeds: [embed], components: [row] });
    
    giveaways[giveawayMsg.id] = { 
      prize, 
      endTime, 
      participants: {},
      createdBy: message.author.id,
      channelId: message.channel.id
    };
    saveData();

    setTimeout(() => endGiveaway(giveawayMsg.id), duration);
  }

  else if (command === 'tickets') {
    users[message.author.id] = users[message.author.id] || { tickets: 0, ccoin: 0, invites: 0 };
    message.reply(`🎫 تعداد بلیط‌های شما: ${users[message.author.id].tickets}`);
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;
  const { customId, user, message } = interaction;

  if (customId === 'join_giveaway') {
    const giveaway = giveaways[message.id];
    if (!giveaway) return interaction.reply({ content: '❌ این قرعه‌کشی تمام شده است!', ephemeral: true });
    
    users[user.id] = users[user.id] || { tickets: 0, ccoin: 0, invites: 0 };
    if (users[user.id].tickets === 0) {
      return interaction.reply({ 
        content: '❌ شما بلیط ندارید! با دستور `!buy` می‌توانید بلیط خریداری کنید.', 
        ephemeral: true 
      });
    }

    if (giveaway.participants[user.id]) {
      return interaction.reply({ 
        content: '❌ شما قبلاً در این قرعه‌کشی شرکت کرده‌اید!', 
        ephemeral: true 
      });
    }

    giveaway.participants[user.id] = users[user.id].tickets;
    saveData();

    // به‌روزرسانی embed
    const totalTickets = Object.values(giveaway.participants).reduce((a, b) => a + b, 0);
    const participantsCount = Object.keys(giveaway.participants).length;

    const updatedEmbed = EmbedBuilder.from(message.embeds[0])
      .setDescription(`
        🎁 جایزه: **${giveaway.prize}**
        ⏳ پایان: <t:${Math.floor(giveaway.endTime / 1000)}:R>
        👥 شرکت‌کنندگان: ${participantsCount}
        🎫 مجموع بلیط‌ها: ${totalTickets}
      `);

    await message.edit({ embeds: [updatedEmbed] });
    interaction.reply({ 
      content: `✅ شما با ${users[user.id].tickets} بلیط در قرعه‌کشی شرکت کردید!`, 
      ephemeral: true 
    });
  }

  else if (customId === 'giveaway_info') {
    const giveaway = giveaways[message.id];
    if (!giveaway) return interaction.reply({ content: '❌ این قرعه‌کشی تمام شده است!', ephemeral: true });

    const totalTickets = Object.values(giveaway.participants).reduce((a, b) => a + b, 0);
    const userTickets = giveaway.participants[user.id] || 0;
    const winChance = totalTickets > 0 ? ((userTickets / totalTickets) * 100).toFixed(2) : 0;

    interaction.reply({
      content: `
📊 **اطلاعات شما در این قرعه‌کشی:**
🎫 تعداد بلیط‌های شما: ${userTickets}
🎯 شانس برنده شدن: ${winChance}%
      `,
      ephemeral: true
    });
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

  if (entries.length === 0) {
    const channel = await client.channels.fetch(giveaway.channelId);
    if (channel) {
      channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('❌ قرعه‌کشی لغو شد!')
            .setDescription(`قرعه‌کشی "${giveaway.prize}" به دلیل نداشتن شرکت‌کننده لغو شد.`)
            .setColor('#FF0000')
        ]
      });
    }
  } else {
    const winnerId = entries[Math.floor(Math.random() * entries.length)];
    const channel = await client.channels.fetch(giveaway.channelId);
    if (channel) {
      const winEmbed = new EmbedBuilder()
        .setTitle('🎉 برنده قرعه‌کشی!')
        .setDescription(`
          🏆 برنده: <@${winnerId}>
          🎁 جایزه: **${giveaway.prize}**
          🎫 تعداد بلیط برنده: ${giveaway.participants[winnerId]}
          👥 تعداد کل شرکت‌کنندگان: ${Object.keys(giveaway.participants).length}
        `)
        .setColor('#00FF00')
        .setTimestamp();

      channel.send({ content: `🎊 تبریک <@${winnerId}>!`, embeds: [winEmbed] });
    }
  }

  delete giveaways[messageId];
  saveData();
}

// مدیریت خطاها
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

client.on('error', error => {
  console.error('Discord client error:', error);
});

client.login(process.env.TOKEN);
