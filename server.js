const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const session = require('express-session');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: false
}));

const db = mysql.createConnection({
  host: '127.0.0.1',
  user: 'root',
  password: '178.Urekmazino',
  database: 'mcdb'
});
db.connect(err => {
  if (err) return console.error('MySQL error:', err);
  console.log('MySQL connection successful!');
});

// Kayıt endpoint'i
app.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const sql = 'INSERT INTO users (username, email, password) VALUES (?, ?, ?)';
    db.query(sql, [username, email, hashed], err => {
      if (err) return res.status(500).send('Registration failed');
      res.send('Registration successful!');
    });
  } catch {
    res.status(500).send('An error occurred');
  }
});

// Giriş endpoint'i
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const sql = 'SELECT * FROM users WHERE email = ?';
  db.query(sql, [email], async (err, results) => {
    if (err) return res.status(500).send('Server error');
    if (results.length === 0) return res.status(401).send('User not found');
    const user = results[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send('Wrong password');
    req.session.user = { id: user.id, username: user.username, email: user.email };
    res.send('Login successful');
  });
});

// Oturum bilgisi
app.get('/me', (req, res) => {
  if (req.session.user) return res.json(req.session.user);
  res.status(401).send('Not logged in');
});

// Çıkış
app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login.html'));
});

// Profil güncelleme
app.post('/update-profile', async (req, res) => {
  const { username, currentPassword, newPassword, confirmPassword } = req.body;
  const userId = req.session.user?.id;
  if (!userId) return res.status(401).send('Not logged in');

  db.query('SELECT * FROM users WHERE id = ?', [userId], async (err, results) => {
    if (err || results.length === 0) return res.status(500).send('User could not be retrieved');
    const user = results[0];
    if (currentPassword && !(await bcrypt.compare(currentPassword, user.password))) {
      return res.status(401).send('Current password incorrect');
    }
    const updates = [];
    const params = [];
    if (username) {
      updates.push('username=?');
      params.push(username);
      req.session.user.username = username;
    }
    if (newPassword) {
      if (newPassword !== confirmPassword) return res.status(400).send('New passwords do not match');
      const hashed = await bcrypt.hash(newPassword, 10);
      updates.push('password=?');
      params.push(hashed);
    }
    if (!updates.length) return res.status(400).send('No changes provided');
    params.push(userId);
    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    db.query(sql, params, err => {
      if (err) return res.status(500).send('Update failed');
      res.send('Profile updated successfully');
    });
  });
});

// Film arama (isim veya kategori)
app.get('/search', (req, res) => {
  const { query, genre } = req.query;
  let sql, params;
  if (genre) {
    sql = `
      SELECT m.*, ROUND(AVG(r.starpoint),2) AS average_rating,
             ANY_VALUE(i.image_url) AS image_url
      FROM movies m
      LEFT JOIN movie_ratings r ON m.id=r.movie_id
      LEFT JOIN movie_images i ON m.movie_name=i.movie_name
      WHERE m.genre LIKE ?
      GROUP BY m.id
    `;
    params = [`%${genre}%`];
  } else if (query) {
    sql = `
      SELECT m.*, ROUND(AVG(r.starpoint),2) AS average_rating,
             ANY_VALUE(i.image_url) AS image_url
      FROM movies m
      LEFT JOIN movie_ratings r ON m.id=r.movie_id
      LEFT JOIN movie_images i ON m.movie_name=i.movie_name
      WHERE m.movie_name LIKE ?
      GROUP BY m.id
    `;
    params = [`%${query}%`];
  } else {
    return res.status(400).send('Query or genre missing');
  }
  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).send('Database error');
    res.json(results);
  });
});

// Top 5 filmler
app.get('/top5', (req, res) => {
  const sql = `
    SELECT m.*, ROUND(AVG(r.starpoint),2) AS average_rating,
           ANY_VALUE(i.image_url) AS image_url
    FROM movies m
      LEFT JOIN movie_ratings r ON m.id=r.movie_id
      LEFT JOIN movie_images i ON m.movie_name=i.movie_name
    GROUP BY m.id
    ORDER BY average_rating DESC
    LIMIT 5
  `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).send('Database error');
    res.json(results);
  });
});

// Tek film detayı
app.get('/movie/:id', (req, res) => {
  const id = req.params.id;
  const sql = `
    SELECT m.*, ROUND(AVG(r.starpoint),2) AS average_rating,
           ANY_VALUE(i.image_url) AS image_url
    FROM movies m
      LEFT JOIN movie_ratings r ON m.id=r.movie_id
      LEFT JOIN movie_images i ON m.movie_name=i.movie_name
    WHERE m.id=?
    GROUP BY m.id
  `;
  db.query(sql, [id], (err, results) => {
    if (err) return res.status(500).send('Database error');
    if (!results.length) return res.status(404).send('Movie not found');
    res.json(results[0]);
  });
});

// Film puanlama
app.post('/rate', (req, res) => {
  const userId = req.session.user?.id;
  const { movie_id, starpoint } = req.body;
  if (!userId) return res.status(401).send('Not logged in');
  if (!movie_id || starpoint == null || starpoint < 0 || starpoint > 5) return res.status(400).send('Invalid data');

  const insert = `
    INSERT INTO movie_ratings (movie_id, user_id, starpoint)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE starpoint=VALUES(starpoint)
  `;
  db.query(insert, [movie_id, userId, starpoint], err => {
    if (err) return res.status(500).send('Rating failed');
    const avgSql = `
      UPDATE movies SET average_rating = (
        SELECT ROUND(AVG(starpoint),2) FROM movie_ratings WHERE movie_id=?
      ) WHERE id=?
    `;
    db.query(avgSql, [movie_id, movie_id], err2 => {
      if (err2) return res.status(500).send('Average update failed');
      res.send('Rating saved');
    });
  });
});

// Yorum ekleme
app.post('/comment', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).send('Not logged in');
  const { movie_name, comment } = req.body;
  if (!movie_name || !comment) return res.status(400).send('Missing data');
  const sql = 'INSERT INTO comments (username, movie_name, comment) VALUES (?, ?, ?)';
  db.query(sql, [user.username, movie_name, comment], err => {
    if (err) return res.status(500).send('Comment could not be saved');
    res.send('Comment saved');
  });
});

// Yorum listeleme
app.get('/comments', (req, res) => {
  const movieName = req.query.movie_name;
  if (!movieName) return res.status(400).send('Movie name missing');
  const sql = 'SELECT username, comment, created_at FROM comments WHERE movie_name = ? ORDER BY created_at DESC';
  db.query(sql, [movieName], (err, results) => {
    if (err) return res.status(500).send('Could not retrieve comments');
    res.json(results);
  });
});

// Kullanıcının yorumları
app.get('/comments/user', (req, res) => {
  const username = req.query.username;
  if (!username) return res.status(400).send('Username missing');
  const sql = 'SELECT movie_name, comment, created_at FROM comments WHERE username = ? ORDER BY created_at DESC';
  db.query(sql, [username], (err, results) => {
    if (err) return res.status(500).send('Could not retrieve user comments');
    res.json(results);
  });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
