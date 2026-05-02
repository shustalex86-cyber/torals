{
  "name": "torals-engineering",
  "version": "1.0.0",
  "description": "ТОРАЛС — Инженерные системы. Сайт + CRM для сотрудников",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "bot": "node bot.js",
    "all": "node server.js & node bot.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "better-sqlite3": "^11.0.0",
    "express-session": "^1.17.3",
    "multer": "^1.4.5-lts.1",
    "node-telegram-bot-api": "^0.66.0"
  }
}
