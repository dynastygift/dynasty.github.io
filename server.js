const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./database.sqlite');

// Создание таблиц (баланс REAL для поддержки дробных звезд 0.4)
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

const formatBalance = (val) => Number((Number(val) || 0).toFixed(2));

// 1. Получить профиль и список выполненных заданий
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
          balance: formatBalance(user.balance),
          last_daily: user.last_daily,
          completedTasks: completed
        });
      });
    }
  });
});

// 2. Ежедневный бонус (2-5 звезд раз в 24 часа)
app.post('/api/claim-daily', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const now = Math.floor(Date.now() / 1000);
  const COOLDOWN = 24 * 60 * 60;

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    const reward = Math.floor(Math.random() * 4) + 2;

    if (!user) {
      db.run('INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, ?)', [tg_id, reward, now], () => {
        res.json({ success: true, reward, newBalance: formatBalance(reward) });
      });
      return;
    }

    if (now - user.last_daily < COOLDOWN) {
      return res.status(400).json({ error: 'Бонус доступен 1 раз в 24 часа!' });
    }

    const newBalance = formatBalance(user.balance + reward);

    db.run('UPDATE users SET balance = ?, last_daily = ? WHERE tg_id = ?', [newBalance, now, tg_id], () => {
      res.json({ success: true, reward, newBalance });
    });
  });
});

// 3. Проверка подписки на спонсора (+0.4 звезды)
app.post('/api/claim-sponsor', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const task_id = String(req.body.task_id);
  const reward = parseFloat(req.body.reward) || 0.4;

  db.get('SELECT 1 FROM completed_tasks WHERE tg_id = ? AND task_id = ?', [tg_id, task_id], (err, exists) => {
    if (exists) {
      return res.status(400).json({ error: 'Это задание уже выполнено!' });
    }

    db.run('INSERT INTO completed_tasks (tg_id, task_id) VALUES (?, ?)', [tg_id, task_id], (err) => {
      if (err) return res.status(500).json({ error: 'Ошибка сохранения задания' });

      db.run(
        'INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, 0) ON CONFLICT(tg_id) DO UPDATE SET balance = ROUND(balance + ?, 2)',
        [tg_id, reward, reward],
        () => {
          db.get('SELECT balance FROM users WHERE tg_id = ?', [tg_id], (err, row) => {
            res.json({
              success: true,
              reward: reward,
              newBalance: formatBalance(row ? row.balance : reward)
            });
          });
        }
      );
    });
  });
});

// 4. Открытие кейса (строго 2-5 звезд утешительного приза)
app.post('/api/open-case', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const price = parseInt(req.body.price, 10);
  const allowedPrices = [100, 300, 500, 750, 1000];

  if (!allowedPrices.includes(price)) {
    return res.status(400).json({ error: 'Неверный кейс' });
  }

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    if (!user || user.balance < price) {
      return res.status(400).json({ error: `Недостаточно звезд! Нужно ${price} ⭐` });
    }

    const rewardStars = Math.floor(Math.random() * 4) + 2;
    const newBalance = formatBalance(user.balance - price + rewardStars);

    db.run('UPDATE users SET balance = ? WHERE tg_id = ?', [newBalance, tg_id], () => {
      res.json({
        success: true,
        rewardStars: rewardStars,
        newBalance: newBalance
      });
    });
  });
});

// 5. Секретная ссылка администратора для начисления баланса
// /api/admin/set-balance?admin_key=dynasty777&tg_id=ID&stars=1000
app.get('/api/admin/set-balance', (req, res) => {
  const { admin_key, tg_id, stars } = req.query;
  if (admin_key !== 'dynasty777') return res.status(403).json({ error: 'Доступ запрещен' });
  if (!tg_id || !stars) return res.status(400).json({ error: 'Укажите tg_id и stars' });

  const amount = parseFloat(stars);
  db.run(
    'INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, 0) ON CONFLICT(tg_id) DO UPDATE SET balance = ROUND(balance + ?, 2)',
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
