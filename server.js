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

// 2. Ежедневный бесплатный кейс / бонус (2-5 звезд)
app.post('/api/claim-daily', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const now = Math.floor(Date.now() / 1000);
  const COOLDOWN = 24 * 60 * 60;

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    const reward = Math.floor(Math.random() * 4) + 2;

    if (!user) {
      db.run('INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, ?)', [tg_id, reward, now], () => {
        res.json({ success: true, reward, newBalance: formatBal(reward) });
      });
      return;
    }

    if (now - user.last_daily < COOLDOWN) {
      return res.status(400).json({ error: 'Бесплатный подарок доступен раз в 24 часа!' });
    }

    const newBalance = formatBal(user.balance + reward);
    db.run('UPDATE users SET balance = ?, last_daily = ? WHERE tg_id = ?', [newBalance, now, tg_id], () => {
      res.json({ success: true, reward, newBalance });
    });
  });
});

// 3. Задания спонсоров (+0.4 звезды)
app.post('/api/claim-sponsor', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const task_id = String(req.body.task_id);
  const reward = parseFloat(req.body.reward) || 0.4;

  db.get('SELECT 1 FROM completed_tasks WHERE tg_id = ? AND task_id = ?', [tg_id, task_id], (err, exists) => {
    if (exists) return res.status(400).json({ error: 'Уже выполнено!' });

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

// 4. Открытие платных кейсов (выдает строго 2-5 утешительных единиц)
app.post('/api/open-case', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const price = parseFloat(req.body.price);

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    if (!user || user.balance < price) {
      return res.status(400).json({ error: `Недостаточно средств! Нужно ${price}` });
    }

    const rewardStars = Math.floor(Math.random() * 4) + 2;
    const newBalance = formatBal(user.balance - price + rewardStars);

    db.run('UPDATE users SET balance = ? WHERE tg_id = ?', [newBalance, tg_id], () => {
      res.json({ success: true, rewardStars, newBalance });
    });
  });
});

// 5. Изменение баланса в мини-играх (списание ставки / зачисление выигрыша)
app.post('/api/game-action', (req, res) => {
  const tg_id = String(req.body.tg_id);
  const delta = parseFloat(req.body.delta); // отрицательное = ставка, положительное = выигрыш

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    const currentBal = user ? user.balance : 0;
    if (delta < 0 && currentBal < Math.abs(delta)) {
      return res.status(400).json({ error: 'Недостаточно средств на балансе!' });
    }
    const newBalance = formatBal(Math.max(0, currentBal + delta));
    db.run(
      'INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, 0) ON CONFLICT(tg_id) DO UPDATE SET balance = ?',
      [tg_id, newBalance, newBalance],
      () => res.json({ success: true, newBalance })
    );
  });
});

// 6. Админ-ручка для накрутки себе баланса
// /api/admin/set-balance?admin_key=dynasty777&tg_id=ID&stars=1000
app.get('/api/admin/set-balance', (req, res) => {
  const { admin_key, tg_id, stars } = req.query;
  if (admin_key !== 'dynasty777') return res.status(403).json({ error: 'Запрещено' });
  const amount = parseFloat(stars) || 500;
  db.run(
    'INSERT INTO users (tg_id, balance, last_daily) VALUES (?, ?, 0) ON CONFLICT(tg_id) DO UPDATE SET balance = ROUND(balance + ?, 2)',
    [String(tg_id), amount, amount],
    () => res.json({ success: true, message: `Начислено ${amount}` })
  );
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dynasty Server started on ${PORT}`));
