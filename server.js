const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database('./database.sqlite');

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    tg_id TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 0,
    last_daily INTEGER DEFAULT 0
  )
`);

app.get('/api/user/:id', (req, res) => {
  const tgId = req.params.id;
  db.get('SELECT * FROM users WHERE tg_id = ?', [tgId], (err, row) => {
    if (!row) {
      db.run('INSERT INTO users (tg_id, balance, last_daily) VALUES (?, 0, 0)');
      return res.json({ tg_id: tgId, balance: 0, last_daily: 0 });
    }
    res.json(row);
  });
});

app.post('/api/claim-daily', (req, res) => {
  const { tg_id } = req.body;
  const now = Math.floor(Date.now() / 1000);
  const COOLDOWN = 24 * 60 * 60;

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    if (!user) return res.status(404).json({ error: 'Пользователь не найден' });
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

app.post('/api/open-case', (req, res) => {
  const { tg_id } = req.body;
  const PRICE = 300;

  db.get('SELECT * FROM users WHERE tg_id = ?', [tg_id], (err, user) => {
    if (!user || user.balance < PRICE) {
      return res.status(400).json({ error: 'Не хватает звезд! Нужно 300 ⭐' });
    }

    let newBalance = user.balance - PRICE;
    const roll = Math.random() * 100;
    let prize = '';

    if (roll <= 0.01) {
      prize = 'Telegram NFT Gift #777';
    } else {
      prize = '20 Звезд';
      newBalance += 20;
    }

    db.run('UPDATE users SET balance = ? WHERE tg_id = ?', [newBalance, tg_id], () => {
      res.json({ success: true, prize, newBalance });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер Dynasty запущен на порту ${PORT}`);
});
