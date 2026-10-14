const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

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

// Таблица кейсов и честных шансов выпадения звезд
const CASES_CONFIG = {
  10: [
    { stars: 5, chance: 45 },
    { stars: 10, chance: 30 },
    { stars: 15, chance: 15 },
    { stars: 25, chance: 8 },
    { stars: 50, chance: 2 }
  ],
  25: [
    { stars: 10, chance: 45 },
    { stars: 20, chance: 30 },
    { stars: 35, chance: 15 },
    { stars: 50, chance: 8 },
    { stars: 100, chance: 2 }
  ],
  50: [
    { stars: 20, chance: 45 },
    { stars: 40, chance: 30 },
    { stars: 75, chance: 15 },
    { stars: 100, chance: 8 },
    { stars: 250, chance: 2 }
  ],
  100: [
    { stars: 40, chance: 45 },
    { stars: 80, chance: 30 },
    { stars: 150, chance: 15 },
    { stars: 250, chance: 8 },
    { stars: 500, chance: 2 }
  ],
  250: [
    { stars: 100, chance: 45 },
    { stars: 200, chance: 30 },
    { stars: 350, chance: 15 },
    { stars: 500, chance: 8 },
    { stars: 1000, chance: 2 }
  ]
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

// 1. Получение профиля
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

// 2. Ежедневный бесплатный бонус (5-15 звезд раз в 24 часа)
app.post('/api/claim-daily', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const now = Math.floor(Date.now() / 1000);
  const COOLDOWN = 24 * 60 * 60;

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    const reward = Math.floor(Math.random() * 11) + 5; // от 5 до 15 ⭐

    if (!user) {
      db.run('INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, ?)', [tg_id, reward, now], () => {
        res.json({ success: true, reward, newBalance: formatBal(reward) });
      });
      return;
    }

    if (now - user.last_daily < COOLDOWN) {
      return res.status(400).json({ error: 'Бесплатный бонус доступен раз в 24 часа!' });
    }

    const newBalance = formatBal(user.balance + reward);
    db.run('UPDATE users SET balance = ?, last_daily = ? WHERE tg_id = ?', [newBalance, now, tg_id], () => {
      res.json({ success: true, reward, newBalance });
    });
  });
});

// 3. Подписка на спонсора https://t.me/dynasty_up
app.post('/api/claim-sponsor', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const task_id = String(req.body.task_id);
  const reward = parseFloat(req.body.reward) || 15;

  db.get('SELECT 1 FROM completed_tasks WHERE tg_id = ? AND task_id = ?', [tg_id, task_id], (err, exists) => {
    if (exists) return res.status(400).json({ error: 'Вы уже получили награду за этот канал!' });

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

// 4. Открытие кейсов на Звёзды по таблице шансов
app.post('/api/open-case', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const price = parseInt(req.body.price, 10);
  const drops = CASES_CONFIG[price];

  if (!drops) {
    return res.status(400).json({ error: 'Кейс не найден' });
  }

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

// 5. Админ-ручка для начисления звезд:
// /api/admin/set-balance?admin_key=dynasty777&tg_id=ID&stars=1000
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
app.listen(PORT, () => console.log(`DynastyUp Server started on ${PORT}`));
