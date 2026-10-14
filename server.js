const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const TelegramBot = require('node-telegram-bot-api');

// Интегрированный токен Telegram-бота
const TOKEN = process.env.BOT_TOKEN || '8848667688:AAGht8-Xn6VF0-rduYQ0qkqvn1l5cVDS3-k';

let bot = null;
try {
  if (TOKEN) {
    bot = new TelegramBot(TOKEN, { polling: true });
    console.log('Telegram Bot успешно запущен в режиме polling!');
  }
} catch (e) {
  console.log('Ошибка инициализации Telegram бота:', e.message);
}

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      tg_id TEXT PRIMARY KEY,
      balance REAL DEFAULT 0,
      last_daily INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS completed_tasks (
      tg_id TEXT,
      task_id TEXT,
      PRIMARY KEY (tg_id, task_id)
    )
  `);
});

const formatBal = (v) => Number((Number(v) || 0).toFixed(2));

// Тексты для бота
const TIKTOK_CONTEST_TEXT = `🎁 <b>Конкурс: Бесплатный рандомный NFT от DynastyUp!</b>\n\nВыполни простые условия в TikTok и получи случайный Telegram-подарок (Plush Pepe, Cupid Charm, Desk Calendar или Diamond Ring):\n\n1️⃣ <b>Поиск:</b> Вбей в TikTok <em>«подарки тг»</em>, <em>«телеграм подарки»</em> или <em>«бесплатные подарки»</em>.\n2️⃣ <b>30 комментариев:</b> Напиши под 30 разными видео комментарии вроде: <code>@DynastyUp реально работает</code>, <code>@DynastyUp имба</code>.\n3️⃣ <b>Актив:</b> Пролайкай 30 чужих комментов с упоминанием @DynastyUp и ответь на 10 из них.\n\n📸 Сделай скриншоты и отправь их модератору: @alisamoderator`;

const SPONSOR_TASK_TEXT = `⭐ <b>Заработать звёзды в DynastyUp</b>\n\nПодпишись на наш официальный канал и получи гарантированные <b>+15 ⭐</b> на баланс для открытия кейсов!\n\n👉 Ссылка на канал: @dynasty_up`;

// ОБРАБОТКА КОМАНД И КНОПОК БОТА
if (bot) {
  bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const name = msg.from.first_name || 'Путник';

    const welcomeMessage = `👋 Привет, <b>${name}</b>!\n\nДобро пожаловать в официальный бот <b>DynastyUp</b> — твою любимую экосистему кейсов со звёздами, мини-игр и эксклюзивных подарков!\n\n🔥 <b>Конкурс недели:</b> Выигрывай бесплатные Telegram NFT за актив в TikTok (подробности ниже).\n\nИспользуй кнопки ниже для удобного управления и заработка:`;

    const inlineKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🎁 Получить бесплатный NFT', callback_data: 'btn_free_nft' }],
          [{ text: '⭐ Заработать звезды', callback_data: 'btn_earn_stars' }]
        ]
      }
    };

    bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'HTML', ...inlineKeyboard });
  });

  bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    if (data === 'btn_free_nft') {
      bot.sendMessage(chatId, TIKTOK_CONTEST_TEXT, { parse_mode: 'HTML' });
    } else if (data === 'btn_earn_stars') {
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📢 Подписаться на @dynasty_up', url: 'https://t.me/dynasty_up' }]
          ]
        }
      };
      bot.sendMessage(chatId, SPONSOR_TASK_TEXT, { parse_mode: 'HTML', ...keyboard });
    }

    bot.answerCallbackQuery(query.id);
  });
}

// REST API ДЛЯ MINI APP
app.get('/api/user/:id', (req, res) => {
  const tgId = String(req.params.id);
  db.get('SELECT * FROM users WHERE tg_id = ?', [tgId], (err, user) => {
    if (!user) {
      db.run('INSERT OR IGNORE INTO users (tg_id, balance, last_daily) VALUES (?, 0, 0)', [tgId], () => {
        return res.json({ tg_id: tgId, balance: 0, last_daily: 0, completedTasks: [] });
      });
    } else {
      db.all('SELECT task_id FROM completed_tasks WHERE tg_id = ?', [tgId], (err, rows) => {
        const completed = rows ? rows.map(r => r.task_id) : [];
        res.json({
          tg_id: user.tg_id,
          balance: formatBal(user.balance),
          last_daily: user.last_daily,
          completedTasks: completed
        });
      });
    }
  });
});

app.post('/api/claim-daily', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const now = Math.floor(Date.now() / 1000);
  const COOLDOWN = 24 * 60 * 60;

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    const reward = Math.floor(Math.random() * 11) + 5;

    if (!user) {
      db.run('INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, ?)', [tg_id, reward, now], () => {
        res.json({ success: true, reward, newBalance: formatBal(reward) });
      });
      return;
    }

    if (now - user.last_daily < COOLDOWN) {
      return res.status(400).json({ error: 'Бонус доступен раз в 24 часа!' });
    }

    const newBalance = formatBal(user.balance + reward);
    db.run('UPDATE users SET balance = ?, last_daily = ? WHERE tg_id = ?', [newBalance, now, tg_id], () => {
      res.json({ success: true, reward, newBalance });
    });
  });
});

app.post('/api/claim-sponsor', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const task_id = String(req.body.task_id);
  const reward = parseFloat(req.body.reward) || 15;

  db.get('SELECT 1 FROM completed_tasks WHERE tg_id = ? AND task_id = ?', [tg_id, task_id], (err, exists) => {
    if (exists) return res.status(400).json({ error: 'Награда уже получена!' });

    db.run('INSERT INTO completed_tasks (tg_id, task_id) VALUES (?, ?)', [tg_id, task_id], (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка БД' });

      db.run(
        'INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, 0) ON CONFLICT(tg_id) DO UPDATE SET balance = ROUND(balance + ?, 2)',
        [tg_id, reward, reward],
        () => {
          db.get('SELECT balance FROM users WHERE tg_id = ?', [tg_id], (err, row) => {
            res.json({ success: true, reward, newBalance: formatBal(row ? row.balance : reward) });
          });
        }
      );
    });
  });
});

const CASES_CONFIG = {
  10: [{ stars: 5, chance: 45 }, { stars: 10, chance: 30 }, { stars: 15, chance: 15 }, { stars: 25, chance: 8 }, { stars: 50, chance: 2 }],
  25: [{ stars: 10, chance: 45 }, { stars: 20, chance: 30 }, { stars: 35, chance: 15 }, { stars: 50, chance: 8 }, { stars: 100, chance: 2 }],
  50: [{ stars: 20, chance: 45 }, { stars: 40, chance: 30 }, { stars: 75, chance: 15 }, { stars: 100, chance: 8 }, { stars: 250, chance: 2 }],
  100: [{ stars: 40, chance: 45 }, { stars: 80, chance: 30 }, { stars: 150, chance: 15 }, { stars: 250, chance: 8 }, { stars: 500, chance: 2 }],
  250: [{ stars: 100, chance: 45 }, { stars: 200, chance: 30 }, { stars: 350, chance: 15 }, { stars: 500, chance: 8 }, { stars: 1000, chance: 2 }]
};

function rollStarsByChance(drops) {
  const rand = Math.random() * 100;
  let cumulative = 0;
  for (const item of drops) {
    cumulative += item.chance;
    if (rand <= cumulative) return item.stars;
  }
  return drops[0].stars;
}

app.post('/api/open-case', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const price = parseInt(req.body.price, 10);
  const drops = CASES_CONFIG[price];

  if (!drops) return res.status(400).json({ error: 'Кейс не найден' });

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    if (!user || user.balance < price) {
      return res.status(400).json({ error: `Недостаточно звёзд! Нужно ${price} ⭐` });
    }

    const rewardStars = rollStarsByChance(drops);
    const newBalance = formatBal(user.balance - price + rewardStars);

    db.run('UPDATE users SET balance = ? WHERE tg_id = ?', [newBalance, tg_id], () => {
      res.json({ success: true, rewardStars, newBalance });
    });
  });
});

app.get('/api/admin/set-balance', (req, res) => {
  const { admin_key, tg_id, stars } = req.query;
  if (admin_key !== 'dynasty777') return res.status(403).json({ error: 'Запрещено' });
  const amount = parseFloat(stars) || 500;
  db.run(
    'INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, 0) ON CONFLICT(tg_id) DO UPDATE SET balance = ROUND(balance + ?, 2)',
    [String(tg_id), amount, amount],
    () => res.json({ success: true, message: `Начислено ${amount} ⭐` })
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DynastyUp Server & Bot started on port ${PORT}`));
