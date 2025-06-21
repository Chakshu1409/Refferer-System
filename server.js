const express = require('express');
const path = require('path');
const { Server } = require('socket.io');
const http = require('http');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Postgres connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');

// Routes
app.get('/', (req, res) => {
  res.send('Referral system backend is running');
});

// Start server
server.listen(process.env.PORT, () => {
  console.log(`Server is running on http://localhost:${process.env.PORT}`);
});


app.get('/signup', (req, res) => {
  res.render('signup');
});

app.post('/signup', async (req, res) => {
  const { name, referrer_id } = req.body;

  try {
    // If referrer is provided, validate referral count limit (8 max)
    if (referrer_id) {
      const { rows } = await pool.query(
        'SELECT COUNT(*) FROM users WHERE referrer_id = $1',
        [referrer_id]
      );
      if (parseInt(rows[0].count) >= 8) {
        return res.send('Referrer already has 8 direct referrals.');
      }
    }

    // Insert the new user
    const result = await pool.query(
      'INSERT INTO users (name, referrer_id) VALUES ($1, $2) RETURNING id',
      [name, referrer_id || null]
    );

    const newUUID = result.rows[0].id;
    res.send(`Signup successful! Your UUID is: <strong>${newUUID}</strong><br><a href='/login'>Go to Login</a>`);
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).send('Internal Server Error during signup');
  }
});

app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', async (req, res) => {
  const { uuid, amount } = req.body;
  const numericAmount = parseFloat(amount);

  if (numericAmount < 1000) {
    return res.send('Amount must be at least ₹1000');
  }

  try {
    // Fetch user making the purchase
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [uuid]);
    if (userResult.rows.length === 0) return res.send('Invalid UUID');

    const user = userResult.rows[0];

    // Insert purchase
    const purchaseResult = await pool.query(
      'INSERT INTO purchases (user_id, amount) VALUES ($1, $2) RETURNING id',
      [uuid, numericAmount]
    );

    const purchaseId = purchaseResult.rows[0].id;

    // LEVEL 1: Direct parent (5%)
    if (user.referrer_id) {
      const level1Earning = numericAmount * 0.05;
      await pool.query(
        'INSERT INTO earnings (user_id, from_user_id, level, amount, purchase_id) VALUES ($1, $2, 1, $3, $4)',
        [user.referrer_id, uuid, level1Earning, purchaseId]
      );

      // WebSocket update for Level 1
      io.to(user.referrer_id).emit('earningsUpdate', {
        amount: level1Earning,
        level: 1,
        from: uuid
      });

      // LEVEL 2: Grandparent (1%)
      const grandParentResult = await pool.query('SELECT referrer_id FROM users WHERE id = $1', [user.referrer_id]);
      const grandParent = grandParentResult.rows[0];

      if (grandParent && grandParent.referrer_id) {
        const level2Earning = numericAmount * 0.01;
        await pool.query(
          'INSERT INTO earnings (user_id, from_user_id, level, amount, purchase_id) VALUES ($1, $2, 2, $3, $4)',
          [grandParent.referrer_id, uuid, level2Earning, purchaseId]
        );

        // WebSocket update for Level 2
        io.to(grandParent.referrer_id).emit('earningsUpdate', {
          amount: level2Earning,
          level: 2,
          from: uuid
        });
      }
    }

    res.send('Purchase recorded and earnings distributed.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error processing purchase');
  }
});

app.get('/earnings/:uuid', async (req, res) => {
  const { uuid } = req.params;

  try {
    // Fetch total earnings by level
    const result = await pool.query(`
      SELECT level, SUM(amount) as total
      FROM earnings
      WHERE user_id = $1
      GROUP BY level
      ORDER BY level
    `, [uuid]);

    const breakdown = result.rows;

    // Fetch detailed transaction history
    const history = await pool.query(`
      SELECT e.level, e.amount, e.from_user_id, e.created_at
      FROM earnings e
      WHERE e.user_id = $1
      ORDER BY e.created_at DESC
    `, [uuid]);

    res.render('earnings', {
      uuid,
      breakdown,
      history: history.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to load earnings');
  }
});

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('register', (userId) => {
    socket.join(userId); // join the room with userId = UUID
    console.log(`User ${userId} joined for live updates`);
  });
});
