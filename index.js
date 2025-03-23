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
    console.error('خطا در ذخیره داده‌ها:', err);
  }
}

function loadData() {
  try {
    if (fs.existsSync('giveaways.json')) {
      giveaways = JSON.parse(fs.readFileSync('giveaways.json', 'utf8'));
      // Convert any object participants to arrays
      Object.values(giveaways).forEach(giveaway => {
        if (!Array.isArray(giveaway.participants)) {
          giveaway.participants = [];
        }
      });
    }
    if (fs.existsSync('users.json')) users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
    if (fs.existsSync('config.json')) {
      const loadedConfig = JSON.parse(fs.readFileSync('config.json', 'utf8'));
      inviteFilterEnabled = loadedConfig.inviteFilterEnabled;
      config.giveawayChannelId = loadedConfig.giveawayChannelId;
      config.winnersChannelId = loadedConfig.winnersChannelId;
      config.inviteRules = loadedConfig.inviteRules || { invites: 3, tickets: 1 };
    }
  } catch (err) {
    console.error('خطا در بارگذاری داده‌ها:', err);
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

client.on('guildMemberAdd', async (member) => {
  try {
    const guildInvites = await member.guild.invites.fetch();
    const cachedInvites = client.invites?.get(member.guild.id) || new Map();

    let usedInvite = null;
    guildInvites.forEach((invite) => {
      const oldInvite = cachedInvites.get(invite.code);
      if (oldInvite && invite.uses > oldInvite.uses && invite.inviter) {
        usedInvite = invite;
      }
    });

    if (usedInvite && usedInvite.inviter) {
      const inviterId = usedInvite.inviter.id;
      users[inviterId] = users[inviterId] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null };

      if (!inviteFilterEnabled || !member.user.bot) {
        if (users[inviterId] && users[inviterId].inviteCode === usedInvite.code) {
          users[inviterId].invites = (users[inviterId].invites || 0) + 1;
          updateTicketsFromInvites(inviterId);
          saveData();
        }
      }
    }

    client.invites?.set(member.guild.id, guildInvites);
  } catch (err) {
    console.error('خطا در بررسی دعوت‌ها:', err);
  }
});

function updateTicketsFromInvites(userId) {
  const invites = users[userId].invites;
  const { invites: requiredInvites, tickets: rewardTickets } = config.inviteRules;
  const tickets = Math.floor(invites / requiredInvites) * rewardTickets;
  users[userId].tickets = Math.max(users[userId].tickets, tickets);
  saveData();
}

client.once('ready', () => {
  console.log(`✅ ربات ${client.user.tag} آنلاین شد!`);
  client.invites = new Map();
  client.guilds.cache.forEach((guild) => {
    guild.invites.fetch().then((invites) => client.invites.set(guild.id, invites));
  });
  setInterval(cleanupExpiredGiveaways, 5 * 60 * 1000);

  const commands = [
    new SlashCommandBuilder()
      .setName('ping')
      .setDescription('بررسی وضعیت ربات'),
    new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('شروع یک قرعه‌کشی جدید')
      .addIntegerOption(option => option.setName('hours').setDescription('مدت زمان به ساعت').setRequired(true))
      .addIntegerOption(option => option.setName('winners').setDescription('تعداد برندگان').setRequired(true))
      .addStringOption(option => option.setName('prize').setDescription('توضیحات جایزه').setRequired(true)),
    new SlashCommandBuilder()
      .setName('invitefilter')
      .setDescription('تنظیم فیلتر دعوت')
      .addStringOption(option => option.setName('state').setDescription('روشن/خاموش').setRequired(true).addChoices({ name: 'روشن', value: 'on' }, { name: 'خاموش', value: 'off' })),
    new SlashCommandBuilder()
      .setName('buy')
      .setDescription('خرید بلیط با سکه')
      .addIntegerOption(option => option.setName('amount').setDescription('تعداد بلیط').setRequired(true)),
    new SlashCommandBuilder()
      .setName('stats')
      .setDescription('مشاهده آمار شما'),
    new SlashCommandBuilder()
      .setName('setccoin')
      .setDescription('تنظیم سکه برای کاربر')
      .addUserOption(option => option.setName('user').setDescription('کاربر مورد نظر').setRequired(true))
      .addIntegerOption(option => option.setName('amount').setDescription('مقدار سکه').setRequired(true)),
    new SlashCommandBuilder()
      .setName('setchannel')
      .setDescription('تنظیم کانال قرعه‌کشی یا برندگان')
      .addStringOption(option => option.setName('type').setDescription('نوع کانال').setRequired(true).addChoices({ name: 'قرعه‌کشی', value: 'giveaway' }, { name: 'برندگان', value: 'winners' }))
      .addChannelOption(option => option.setName('channel').setDescription('کانال مورد نظر').setRequired(true)),
    new SlashCommandBuilder()
      .setName('setinvitetickets')
      .setDescription('تنظیم نسبت دعوت به بلیط')
      .addIntegerOption(option => option.setName('invites').setDescription('تعداد دعوت مورد نیاز').setRequired(true))
      .addIntegerOption(option => option.setName('tickets').setDescription('تعداد بلیط پاداش').setRequired(true))
  ];

  client.application.commands.set(commands);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    const { commandName, options, member } = interaction;

    if (commandName === 'ping') {
      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('🏓 پینگ ربات')
        .setDescription(`**تأخیر:** ${client.ws.ping} میلی‌ثانیه\n**وضعیت:** آنلاین ✅`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'giveaway' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const hours = options.getInteger('hours');
      const winners = options.getInteger('winners');
      const prize = options.getString('prize');

      if (hours <= 0 || winners <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ ساعت و تعداد برندگان باید مثبت باشند!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      if (!config.giveawayChannelId) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ لطفاً ابتدا کانال قرعه‌کشی را با /setchannel تنظیم کنید!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      const duration = hours * 60 * 60 * 1000;
      const endTime = Date.now() + duration;

      const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉✨ گیـــــوآوی جدید ✨🎉')
        .setDescription(`
**🎁 جایـــزه رویاهات:** ${prize}
**⏰ زمان باقی‌مانده:** <t:${Math.floor((Date.now() + duration) / 1000)}:R>
**👑 تعداد برنـــدگان:** ${winners}

**👥 شرکت‌کنندگان:** 0 نفر
**🎫 مجموع بلیط‌ها:** 0

**🔥 چطور بلیط بگیرم؟**
• 👋 دعوت دوستان (${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط)
• 💰 خرید با سکه (/buy)
        `)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setImage('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'شانست رو امتحان کن! 🎈', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();

      const joinButton = new ButtonBuilder()
        .setCustomId('join_giveaway')
        .setLabel('🎉 شرکت در قرعه‌کشی')
        .setStyle(ButtonStyle.Success)
        .setEmoji('🎈');

      const buyButton = new ButtonBuilder()
        .setCustomId('buy_ticket')
        .setLabel('💰 خرید بلیط')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎫');

      const inviteButton = new ButtonBuilder()
        .setCustomId('invite_friends')
        .setLabel('📨 دعوت دوستان')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👋');

      const row = new ActionRowBuilder().addComponents(joinButton, buyButton, inviteButton);
      const message = await client.channels.cache.get(config.giveawayChannelId).send({ embeds: [embed], components: [row] });

      giveaways[message.id] = {
        prize,
        endTime,
        winners,
        participants: [],
        messageId: message.id,
        channelId: config.giveawayChannelId
      };
      saveData();

      setTimeout(() => endGiveaway(message.id), duration);

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ موفقیت!')
        .setDescription('🎉 قرعه‌کشی با موفقیت شروع شد!')
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], ephemeral: true });
    }

    else if (commandName === 'invitefilter' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      inviteFilterEnabled = options.getString('state') === 'on';
      saveData();
      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیمات فیلتر')
        .setDescription(`🎯 فیلتر دعوت ${inviteFilterEnabled ? 'فعال' : 'غیرفعال'} شد.`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'buy') {
      const amount = options.getInteger('amount');
      if (amount <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ تعداد بلیط باید مثبت باشد!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      const cost = amount <= 2 ? amount * 1000 : amount === 3 ? 2800 : amount * 900;
      users[interaction.user.id] = users[interaction.user.id] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null };

      if (users[interaction.user.id].ccoin < cost) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ سکه کافی نداری!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      users[interaction.user.id].ccoin -= cost;
      users[interaction.user.id].tickets += amount;
      saveData();

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ خرید موفق!')
        .setDescription(`🎫 ${amount} بلیط به قیمت ${cost} سکه خریدی!`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], ephemeral: true });
    }

    else if (commandName === 'stats') {
      users[interaction.user.id] = users[interaction.user.id] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null };
      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('📊 آمار شما')
        .setDescription(`
**🎫 بلیط‌ها:** ${users[interaction.user.id].tickets}
**💰 سکه‌ها:** ${users[interaction.user.id].ccoin}
**📨 دعوت‌ها:** ${users[interaction.user.id].invites}
        `)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'setccoin' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const targetUser = options.getUser('user');
      const amount = options.getInteger('amount');
      users[targetUser.id] = users[targetUser.id] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null };
      users[targetUser.id].ccoin = amount;
      saveData();

      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیم سکه')
        .setDescription(`💰 سکه‌های ${targetUser.tag} به ${amount} تنظیم شد.`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'setchannel' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const type = options.getString('type');
      const channel = options.getChannel('channel');
      if (type === 'giveaway') config.giveawayChannelId = channel.id;
      else if (type === 'winners') config.winnersChannelId = channel.id;
      saveData();

      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیم کانال')
        .setDescription(`📢 کانال ${type === 'giveaway' ? 'قرعه‌کشی' : 'برندگان'} به ${channel} تنظیم شد.`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'setinvitetickets' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const invites = options.getInteger('invites');
      const tickets = options.getInteger('tickets');
      if (invites <= 0 || tickets <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ تعداد دعوت‌ها و بلیط‌ها باید مثبت باشد!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      config.inviteRules = { invites, tickets };
      saveData();

      Object.keys(users).forEach(userId => updateTicketsFromInvites(userId));

      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیم قانون دعوت')
        .setDescription(`📜 قانون جدید: ${invites} دعوت = ${tickets} بلیط`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }
  }

  if (interaction.isButton()) {
    if (interaction.customId === 'join_giveaway') {
      const giveaway = giveaways[interaction.message.id];
      if (!giveaway) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ این قرعه‌کشی تمام شده است!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      const userId = interaction.user.id;
      users[userId] = users[userId] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null };

      if (users[userId].tickets === 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ بدون بلیط!')
          .setDescription(`⛔ شما بلیط ندارید!\n**چطور بلیط بگیرم؟**\n• 👋 دعوت دوستان (${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط)\n• 💰 خرید با سکه (/buy)`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();

        const buyButton = new ButtonBuilder()
          .setCustomId('buy_ticket')
          .setLabel('💰 خرید بلیط')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('🎫');

        const inviteButton = new ButtonBuilder()
          .setCustomId('invite_friends')
          .setLabel('📨 دعوت دوستان')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('👋');

        const row = new ActionRowBuilder().addComponents(buyButton, inviteButton);
        return interaction.reply({ embeds: [errorEmbed], components: [row], ephemeral: true });
      }

      if (giveaway.participants.includes(userId)) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ شما قبلاً در این قرعه‌کشی شرکت کرده‌اید!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      giveaway.participants.push(userId);
      saveData();

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ ثبت‌نام موفق!')
        .setDescription(`🎉 با ${users[userId].tickets} بلیط در قرعه‌کشی شرکت کردید!`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], ephemeral: true });

      const totalTickets = giveaway.participants.reduce((sum, id) => sum + users[id].tickets, 0);
      const updatedEmbed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle('🎉✨ گیـــــوآوی جدید ✨🎉')
        .setDescription(`
**🎁 جایـــزه رویاهات:** ${giveaway.prize}
**⏰ زمان باقی‌مانده:** <t:${Math.floor(giveaway.endTime / 1000)}:R>
**👑 تعداد برنـــدگان:** ${giveaway.winners}

**👥 شرکت‌کنندگان:** ${giveaway.participants.length} نفر
**🎫 مجموع بلیط‌ها:** ${totalTickets}

**🔥 چطور بلیط بگیرم؟**
• 👋 دعوت دوستان (${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط)
• 💰 خرید با سکه (/buy)
        `)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setImage('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'شانست رو امتحان کن! 🎈', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();

      await interaction.message.edit({ embeds: [updatedEmbed] });
    }

    else if (interaction.customId === 'buy_ticket') {
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('💰 خرید بلیط')
        .setDescription('برای خرید بلیط از `/buy <تعداد>` استفاده کنید\n**مثال:** `/buy 3`')
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (interaction.customId === 'invite_friends') {
      if (users[interaction.user.id]?.inviteCode) {
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📨 لینک دعوت شما')
          .setDescription(`لینک اختصاصی شما:\nhttps://discord.gg/${users[interaction.user.id].inviteCode}\n**دعوت دوستان:** ${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
      }

      const channel = interaction.guild.channels.cache.get(config.giveawayChannelId);
      if (!channel) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ کانال قرعه‌کشی پیدا نشد!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }

      try {
        const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `دعوت برای ${interaction.user.tag}` });
        users[interaction.user.id] = users[interaction.user.id] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null };
        users[interaction.user.id].inviteCode = invite.code;
        saveData();

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📨 لینک دعوت شما')
          .setDescription(`لینک اختصاصی شما:\n${invite.url}\n**دعوت دوستان:** ${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], ephemeral: true });
      } catch (err) {
        console.error('خطا در ساخت لینک دعوت:', err);
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ نمی‌توانم لینک دعوت بسازیم! لطفاً دسترسی‌های ربات را بررسی کنید.')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
      }
    }

    else if (interaction.customId === 'claim_prize' && interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const channel = interaction.channel;
      const winnerId = channel.name.split('-')[1];
      const proof = channel.messages.cache.last()?.attachments.first()?.url || 'بدون مدرک';

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🏆✨ تأیید دریافت جایزه ✨🏆')
        .setDescription(`
**👤 برنده:** <@${winnerId}>
**🎁 جایزه دریافت شد:** ✅
**📸 مدرک:** ${proof}
        `)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await client.channels.cache.get(config.winnersChannelId).send({ embeds: [embed] });

      users[winnerId].ccoin = (users[winnerId].ccoin || 0) + 100;
      saveData();

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تأیید شد!')
        .setDescription('🎉 جایزه تأیید شد و در کانال عمومی منتشر شد.\n**پاداش:** 100 سکه به برنده اضافه شد!')
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], ephemeral: true });

      setTimeout(() => channel.delete(), 24 * 60 * 60 * 1000);
    }
  }
});

async function endGiveaway(messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway) return;

  const entries = [];
  giveaway.participants.forEach((userId) => {
    const tickets = users[userId].tickets;
    for (let i = 0; i < tickets; i++) {
      entries.push(userId);
    }
  });

  const channel = await client.channels.fetch(giveaway.channelId);
  if (!channel) return;

  if (entries.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('#FF5555')
      .setTitle('❌ قرعه‌کشی لغو شد!')
      .setDescription(`⛔ هیچ شرکت‌کننده‌ای برای قرعه‌کشی "${giveaway.prize}" وجود نداشت.`)
      .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
      .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
      .setTimestamp();
    await channel.send({ embeds: [embed] });
  } else {
    const winners = new Set();
    while (winners.size < giveaway.winners && winners.size < entries.length) {
      winners.add(entries[Math.floor(Math.random() * entries.length)]);
    }

    const winnersArray = Array.from(winners);
    const winnersText = winnersArray.map((id, index) => `🏅 **نفر ${index + 1}:** <@${id}>`).join('\n');

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🎊✨ برنـــدگان گیـــوآوی ✨🎊')
      .setDescription(`
**🎁 جایـــزه:** ${giveaway.prize}

**👑 برنـــدگان خوش‌شانس:**
${winnersText}

**🎉 تبریک به همه برندگان!**
لطفاً برای دریافت جایزه به پیام خصوصی ربات مراجعه کنید.
      `)
      .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
      .setImage('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
      .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
      .setTimestamp();
    await channel.send({ embeds: [embed] });

    for (const winnerId of winnersArray) {
      try {
        const user = await client.users.fetch(winnerId);
        const dmEmbed = new EmbedBuilder()
          .setColor('#00FF88')
          .setTitle('🎉✨ برنده شدید! ✨🎉')
          .setDescription(`تبریک! شما برنده قرعه‌کشی "${giveaway.prize}" شدید!\nلطفاً در کانال خصوصی‌تان با ادمین هماهنگ کنید.`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
          .setTimestamp();
        await user.send({ embeds: [dmEmbed] });
      } catch (err) {
        console.error(`خطا در ارسال پیام به ${winnerId}:`, err);
      }

      const winnerChannel = await channel.guild.channels.create({
        name: `winner-${winnerId}`,
        type: 0,
        permissionOverwrites: [
          { id: channel.guild.id, deny: ['ViewChannel'] },
          { id: winnerId, allow: ['ViewChannel', 'SendMessages'] },
          { id: channel.guild.roles.cache.find(r => r.permissions.has(PermissionsBitField.Flags.Administrator))?.id, allow: ['ViewChannel', 'SendMessages'] }
        ]
      });

      const claimButton = new ButtonBuilder()
        .setCustomId('claim_prize')
        .setLabel('🎁 جایزه تحویل داده شد')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅');

      const row = new ActionRowBuilder().addComponents(claimButton);

      const instructionEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('📢 هماهنگی جایزه')
        .setDescription('لطفاً جایزه خود را تأیید کنید! (عکس، متن یا اسکرین‌شات بفرستید)')
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png?ex=67e114db&is=67dfc35b&hm=1f0bb9731a789455c9c97aa1b9420c4d9e63ec670501b5232b334f1fb6e083d5&')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg?ex=67e114e5&is=67dfc365&hm=f8c13fcc15c17219bd8eb8b6aa25058dd377fbacdffc946310835d9df7d3cfdc&' })
        .setTimestamp();

      await winnerChannel.send({ content: `<@${winnerId}>`, embeds: [instructionEmbed], components: [row] });
    }
  }

  delete giveaways[messageId];
  saveData();
}

client.login(process.env.TOKEN);