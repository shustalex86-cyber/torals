const TelegramBot = require('node-telegram-bot-api');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const https = require('https');

const TOKEN = process.env.BOT_TOKEN || '8750691630:AAFBa2H0ETvs25QT9kfYxF8Q4hEuOM9DkGE';
const bot = new TelegramBot(TOKEN, { polling: true });
const db = new Database(path.join(__dirname, 'torals.db'));
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const userProject = {};
let adminChatId = null;
try { adminChatId = fs.readFileSync(path.join(__dirname, '.admin_chat_id'), 'utf8').trim(); } catch(e) {}

function saveAdmin(id) {
  adminChatId = String(id);
  try { fs.writeFileSync(path.join(__dirname, '.admin_chat_id'), adminChatId); } catch(e) {}
}

function notifyAdmin(text) {
  if (!adminChatId) return;
  bot.sendMessage(adminChatId, text, { parse_mode: 'Markdown' }).catch(function(){});
}

// Главное меню
function mainMenu() {
  return {
    reply_markup: {
      keyboard: [
        ['📁 Выбрать объект', '📋 Текущий объект'],
        ['📸 Отправить фото', '🎬 Отправить видео'],
        ['🔔 Включить уведомления', '❓ Помощь']
      ],
      resize_keyboard: true,
      one_time_keyboard: false
    }
  };
}

// /start
bot.onText(/\/start/, (msg) => {
  const name = msg.from.first_name || 'Коллега';
  bot.sendMessage(msg.chat.id,
    `👋 Привет, ${name}!\n\nЯ бот компании *ТОРАЛС*.\n\nВыберите действие в меню ниже 👇`,
    { parse_mode: 'Markdown', ...mainMenu() }
  );
});

// Кнопка "Выбрать объект"
bot.onText(/📁 Выбрать объект|\/projects/, (msg) => {
  const projects = db.prepare('SELECT id, name, address FROM projects WHERE status = "active" ORDER BY created_at DESC').all();
  if (!projects.length) {
    bot.sendMessage(msg.chat.id, '📁 Активных объектов нет. Создайте объект на сайте.');
    return;
  }
  const keyboard = projects.map(p => {
    const label = p.name + (p.address ? ' · ' + p.address : '');
    return [{ text: '📁 ' + label, callback_data: 'proj_' + p.id }];
  });
  bot.sendMessage(msg.chat.id, '📁 *Выберите объект:*', {
    parse_mode: 'Markdown',
    reply_markup: { inline_keyboard: keyboard }
  });
});

// Кнопка "Текущий объект"
bot.onText(/📋 Текущий объект|\/current/, (msg) => {
  const pid = userProject[msg.chat.id];
  if (!pid) { bot.sendMessage(msg.chat.id, '⚠️ Объект не выбран.\n\nНажмите «📁 Выбрать объект»'); return; }
  const proj = db.prepare('SELECT name, address FROM projects WHERE id = ?').get(pid);
  if (!proj) { bot.sendMessage(msg.chat.id, '⚠️ Объект не найден.'); return; }
  const cnt = db.prepare('SELECT COUNT(*) as c FROM project_photos WHERE project_id = ?').get(pid).c;
  bot.sendMessage(msg.chat.id,
    `📋 *Текущий объект:*\n\n📁 ${proj.name}${proj.address ? '\n📍 ' + proj.address : ''}\n📸 Загружено: ${cnt} файлов\n\n_Отправляйте фото или видео — они добавятся сюда_`,
    { parse_mode: 'Markdown' }
  );
});

// Кнопка "Отправить фото"
bot.onText(/📸 Отправить фото/, (msg) => {
  const pid = userProject[msg.chat.id];
  if (!pid) { bot.sendMessage(msg.chat.id, '⚠️ Сначала выберите объект!\n\nНажмите «📁 Выбрать объект»'); return; }
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(pid);
  bot.sendMessage(msg.chat.id,
    `📸 *Жду фото для объекта:*\n📁 ${proj ? proj.name : '?'}\n\nОтправьте одно или несколько фото.\nМожно пересылать из других чатов.`,
    { parse_mode: 'Markdown' }
  );
});

// Кнопка "Отправить видео"
bot.onText(/🎬 Отправить видео/, (msg) => {
  const pid = userProject[msg.chat.id];
  if (!pid) { bot.sendMessage(msg.chat.id, '⚠️ Сначала выберите объект!\n\nНажмите «📁 Выбрать объект»'); return; }
  const proj = db.prepare('SELECT name FROM projects WHERE id = ?').get(pid);
  bot.sendMessage(msg.chat.id,
    `🎬 *Жду видео для объекта:*\n📁 ${proj ? proj.name : '?'}\n\nОтправьте видео (до 20 М
