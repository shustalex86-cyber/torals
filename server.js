const express = require('express');
const session = require('express-session');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== UPLOADS =====
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50 МБ

// ===== MIDDLEWARE =====
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadDir));
app.use(session({
  secret: process.env.SESSION_SECRET || 'torals-secret-key-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 дней
}));

// ===== DATABASE =====
const db = new Database(path.join(__dirname, 'torals.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Создание таблиц
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'employee'
  );

  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    client TEXT DEFAULT '',
    address TEXT DEFAULT '',
    date TEXT DEFAULT '',
    percent REAL DEFAULT 60,
    adv_contractor REAL DEFAULT 0,
    adv_owner REAL DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT DEFAULT '',
    unit TEXT DEFAULT 'шт.',
    qty REAL DEFAULT 0,
    price REAL DEFAULT 0,
    position INTEGER DEFAULT 0,
    hidden INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    date TEXT DEFAULT '',
    photo TEXT DEFAULT NULL,
    created_by TEXT DEFAULT '',
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS project_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT DEFAULT '',
    uploaded_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS contact_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'new',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ===== SEED USERS =====
const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (userCount === 0) {
  const insertUser = db.prepare('INSERT INTO users (login, password, display_name, role) VALUES (?, ?, ?, ?)');
  insertUser.run('ринат', '1402', 'Ринат', 'employee');
  insertUser.run('алекс', '2710', 'Алекс', 'employee');
  insertUser.run('торалс', 'Alex1911533??', 'Торалс', 'admin');
  console.log('✅ Пользователи созданы');
}

// ===== SEED DEFAULT PROJECT =====
const projCount = db.prepare('SELECT COUNT(*) as c FROM projects').get().c;
if (projCount === 0) {
  const p = db.prepare('INSERT INTO projects (name, client, address, percent) VALUES (?, ?, ?, ?)');
  const res = p.run('Пример объекта', '', '', 60);
  const pid = res.lastInsertRowid;

  const defaultWorks = [
    ['Прокладка кабеля сечением до 10 кв.мм.', 'м.п.', 3136, 120],
    ['Затяжка кабеля в гофру', 'м.п.', 653, 40],
    ['Монтаж распределительной коробки и расключение', 'шт.', 65, 1000],
    ['Изготовление штробы (По факту)', 'шт.', 168, 300],
    ['Алмазное сверление отверстий бетон/блок подрозетников', 'шт.', 112, 500],
    ['Установка подрозетников', 'шт.', 112, 100],
    ['Изготовление проходных отверстий до диаметра 32мм', 'шт.', 58, 300],
    ['Монтаж закладной тёплого пола', 'шт.', 2, 1500],
    ['Монтаж закладной тв-зоны', 'шт.', 2, 3000],
    ['Алмазное сверление проходных отверстий диаметр 50мм', 'см.', 210, 90],
    ['Монтаж настенных и потолочных светильников', 'шт.', 8, 800],
    ['Монтаж временного освещения и розеток', 'шт.', 22, 300],
    ['Монтаж модульного заземления', 'шт.', 1, 10000],
    ['Монтаж накладного щита до 72 мод', 'шт.', 2, 4000],
    ['Монтаж встроенного щита на 60 модулей', 'шт.', 1, 7000],
    ['Сборка щитового оборудования', 'мод.', 0, 650]
  ];

  const insW = db.prepare('INSERT INTO works (project_id, name, unit, qty, price, position) VALUES (?, ?, ?, ?, ?, ?)');
  defaultWorks.forEach((w, i) => insW.run(pid, w[0], w[1], w[2], w[3], i));
  console.log('✅ Пример проекта создан');
}

// ===== AUTH MIDDLEWARE =====
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Необходима авторизация' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Необходима авторизация' });
  if (req.session.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' });
  next();
}

// ===== AUTH ROUTES =====
app.post('/api/login', (req, res) => {
  const { login, password } = req.body;
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });

  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login.trim().toLowerCase());
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.displayName = user.display_name;
  res.json({ id: user.id, displayName: user.display_name, role: user.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json(null);
  res.json({ id: req.session.userId, displayName: req.session.displayName, role: req.session.role });
});

// ===== PROJECT ROUTES =====
app.get('/api/projects', requireAuth, (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, 
      (SELECT COUNT(*) FROM works WHERE project_id = p.id) as work_count,
      (SELECT COUNT(*) FROM project_photos WHERE project_id = p.id) as photo_count
    FROM projects p ORDER BY p.created_at DESC
  `).all();
  res.json(projects);
});

app.post('/api/projects', requireAdmin, (req, res) => {
  const { name, client, address, date, percent } = req.body;
  const r = db.prepare('INSERT INTO projects (name, client, address, date, percent) VALUES (?, ?, ?, ?, ?)');
  const result = r.run(name || '', client || '', address || '', date || '', percent || 60);
  res.json({ id: result.lastInsertRowid });
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Проект не найден' });
  res.json(p);
});

app.put('/api/projects/:id', requireAdmin, (req, res) => {
  const { name, client, address, date, percent, adv_contractor, adv_owner, status } = req.body;
  db.prepare(`UPDATE projects SET name=?, client=?, address=?, date=?, percent=?, adv_contractor=?, adv_owner=?, status=? WHERE id=?`)
    .run(name, client, address, date, percent, adv_contractor || 0, adv_owner || 0, status || 'active', req.params.id);
  res.json({ ok: true });
});

app.delete('/api/projects/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== WORKS ROUTES =====
app.get('/api/projects/:id/works', requireAuth, (req, res) => {
  const works = db.prepare('SELECT * FROM works WHERE project_id = ? ORDER BY position, id').all(req.params.id);
  res.json(works);
});

app.post('/api/projects/:id/works', requireAuth, (req, res) => {
  const { name, unit, qty, price } = req.body;
  const maxPos = db.prepare('SELECT MAX(position) as m FROM works WHERE project_id = ?').get(req.params.id);
  const pos = (maxPos.m || 0) + 1;
  // Сотрудник может добавить позицию, но цену ставит только админ
  const finalPrice = req.session.role === 'admin' ? (price || 0) : 0;
  const r = db.prepare('INSERT INTO works (project_id, name, unit, qty, price, position) VALUES (?, ?, ?, ?, ?, ?)');
  const result = r.run(req.params.id, name || '', unit || 'шт.', qty || 0, finalPrice, pos);
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/works/:id', requireAuth, (req, res) => {
  const work = db.prepare('SELECT * FROM works WHERE id = ?').get(req.params.id);
  if (!work) return res.status(404).json({ error: 'Не найдено' });

  if (req.session.role === 'admin') {
    // Админ может всё
    const { name, unit, qty, price, hidden } = req.body;
    db.prepare('UPDATE works SET name=?, unit=?, qty=?, price=?, hidden=? WHERE id=?')
      .run(name ?? work.name, unit ?? work.unit, qty ?? work.qty, price ?? work.price, hidden ?? work.hidden, req.params.id);
  } else {
    // Сотрудник — только qty и hidden
    const { qty, hidden } = req.body;
    const updates = {};
    if (qty !== undefined) updates.qty = qty;
    if (hidden !== undefined) updates.hidden = hidden;
    if (Object.keys(updates).length > 0) {
      db.prepare('UPDATE works SET qty=?, hidden=? WHERE id=?')
        .run(qty ?? work.qty, hidden ?? work.hidden, req.params.id);
    }
  }
  res.json({ ok: true });
});

app.delete('/api/works/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM works WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== RECEIPTS ROUTES =====
app.get('/api/projects/:id/receipts', requireAuth, (req, res) => {
  const receipts = db.prepare('SELECT * FROM receipts WHERE project_id = ? ORDER BY id').all(req.params.id);
  res.json(receipts);
});

app.post('/api/projects/:id/receipts', requireAuth, upload.single('photo'), (req, res) => {
  const { name, amount, date } = req.body;
  const photo = req.file ? '/uploads/' + req.file.filename : null;
  const r = db.prepare('INSERT INTO receipts (project_id, name, amount, date, photo, created_by) VALUES (?, ?, ?, ?, ?, ?)');
  const result = r.run(req.params.id, name || '', amount || 0, date || '', photo, req.session.displayName || '');
  res.json({ id: result.lastInsertRowid });
});

app.put('/api/receipts/:id', requireAuth, upload.single('photo'), (req, res) => {
  const receipt = db.prepare('SELECT * FROM receipts WHERE id = ?').get(req.params.id);
  if (!receipt) return res.status(404).json({ error: 'Не найдено' });

  const { name, amount, date } = req.body;
  const photo = req.file ? '/uploads/' + req.file.filename : receipt.photo;
  db.prepare('UPDATE receipts SET name=?, amount=?, date=?, photo=? WHERE id=?')
    .run(name ?? receipt.name, amount ?? receipt.amount, date ?? receipt.date, photo, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/receipts/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM receipts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== PROJECT PHOTOS =====
app.get('/api/projects/:id/photos', requireAuth, (req, res) => {
  const photos = db.prepare('SELECT * FROM project_photos WHERE project_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(photos);
});

app.post('/api/projects/:id/photos', requireAuth, upload.array('photos', 20), (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'Нет файлов' });
  const ins = db.prepare('INSERT INTO project_photos (project_id, filename, original_name, uploaded_by) VALUES (?, ?, ?, ?)');
  const ids = [];
  for (const f of req.files) {
    const r = ins.run(req.params.id, f.filename, f.originalname, req.session.displayName || '');
    ids.push(r.lastInsertRowid);
  }
  res.json({ ids });
});

app.delete('/api/photos/:id', requireAuth, (req, res) => {
  const photo = db.prepare('SELECT * FROM project_photos WHERE id = ?').get(req.params.id);
  if (photo) {
    const fpath = path.join(uploadDir, photo.filename);
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
    db.prepare('DELETE FROM project_photos WHERE id = ?').run(req.params.id);
  }
  res.json({ ok: true });
});

// ===== PUBLIC API: Active projects for website =====
app.get('/api/public/projects', (req, res) => {
  const projects = db.prepare(`
    SELECT p.id, p.name, p.address, p.status,
      (SELECT COUNT(*) FROM project_photos WHERE project_id = p.id) as photo_count,
      COALESCE((SELECT SUM(CASE WHEN w.qty > 0 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(w.id), 0) FROM works w WHERE w.project_id = p.id), 0) as progress
    FROM projects p WHERE p.status = 'active' ORDER BY p.created_at DESC
  `).all();
  res.json(projects);
});

// ===== USER MANAGEMENT (admin only) =====
app.get('/api/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, login, display_name, role FROM users').all();
  res.json(users);
});

app.post('/api/users', requireAdmin, (req, res) => {
  const { login, password, display_name, role } = req.body;
  try {
    const r = db.prepare('INSERT INTO users (login, password, display_name, role) VALUES (?, ?, ?, ?)');
    const result = r.run(login.toLowerCase(), password, display_name, role || 'employee');
    res.json({ id: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Пользователь уже существует' });
  }
});

app.put('/api/users/:id/password', requireAdmin, (req, res) => {
  const { password } = req.body;
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(password, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
  if (req.params.id == req.session.userId) return res.status(400).json({ error: 'Нельзя удалить себя' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ===== CONTACT FORM =====
const BOT_TOKEN = process.env.BOT_TOKEN || '8750691630:AAFBa2H0ETvs25QT9kfYxF8Q4hEuOM9DkGE';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ''; // Заполнится автоматически из бота

async function sendTelegramNotification(text) {
  if (!ADMIN_CHAT_ID && !global.adminChatId) return;
  const chatId = ADMIN_CHAT_ID || global.adminChatId;
  try {
    const data = JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = require('https').request(options);
    req.write(data);
    req.end();
  } catch(e) { console.error('Telegram notification error:', e.message); }
}

// Экспортируем для бота
global.sendTelegramNotification = sendTelegramNotification;

app.post('/api/contact', (req, res) => {
  const { name, phone, description } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Имя и телефон обязательны' });

  db.prepare('INSERT INTO contact_requests (name, phone, description) VALUES (?, ?, ?)')
    .run(name, phone, description || '');

  // Отправка в Telegram
  const msg = `📩 *Новая заявка с сайта!*\n\n👤 ${name}\n📞 ${phone}` + (description ? `\n📝 ${description}` : '');
  sendTelegramNotification(msg);

  console.log(`📩 Новая заявка: ${name} / ${phone}`);
  res.json({ ok: true });
});

app.get('/api/contacts', requireAdmin, (req, res) => {
  const contacts = db.prepare('SELECT * FROM contact_requests ORDER BY created_at DESC').all();
  res.json(contacts);
});

// ===== SPA FALLBACK =====
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ===== START =====
app.listen(PORT, () => {
  console.log(`\n🔧 ТОРАЛС Engineering`);
  console.log(`🌐 Сервер запущен: http://localhost:${PORT}`);
  console.log(`📁 База данных: torals.db`);
  console.log(`📸 Файлы: ${uploadDir}\n`);

  // Запуск Telegram-бота
  try {
    global.sharedDb = db;
    global.uploadDir = uploadDir;
    require('./bot.js');
    console.log('🤖 Telegram-бот запущен');
  } catch(e) {
    console.log('⚠️ Бот не запустился:', e.message);
  }
});
