const express = require('express');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 4000;
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://pguser:pgpass@localhost:5432/lendbooks';
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

// Ensure uploads dir exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now().toString(36) + '-' + uuidv4() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

const app = express();
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
const pool = new Pool({ connectionString: DATABASE_URL });

// Basic CORS for local dev
const cors = require('cors');
app.use(cors());

// --- DB init (run once at startup) ---
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      description TEXT,
      image_path TEXT,
      available BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      book_id TEXT REFERENCES books(id) ON DELETE CASCADE,
      requester_name TEXT,
      message TEXT,
      created_at TIMESTAMP DEFAULT now()
    );
  `);
}
initDb().catch(err => { console.error('DB init error', err); process.exit(1); });

// --- Endpoints ---

// Create book (with optional image)
app.post('/api/books', upload.single('cover'), async (req, res) => {
  try {
    const { title, author, description } = req.body;
    if (!title) return res.status(400).json({ error: 'title required' });
    const id = uuidv4();
    const image_path = req.file ? `/uploads/${path.basename(req.file.path)}` : null;
    await pool.query(
      `INSERT INTO books(id, title, author, description, image_path) VALUES($1,$2,$3,$4,$5)`,
      [id, title, author || null, description || null, image_path]
    );
    res.status(201).json({ id, title, author, description, image_path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'server error' });
  }
});

// List books
app.get('/api/books', async (req, res) => {
  const q = await pool.query(`SELECT id, title, author, description, image_path, available, created_at FROM books ORDER BY created_at DESC`);
  res.json(q.rows);
});

// Get single book
app.get('/api/books/:id', async (req, res) => {
  const { id } = req.params;
  const q = await pool.query(`SELECT * FROM books WHERE id=$1`, [id]);
  if (q.rowCount === 0) return res.status(404).json({ error: 'not found' });
  res.json(q.rows[0]);
});

// Update book (metadata only)
app.put('/api/books/:id', async (req, res) => {
  const { id } = req.params;
  const { title, author, description, available } = req.body;
  await pool.query(
    `UPDATE books SET title=$1, author=$2, description=$3, available=$4 WHERE id=$5`,
    [title, author, description, available, id]
  );
  res.json({ ok: true });
});

// Delete book
app.delete('/api/books/:id', async (req, res) => {
  const { id } = req.params;
  // remove image file (optional)
  const q = await pool.query(`SELECT image_path FROM books WHERE id=$1`, [id]);
  if (q.rowCount === 1 && q.rows[0].image_path) {
    const fp = path.join(__dirname, '..', q.rows[0].image_path);
    fs.unlink(fp, (err) => { /* ignore */ });
  }
  await pool.query(`DELETE FROM books WHERE id=$1`, [id]);
  res.json({ ok: true });
});

// Request loan
app.post('/api/books/:id/request', async (req, res) => {
  const { id } = req.params;
  const { requester_name, message } = req.body;
  // check book exists
  const qb = await pool.query(`SELECT title FROM books WHERE id=$1`, [id]);
  if (qb.rowCount === 0) return res.status(404).json({ error: 'book not found' });
  const rid = uuidv4();
  await pool.query(`INSERT INTO requests(id, book_id, requester_name, message) VALUES($1,$2,$3,$4)`,
    [rid, id, requester_name || null, message || null]);
  res.status(201).json({ ok: true });
});

// List requests
app.get('/api/requests', async (req, res) => {
  const q = await pool.query(`SELECT r.id, r.book_id, r.requester_name, r.message, r.created_at, b.title AS book_title
      FROM requests r LEFT JOIN books b ON r.book_id = b.id ORDER BY r.created_at DESC`);
  res.json(q.rows);
});

// Respond to request (accept => mark book unavailable)
app.put('/api/requests/:id/respond', async (req, res) => {
  const { id } = req.params;
  const { accept } = req.body; // boolean
  const q = await pool.query(`SELECT * FROM requests WHERE id=$1`, [id]);
  if (q.rowCount === 0) return res.status(404).json({ error: 'request not found' });
  const reqRow = q.rows[0];
  if (accept) {
    await pool.query(`UPDATE books SET available=false WHERE id=$1`, [reqRow.book_id]);
  }
  await pool.query(`DELETE FROM requests WHERE id=$1`, [id]);
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Backend listening on ${PORT}`));
