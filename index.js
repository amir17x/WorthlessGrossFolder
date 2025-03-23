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
  inviteRules: { invites: 3, tickets: 1 },
  adminRoleId: null,
  ticketPrice: 1000,
  alertEnabled: false,
  alertMinutes: 15
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
      config = { ...config, ...loadedConfig };
    }
  } catch (err) {
    console.error('خطا در بارگذاری داده‌ها:', err);
    giveaways = {};
    users = {};
    inviteFilterEnabled = true;
    config = { giveawayChannelId: null, winnersChannelId: null, inviteRules: { invites: 3, tickets: 1 }, adminRoleId: null, ticketPrice: 1000, alertEnabled: false, alertMinutes: 15 };
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
      users[inviterId] = users[inviterId] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null, lastInvite: 0, inviteHistory: [], ticketsFromInvites: 0 };

      if (!inviteFilterEnabled || !member.user.bot) {
        const now = Date.now();
        users[inviterId].invites = (users[inviterId].invites || 0) + 1;
        users[inviterId].lastInvite = now;
        users[inviterId].inviteCode = usedInvite.code;

        users[inviterId].inviteHistory.push({
          userId: member.user.id,
          username: member.user.tag,
          timestamp: now,
          inviteCode: usedInvite.code
        });

        if (users[inviterId].inviteHistory.length > 5) {
          users[inviterId].inviteHistory = users[inviterId].inviteHistory.slice(-5);
        }

        updateTicketsFromInvites(inviterId);
        saveData();

        const channel = client.channels.cache.get(config.giveawayChannelId);
        if (channel) {
          const embed = new EmbedBuilder()
            .setColor('#00FF88')
            .setTitle('📨 دعوت جدید!')
            .setDescription(`
🎉 <@${inviterId}> کاربر ${member.user.tag} رو دعوت کرد!
📊 **آمار دعوت‌ها:**
• تعداد کل: ${users[inviterId].invites}
• بلیط‌های دریافتی: ${users[inviterId].ticketsFromInvites}
• تا بلیط بعدی: ${config.inviteRules.invites - (users[inviterId].invites % config.inviteRules.invites)} دعوت دیگر

🔗 **کد دعوت:** \`${usedInvite.code}\``)
            .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
            .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
            .setTimestamp();
          const message = await channel.send({ embeds: [embed] });
          if (config.alertEnabled) setTimeout(() => message.delete(), config.alertMinutes * 60 * 1000);
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
  users[userId].ticketsFromInvites = tickets;
  users[userId].tickets = (users[userId].tickets || 0) + tickets - users[userId].ticketsFromInvites;
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
    new SlashCommandBuilder().setName('ping').setDescription('بررسی وضعیت ربات'),
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
      .addIntegerOption(option => option.setName('tickets').setDescription('تعداد بلیط پاداش').setRequired(true)),
    new SlashCommandBuilder()
      .setName('setrole')
      .setDescription('تنظیم نقش برای مدیریت دستورات حساس')
      .addRoleOption(option => option.setName('role').setDescription('نقش مورد نظر').setRequired(true)),
    new SlashCommandBuilder()
      .setName('alert')
      .setDescription('تنظیم حذف خودکار پیام‌ها')
      .addStringOption(option => option.setName('action').setDescription('عمل').setRequired(true).addChoices({ name: 'تنظیم', value: 'set' }, { name: 'خاموش', value: 'off' }))
      .addIntegerOption(option => option.setName('minutes').setDescription('دقیقه').setRequired(false)),
    new SlashCommandBuilder()
      .setName('userstats')
      .setDescription('مشاهده آمار کاربر')
      .addUserOption(option => option.setName('user').setDescription('کاربر').setRequired(true))
  ];

  client.application.commands.set(commands);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isCommand()) {
    const { commandName, options, member } = interaction;

    const hasAdminRole = () => {
      if (!config.adminRoleId) return member.permissions.has(PermissionsBitField.Flags.Administrator);
      return member.roles.cache.has(config.adminRoleId);
    };

    if (commandName === 'ping') {
      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('🏓 پینگ ربات')
        .setDescription(`**تأخیر:** ${client.ws.ping} میلی‌ثانیه\n**وضعیت:** آنلاین ✅`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }

    else if (commandName === 'giveaway' && hasAdminRole()) {
      const hours = options.getInteger('hours');
      const winners = options.getInteger('winners');
      const prize = options.getString('prize');

      if (hours <= 0 || winners <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ ساعت و تعداد برندگان باید مثبت باشند!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      if (!config.giveawayChannelId) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ لطفاً ابتدا کانال قرعه‌کشی را با /setchannel تنظیم کنید!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
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
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setImage('https://cdn.discordapp.com/attachments/1344927538740203590/1353328718507933706/2304.w018.n002.1764B.p15.1764.jpg')
        .setFooter({ text: 'شانست رو امتحان کن! 🎈', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
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

      const cancelButton = new ButtonBuilder()
        .setCustomId('cancel_giveaway')
        .setLabel('❌ لغو قرعه‌کشی')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🚫');

      const row = new ActionRowBuilder().addComponents(joinButton, buyButton, inviteButton, cancelButton);
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
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], flags: [4096] });
    }

    else if (commandName === 'invitefilter' && hasAdminRole()) {
      inviteFilterEnabled = options.getString('state') === 'on';
      saveData();
      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیمات فیلتر')
        .setDescription(`🎯 فیلتر دعوت ${inviteFilterEnabled ? 'فعال' : 'غیرفعال'} شد.`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'رب-ات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }

    else if (commandName === 'buy') {
      const amount = options.getInteger('amount');
      if (amount <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ تعداد بلیط باید مثبت باشد!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      const cost = amount <= 2 ? amount * config.ticketPrice : amount === 3 ? 2800 : amount * 900;
      users[interaction.user.id] = users[interaction.user.id] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null, lastInvite: 0, inviteHistory: [], ticketsFromInvites: 0 };

      if (users[interaction.user.id].ccoin < cost) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ سکه کافی نداری!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      users[interaction.user.id].ccoin -= cost;
      users[interaction.user.id].tickets += amount;
      saveData();

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ خرید موفق!')
        .setDescription(`🎫 ${amount} بلیط به قیمت ${cost} سکه خریدی!`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], flags: [4096] });
    }

    else if (commandName === 'stats') {
      users[interaction.user.id] = users[interaction.user.id] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null, lastInvite: 0, inviteHistory: [], ticketsFromInvites: 0 };
      const lastInviteTime = users[interaction.user.id].lastInvite ? `<t:${Math.floor(users[interaction.user.id].lastInvite / 1000)}:R>` : 'هنوز دعوتی انجام نشده';
      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('📊 آمار شما')
        .setDescription(`
**🎫 بلیط‌ها:** ${users[interaction.user.id].tickets}
**💰 سکه‌ها:** ${users[interaction.user.id].ccoin}
**📨 دعوت‌ها:** ${users[interaction.user.id].invites}
**⏰ آخرین دعوت:** ${lastInviteTime}
        `)
        .setThumbnail(interaction.user.displayAvatarURL())
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }

    else if (commandName === 'setccoin' && hasAdminRole()) {
      const targetUser = options.getUser('user');
      const amount = options.getInteger('amount');
      users[targetUser.id] = users[targetUser.id] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null, lastInvite: 0, inviteHistory: [], ticketsFromInvites: 0 };
      users[targetUser.id].ccoin = amount;
      saveData();

      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیم سکه')
        .setDescription(`💰 سکه‌های ${targetUser.tag} به ${amount} تنظیم شد.`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }

    else if (commandName === 'setchannel' && hasAdminRole()) {
      const type = options.getString('type');
      const channel = options.getChannel('channel');
      if (type === 'giveaway') config.giveawayChannelId = channel.id;
      else if (type === 'winners') config.winnersChannelId = channel.id;
      saveData();

      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیم کانال')
        .setDescription(`📢 کانال ${type === 'giveaway' ? 'قرعه‌کشی' : 'برندگان'} به ${channel} تنظیم شد.`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }

    else if (commandName === 'setinvitetickets' && hasAdminRole()) {
      const invites = options.getInteger('invites');
      const tickets = options.getInteger('tickets');
      if (invites <= 0 || tickets <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ تعداد دعوت‌ها و بلیط‌ها باید مثبت باشد!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      config.inviteRules = { invites, tickets };
      saveData();

      Object.keys(users).forEach(userId => updateTicketsFromInvites(userId));

      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیم قانون دعوت')
        .setDescription(`📜 قانون جدید: ${invites} دعوت = ${tickets} بلیط`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }

    else if (commandName === 'setrole' && member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      const role = options.getRole('role');
      config.adminRoleId = role.id;
      saveData();

      const embed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تنظیم نقش مدیریت')
        .setDescription(`📜 نقش مدیریت دستورات حساس به ${role} تنظیم شد.`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }

    else if (commandName === 'alert' && hasAdminRole()) {
      const action = options.getString('action');
      if (action === 'set') {
        const minutes = options.getInteger('minutes');
        if (!minutes || minutes <= 0) {
          const errorEmbed = new EmbedBuilder()
            .setColor('#FF5555')
            .setTitle('❌ خطا!')
            .setDescription('⛔ لطفاً زمان مثبت وارد کنید!')
            .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
            .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
            .setTimestamp();
          return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
        }
        config.alertEnabled = true;
        config.alertMinutes = minutes;
        saveData();
        const embed = new EmbedBuilder()
          .setColor('#00FF88')
          .setTitle('✅ تنظیم حذف خودکار')
          .setDescription(`📢 پیام‌ها بعد از ${minutes} دقیقه حذف می‌شوند.`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], flags: [4096] });
      } else if (action === 'off') {
        config.alertEnabled = false;
        saveData();
        const embed = new EmbedBuilder()
          .setColor('#00FF88')
          .setTitle('✅ تنظیم حذف خودکار')
          .setDescription('📢 حذف خودکار پیام‌ها خاموش شد.')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        await interaction.reply({ embeds: [embed], flags: [4096] });
      }
    }

    else if (commandName === 'userstats' && hasAdminRole()) {
      const user = options.getUser('user');
      users[user.id] = users[user.id] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null, lastInvite: 0, inviteHistory: [], ticketsFromInvites: 0 };
      const lastInviteTime = users[user.id].lastInvite ? `<t:${Math.floor(users[user.id].lastInvite / 1000)}:R>` : 'هنوز دعوتی انجام نشده';
      const inviteHistory = users[user.id].inviteHistory.length > 0 
        ? users[user.id].inviteHistory.map((entry, index) => `**${index + 1}.** ${entry.username} (<t:${Math.floor(entry.timestamp / 1000)}:R>)`).join('\n')
        : 'هیچ دعوتی ثبت نشده است.';
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📊 آمار کاربر ${user.tag}`)
        .setDescription(`
**🆔 آیدی:** ${user.id}
**🎫 بلیط‌ها:** ${users[user.id].tickets}
**💰 سکه‌ها:** ${users[user.id].ccoin}
**📨 دعوت‌ها:** ${users[user.id].invites}
**⏰ آخرین دعوت:** ${lastInviteTime}
**📜 تاریخچه دعوت‌ها (5 مورد آخر):**\n${inviteHistory}
        `)
        .setThumbnail(user.displayAvatarURL())
        .setFooter({ text: 'پنل ادمین', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }
  }

  if (interaction.isButton()) {
    const hasAdminRole = () => {
      if (!config.adminRoleId) return interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
      return interaction.member.roles.cache.has(config.adminRoleId);
    };

    if (interaction.customId === 'join_giveaway') {
      const giveaway = giveaways[interaction.message.id];
      if (!giveaway) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ این قرعه‌کشی تمام شده است!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      const userId = interaction.user.id;
      users[userId] = users[userId] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null, lastInvite: 0, inviteHistory: [], ticketsFromInvites: 0 };

      if (users[userId].tickets < 1) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ بدون بلیط!')
          .setDescription(`⛔ شما بلیط کافی ندارید!\n**چطور بلیط بگیرم؟**\n• 👋 دعوت دوستان (${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط)\n• 💰 خرید با سکه (/buy)`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
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
        return interaction.reply({ embeds: [errorEmbed], components: [row], flags: [4096] });
      }

      if (giveaway.participants.includes(userId)) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ شما قبلاً در این قرعه‌کشی شرکت کرده‌اید!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      users[userId].tickets -= 1;
      giveaway.participants.push(userId);
      saveData();

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ ثبت‌نام موفق!')
        .setDescription(`🎉 با موفقیت در قرعه‌کشی شرکت کردید!\n**بلیط‌های باقی‌مانده:** ${users[userId].tickets}`)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], flags: [4096] });

      const totalTickets = giveaway.participants.length;
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
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setImage('https://cdn.discordapp.com/attachments/1344927538740203590/1353328718507933706/2304.w018.n002.1764B.p15.1764.jpg')
        .setFooter({ text: 'شانست رو امتحان کن! 🎈', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();

      await interaction.message.edit({ embeds: [updatedEmbed] });
    }

    else if (interaction.customId === 'buy_ticket') {
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('💰 خرید بلیط')
        .setDescription(`برای خرید بلیط از \`/buy <تعداد>\` استفاده کنید\n**قیمت هر بلیط:** ${config.ticketPrice} سکه\n**مثال:** \`/buy 3\``)
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: [4096] });
    }

    else if (interaction.customId === 'invite_friends') {
      const userId = interaction.user.id;
      users[userId] = users[userId] || { tickets: 0, ccoin: 0, invites: 0, inviteCode: null, lastInvite: 0, inviteHistory: [], ticketsFromInvites: 0 };

      const channel = interaction.guild.channels.cache.get(config.giveawayChannelId);
      if (!channel) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ کانال قرعه‌کشی پیدا نشد!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      if (users[userId].inviteCode) {
        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📨 لینک دعوت شما')
          .setDescription(`لینک اختصاصی شما:\nhttps://discord.gg/${users[userId].inviteCode}\n**دعوت دوستان:** ${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();

        const regenerateButton = new ButtonBuilder()
          .setCustomId('regenerate_invite')
          .setLabel('🔄 ساخت مجدد لینک')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔗');

        const row = new ActionRowBuilder().addComponents(regenerateButton);
        return interaction.reply({ embeds: [embed], components: [row], flags: [4096] });
      }

      try {
        const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `دعوت برای ${interaction.user.tag}` });
        users[userId].inviteCode = invite.code;
        saveData();

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📨 لینک دعوت شما')
          .setDescription(`لینک اختصاصی شما:\n${invite.url}\n**دعوت دوستان:** ${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();

        const regenerateButton = new ButtonBuilder()
          .setCustomId('regenerate_invite')
          .setLabel('🔄 ساخت مجدد لینک')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔗');

        const row = new ActionRowBuilder().addComponents(regenerateButton);
        await interaction.reply({ embeds: [embed], components: [row], flags: [4096] });
      } catch (err) {
        console.error('خطا در ساخت لینک دعوت:', err);
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ نمی‌توانم لینک دعوت بسازیم! لطفاً دسترسی‌های ربات را بررسی کنید.')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        await interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }
    }

    else if (interaction.customId === 'regenerate_invite') {
      const userId = interaction.user.id;
      const channel = interaction.guild.channels.cache.get(config.giveawayChannelId);
      if (!channel) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ کانال قرعه‌کشی پیدا نشد!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      try {
        const invite = await channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: `دعوت جدید برای ${interaction.user.tag}` });
        users[userId].inviteCode = invite.code;
        saveData();

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('📨 لینک دعوت جدید شما')
          .setDescription(`لینک اختصاصی جدید شما:\n${invite.url}\n**دعوت دوستان:** ${config.inviteRules.invites} دعوت = ${config.inviteRules.tickets} بلیط`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();

        const regenerateButton = new ButtonBuilder()
          .setCustomId('regenerate_invite')
          .setLabel('🔄 ساخت مجدد لینک')
          .setStyle(ButtonStyle.Secondary)
          .setEmoji('🔗');

        const row = new ActionRowBuilder().addComponents(regenerateButton);
        await interaction.update({ embeds: [embed], components: [row], flags: [4096] });
      } catch (err) {
        console.error('خطا در ساخت لینک دعوت جدید:', err);
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ نمی‌توانم لینک دعوت جدید بسازیم! لطفاً دسترسی‌های ربات را بررسی کنید.')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        await interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }
    }

    else if (interaction.customId === 'cancel_giveaway') {
      if (!hasAdminRole()) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ شما دسترسی لازم برای لغو قرعه‌کشی را ندارید!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      const giveaway = giveaways[interaction.message.id];
      if (!giveaway) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ خطا!')
          .setDescription('⛔ این قرعه‌کشی قبلاً تمام شده است!')
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        return interaction.reply({ embeds: [errorEmbed], flags: [4096] });
      }

      const channel = await client.channels.fetch(giveaway.channelId);
      if (channel) {
        const cancelEmbed = new EmbedBuilder()
          .setColor('#FF5555')
          .setTitle('❌ قرعه‌کشی لغو شد!')
          .setDescription(`⛔ قرعه‌کشی "${giveaway.prize}" توسط <@${interaction.user.id}> لغو شد.`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        const message = await channel.send({ embeds: [cancelEmbed] });
        if (config.alertEnabled) setTimeout(() => message.delete(), config.alertMinutes * 60 * 1000);
      }

      delete giveaways[interaction.message.id];
      saveData();

      await interaction.message.delete();

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ قرعه‌کشی لغو شد!')
        .setDescription('🎉 قرعه‌کشی با موفقیت لغو شد.')
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], flags: [4096] });
    }

    else if (interaction.customId === 'claim_prize' && hasAdminRole()) {
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
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      const publicChannel = client.channels.cache.get(config.winnersChannelId);
      if (publicChannel) {
        const message = await publicChannel.send({ embeds: [embed] });
        if (config.alertEnabled) setTimeout(() => message.delete(), config.alertMinutes * 60 * 1000);
      }

      users[winnerId].ccoin = (users[winnerId].ccoin || 0) + 100;
      saveData();

      const successEmbed = new EmbedBuilder()
        .setColor('#00FF88')
        .setTitle('✅ تأیید شد!')
        .setDescription('🎉 جایزه تأیید شد و در کانال عمومی منتشر شد.\n**پاداش:** 100 سکه به برنده اضافه شد!')
        .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
        .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
        .setTimestamp();
      await interaction.reply({ embeds: [successEmbed], flags: [4096] });

      setTimeout(() => channel.delete(), 24 * 60 * 60 * 1000);
    }
  }
});

async function endGiveaway(messageId) {
  const giveaway = giveaways[messageId];
  if (!giveaway) return;

  const entries = [];
  giveaway.participants.forEach((userId) => {
    entries.push(userId);
  });

  const channel = await client.channels.fetch(giveaway.channelId);
  if (!channel) return;

  if (entries.length === 0) {
    const embed = new EmbedBuilder()
      .setColor('#FF5555')
      .setTitle('❌ قرعه‌کشی لغو شد!')
      .setDescription(`⛔ هیچ شرکت‌کننده‌ای برای قرعه‌کشی "${giveaway.prize}" وجود نداشت.`)
      .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
      .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
      .setTimestamp();
    const message = await channel.send({ embeds: [embed] });
    if (config.alertEnabled) setTimeout(() => message.delete(), config.alertMinutes * 60 * 1000);
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
      .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
      .setImage('https://cdn.discordapp.com/attachments/1344927538740203590/1353328718507933706/2304.w018.n002.1764B.p15.1764.jpg')
      .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
      .setTimestamp();
    const message = await channel.send({ embeds: [embed] });
    if (config.alertEnabled) setTimeout(() => message.delete(), config.alertMinutes * 60 * 1000);

    for (const winnerId of winnersArray) {
      try {
        const user = await client.users.fetch(winnerId);
        const dmEmbed = new EmbedBuilder()
          .setColor('#00FF88')
          .setTitle('🎉✨ برنده شدید! ✨🎉')
          .setDescription(`تبریک! شما برنده قرعه‌کشی "${giveaway.prize}" شدید!\nلطفاً برای هماهنگی به چنل خصوصی بروید.`)
          .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
          .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
          .setTimestamp();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setLabel('رفتن به چنل خصوصی')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://discord.com/channels/${channel.guild.id}/${config.winnersChannelId}`)
        );
        await user.send({ embeds: [dmEmbed], components: [row] });

        const privateChannel = client.channels.cache.get(config.winnersChannelId);
        if (privateChannel) {
          const thread = await privateChannel.threads.create({
            name: `برنده-${winnerId}`,
            autoArchiveDuration: 60,
            reason: 'Thread برای برنده'
          });
          await thread.members.add(winnerId);
          await thread.send(`<@${winnerId}>، لطفاً مدارک خود را ارسال کنید.`);

          const threadEmbed = new EmbedBuilder()
            .setColor('#5865F2')
            .setTitle('📢 هماهنگی جایزه')
            .setDescription('لطفاً مدارک خود را بفرستید (عکس، متن یا اسکرین‌شات)')
            .setThumbnail('https://cdn.discordapp.com/attachments/1344927538740203590/1353281227469225984/icons8-giveaway-100.png')
            .setFooter({ text: 'ربات قرعه‌کشی', iconURL: 'https://cdn.discordapp.com/attachments/1344927538740203590/1353281270066446397/peakpx_1.jpg' })
            .setTimestamp();

          const claimButton = new ButtonBuilder()
            .setCustomId('claim_prize')
            .setLabel('🎁 جایزه تحویل داده شد')
            .setStyle(ButtonStyle.Success)
            .setEmoji('✅');

          const threadRow = new ActionRowBuilder().addComponents(claimButton);
          await thread.send({ embeds: [threadEmbed], components: [threadRow] });
        }
      } catch (err) {
        console.error(`خطا در ارسال پیام به ${winnerId}:`, err);
      }
    }
  }

  delete giveaways[messageId];
  saveData();
}

client.login(process.env.TOKEN);