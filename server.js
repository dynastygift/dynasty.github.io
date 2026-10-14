const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./database.sqlite');

// Таблица базы данных
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 0,
    last_daily INTEGER DEFAULT 0
  )
`);

// 1. Получение баланса профиля
app.get('/api/user/:id', (req, res) => {
  const tgId = String(req.params.id);
  db.get('SELECT * FROM users WHERE tg_id = ?', [tgId], (err, row) => {
    if (!row) {
      db.run('INSERT OR IGNORE INTO users (tg_id, balance, last_daily) VALUES (?, 0, 0)', [tgId], () => {
        res.json({ tg_id: tgId, balance: 0, last_daily: 0 });
      });
    } else {
      res.json(row);
    }
  });
});

// 2. Ежедневный бонус (2-5 звезд раз в 24 часа)
app.post('/api/claim-daily', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const now = Math.floor(Date.now() / 1000);
  const COOLDOWN = 24 * 60 * 60;

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    if (!user) {
      const reward = Math.floor(Math.random() * 4) + 2;
      db.run('INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, ?)', [tg_id, reward, now], () => {
        res.json({ success: true, reward, newBalance: reward });
      });
      return;
    }

    if (now - user.last_daily < COOLDOWN) {
      return res.status(400).json({ error: 'Бонус доступен 1 раз в 24 часа!' });
    }

    const reward = Math.floor(Math.random() * 4) + 2;
    const newBalance = user.balance + reward;

    db.run('UPDATE users SET balance = ?, last_daily = ? WHERE tg_id = ?', [newBalance, now, tg_id], () => {
      res.json({ success: true, reward, newBalance });
    });
  });
});

// 3. Открытие платных кейсов (100, 300, 500, 750, 1000)
// ВЫДАЕТ СТРОГО 2-5 ЗВЕЗД В КАЧЕСТВЕ УТЕШИТЕЛЬНОГО ПРИЗА
app.post('/api/open-case', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const price = parseInt(req.body.price, 10);
  const allowedPrices = [100, 300, 500, 750, 1000];

  if (!allowedPrices.includes(price)) {
    return res.status(400).json({ error: 'Неверный кейс' });
  }

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    if (!user || user.balance < price) {
      return res.status(400).json({ error: `Недостаточно звезд! Требуется ${price} ⭐` });
    }

    // Алгоритм утешительного приза: строго 2, 3, 4 или 5 звезд
    const rewardStars = Math.floor(Math.random() * 4) + 2;
    const newBalance = user.balance - price + rewardStars;

    db.run('UPDATE users SET balance = ? WHERE tg_id = ?', [newBalance, tg_id], () => {
      res.json({
        success: true,
        rewardStars: rewardStars,
        newBalance: newBalance
      });
    });
  });
});

// 4. Секретная ссылка для накрутки баланса администратору
// /api/admin/set-balance?admin_key=dynasty777&tg_id=ТВОЙ_ID&stars=1000
app.get('/api/admin/set-balance', (req, res) => {
  const { admin_key, tg_id, stars } = req.query;
  if (admin_key !== 'dynasty777') return res.status(403).json({ error: 'Доступ запрещен' });
  if (!tg_id || !stars) return res.status(400).json({ error: 'Укажите tg_id и stars' });

  const amount = parseInt(stars, 10);
  db.run(
    'INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, 0) ON CONFLICT(tg_id) DO UPDATE SET balance = balance + ?',
    [String(tg_id), amount, amount],
    () => {
      res.json({ success: true, message: `Начислено ${amount} ⭐` });
    }
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер Dynasty активен на порту ${PORT}`);
});
