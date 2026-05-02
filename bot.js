const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const https = require('https');

// ===== НАСТРОЙКИ =====
// Вставьте токен от @BotFather:
const TOKEN = process.env.BOT_TOKEN || '8750691630:AAFBa2H0ETvs25QT9kfYxF8Q4hEuOM9DkGE';

if (TOKEN === 'ВСТАВЬТЕ_ТОКЕН_СЮДА') {
  console.error('\n❌ Ошибка: вставьте токен бота!');
  console.error('   Откройте bot.js и замените ВСТАВЬТЕ_ТОКЕН_СЮДА на токен от @BotFather\n');
  process.exit(1);
}

// ===== INIT =====
const bot = new TelegramBot(TOKEN, { polling: true });
const db = new Database(path.join(__dirname, 'torals.db'));
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Хранилище выбранных проектов (chatId → projectId)
const userProject = {};

console.log('\n🤖 ТОРАЛС Бот запущен');
console.log('📸 Готов принимать фото и видео\n');

// ===== ADMIN CHAT ID =====
// Запоминаем chat_id админа для уведомлений с сайта
let adminChatId = null;
try {
  const savedId = fs.readFileSync(path.join(__dirname, '.admin_chat_id'), 'utf8').trim();
  if (savedId) { adminChatId = savedId; global.adminChatId = savedId; }
} catch(e) {}

function saveAdminChatId(chatId) {
  adminChatId = String(chatId);
  global.adminChatId = adminChatId;
  try { fs.writeFileSync(path.join(__dirname, '.admin_chat_id'), adminChatId); } catch(e) {}
}

// Уведомление админу
function notifyAdmin(text) {
  if (!adminChatId) return;
  bot.sendMessage(adminChatId, text, { parse_mode: 'Markdown' }).catch(function(){});
}

// ===== КОМАНДЫ =====

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.first_name || 'Коллега';

  // Проверяем, является ли пользователь админом
  const user = db.prepare('SELECT * FROM users WHERE role = "admin"').get();

  await bot.sendMessage(chatId,
    `👋 Привет, ${name}!\n\n` +
    `Я бот компании *ТОРАЛС*.\n` +
    `Отправляй мне фото и видео с объектов — они автоматически появятся на сайте.\n\n` +
    `📁 Выбери объект: /projects\n` +
    `🔔 Включить уведомления: /notify`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/notify/, async (msg) => {
  const chatId = msg.chat.id;
  saveAdminChatId(chatId);
  await bot.sendMessage(chatId,
    '🔔 *Уведомления включены!*\n\nТеперь вы будете получать:\n• Заявки с сайта\n• Уведомления о загруженных фото\n• Новые позиции в сметах',
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/projects/, async (msg) => {
  await showProjects(msg.chat.id);
});

bot.onText(/\/help/, async (msg) => {
  await bot.sendMessage(msg.chat.id,
    `📋 *Команды:*\n\n` +
    `/projects — выбрать объект\n` +
    `/current — текущий объект\n` +
    `/help — помощь\n\n` +
    `📸 Просто отправляй фото или видео — они загрузятся на сайт в выбранный объект.`,
    { parse_mode: 'Markdown' }
  );
});

bot.onText(/\/current/, async (msg) => {
  const chatId = msg.chat.id;
  const pid = userProject[chatId];
  if (!pid) {
    await bot.sendMessage(chatId, '⚠️ Объект не выбран. Нажми /projects');
    return;
  }
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(pid);
  if (!proj) {
    await bot.sendMessage(chatId, '⚠️ Объект не найден. Нажми /projects');
    return;
  }
  const photoCount = db.prepare('SELECT COUNT(*) as c FROM project_photos WHERE project_id = ?').get(pid).c;
  await bot.sendMessage(chatId,
    `📁 Текущий объект: *${proj.name}*\n📸 Загружено фото: ${photoCount}\n\nОтправляй фото/видео — они добавятся сюда.`,
    { parse_mode: 'Markdown' }
  );
});

// ===== ПОКАЗ ПРОЕКТОВ =====
async function showProjects(chatId) {
  const projects = db.prepare('SELECT id, name, address FROM projects WHERE status = "active" ORDER BY created_at DESC').all();

  if (!projects.length) {
    await bot.sendMessage(chatId, '📁 Активных объектов нет. Создайте объект на сайте.');
    return;
  }

  const keyboard = projects.map(p => {
    const label = p.name + (p.address ? ' (' + p.address + ')' : '');
    return [{ text: '📁 ' + label, callback_data: 'proj_' + p.id }];
  });

  await bot.sendMessage(chatId, '📁 Выберите объект:', {
    reply_markup: { inline_keyboard: keyboard }
  });
}

// ===== ВЫБОР ПРОЕКТА =====
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data.startsWith('proj_')) {
    const pid = parseInt(data.replace('proj_', ''));
    const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(pid);
    if (!proj) {
      await bot.answerCallbackQuery(query.id, { text: '❌ Объект не найден' });
      return;
    }
    userProject[chatId] = pid;
    await bot.answerCallbackQuery(query.id, { text: '✅ ' + proj.name });
    await bot.sendMessage(chatId,
      `✅ Выбран объект: *${proj.name}*\n\n📸 Теперь отправляйте фото и видео — они загрузятся автоматически.`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ===== ПРИЁМ ФОТО =====
bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const pid = userProject[chatId];

  if (!pid) {
    await bot.sendMessage(chatId, '⚠️ Сначала выберите объект: /projects');
    return;
  }

  // Берём фото максимального размера
  const photo = msg.photo[msg.photo.length - 1];
  const userName = msg.from.first_name || 'Бот';
  const caption = msg.caption || '';

  try {
    const filePath = await downloadFile(photo.file_id, 'jpg');
    const originalName = caption || 'photo_' + Date.now() + '.jpg';

    db.prepare('INSERT INTO project_photos (project_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)')
      .run(pid, path.basename(filePath), originalName, userName);

    await bot.sendMessage(chatId, `✅ Фото загружено!` + (caption ? `\n📝 ${caption}` : ''), {
      reply_to_message_id: msg.message_id
    });

    // Notify admin
    const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(pid);
    if (proj && String(chatId) !== adminChatId) {
      notifyAdmin(`📸 *Новое фото* на объекте «${proj.name}»\nОт: ${userName}`);
    }
  } catch (e) {
    console.error('Ошибка загрузки фото:', e);
    await bot.sendMessage(chatId, '❌ Ошибка загрузки. Попробуйте ещё раз.');
  }
});

// ===== ПРИЁМ ВИДЕО =====
bot.on('video', async (msg) => {
  const chatId = msg.chat.id;
  const pid = userProject[chatId];

  if (!pid) {
    await bot.sendMessage(chatId, '⚠️ Сначала выберите объект: /projects');
    return;
  }

  const video = msg.video;
  const userName = msg.from.first_name || 'Бот';
  const caption = msg.caption || '';

  // Проверка размера (Telegram Bot API: макс 20 МБ)
  if (video.file_size > 20 * 1024 * 1024) {
    await bot.sendMessage(chatId, '⚠️ Видео слишком большое (макс 20 МБ). Отправьте покороче или сожмите.');
    return;
  }

  try {
    const ext = video.mime_type ? video.mime_type.split('/')[1] || 'mp4' : 'mp4';
    const filePath = await downloadFile(video.file_id, ext);
    const originalName = caption || 'video_' + Date.now() + '.' + ext;

    db.prepare('INSERT INTO project_photos (project_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)')
      .run(pid, path.basename(filePath), originalName, userName);

    await bot.sendMessage(chatId, `✅ Видео загружено!` + (caption ? `\n📝 ${caption}` : ''), {
      reply_to_message_id: msg.message_id
    });
  } catch (e) {
    console.error('Ошибка загрузки видео:', e);
    await bot.sendMessage(chatId, '❌ Ошибка загрузки. Попробуйте ещё раз.');
  }
});

// ===== ПРИЁМ ДОКУМЕНТОВ (фото как файл) =====
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const pid = userProject[chatId];
  const doc = msg.document;

  // Проверяем, что это изображение или видео
  const mime = doc.mime_type || '';
  if (!mime.startsWith('image/') && !mime.startsWith('video/')) {
    await bot.sendMessage(chatId, '⚠️ Принимаю только фото и видео.');
    return;
  }

  if (!pid) {
    await bot.sendMessage(chatId, '⚠️ Сначала выберите объект: /projects');
    return;
  }

  const userName = msg.from.first_name || 'Бот';
  const caption = msg.caption || doc.file_name || '';

  try {
    const ext = path.extname(doc.file_name || '.jpg').replace('.', '') || 'jpg';
    const filePath = await downloadFile(doc.file_id, ext);

    db.prepare('INSERT INTO project_photos (project_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)')
      .run(pid, path.basename(filePath), caption, userName);

    await bot.sendMessage(chatId, `✅ Файл загружен!`, { reply_to_message_id: msg.message_id });
  } catch (e) {
    console.error('Ошибка загрузки:', e);
    await bot.sendMessage(chatId, '❌ Ошибка загрузки.');
  }
});

// ===== ПЕРЕСЛАННЫЕ СООБЩЕНИЯ =====
// Если пересылают несколько фото — бот обработает каждое автоматически

// ===== СКАЧИВАНИЕ ФАЙЛА =====
async function downloadFile(fileId, ext) {
  const file = await bot.getFile(fileId);
  const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
  const fileName = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const savePath = path.join(uploadDir, fileName);

  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(savePath);
    https.get(fileUrl, (response) => {
      response.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        resolve(savePath);
      });
    }).on('error', (e) => {
      fs.unlink(savePath, () => {});
      reject(e);
    });
  });
}

// ===== ОБРАБОТКА ТЕКСТА (не команды) =====
bot.on('message', async (msg) => {
  // Игнорируем команды, фото, видео, документы — они обработаны выше
  if (msg.text && msg.text.startsWith('/')) return;
  if (msg.photo || msg.video || msg.document) return;

  if (msg.text) {
    await bot.sendMessage(msg.chat.id,
      '📸 Отправьте фото или видео для загрузки.\n📁 Или выберите объект: /projects'
    );
  }
});
