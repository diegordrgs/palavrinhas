// Servidor minimalista do Palavrinhas da Manu.
// Sem dependências: usa node:http para a API e node:sqlite para persistir.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, extname, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'data');
const UPLOADS_DIR = join(DATA_DIR, 'uploads');
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY = 15 * 1024 * 1024;

const CATEGORIES = ['familia', 'animais', 'comidas', 'outros'];
const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, 'palavrinhas.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    caption    TEXT NOT NULL DEFAULT '',
    category   TEXT NOT NULL DEFAULT 'outros',
    learned_on TEXT NOT NULL,
    image      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS words_learned_on ON words (learned_on);
`);

const q = {
  list: db.prepare('SELECT * FROM words ORDER BY learned_on DESC, id DESC'),
  get: db.prepare('SELECT * FROM words WHERE id = ?'),
  insert: db.prepare(
    'INSERT INTO words (name, caption, category, learned_on, image) VALUES (?, ?, ?, ?, ?)'
  ),
  update: db.prepare(
    'UPDATE words SET name = ?, caption = ?, category = ?, learned_on = ?, image = ? WHERE id = ?'
  ),
  remove: db.prepare('DELETE FROM words WHERE id = ?'),
};

function toJson(row) {
  return {
    id: row.id,
    name: row.name,
    caption: row.caption,
    category: row.category,
    date: row.learned_on,
    image: row.image ? `/uploads/${row.image}` : null,
  };
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Imagem muito grande');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'JSON inválido');
  }
}

// Valida os campos e devolve os valores normalizados.
function validate(body) {
  const name = String(body.name ?? '').trim();
  const caption = String(body.caption ?? '').trim();
  const category = CATEGORIES.includes(body.category) ? body.category : 'outros';
  const date = String(body.date ?? '');
  if (!name) throw new HttpError(400, 'A palavra precisa de um nome');
  if (name.length > 60) throw new HttpError(400, 'Nome muito comprido');
  if (caption.length > 280) throw new HttpError(400, 'Legenda muito comprida');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new HttpError(400, 'Data inválida');
  }
  return { name, caption, category, date };
}

// Salva uma imagem recebida como data URL e devolve o nome do arquivo.
function saveImage(dataUrl) {
  const match = /^data:(image\/[a-z]+);base64,(.+)$/s.exec(String(dataUrl));
  if (!match || !IMAGE_TYPES[match[1]]) throw new HttpError(400, 'Formato de imagem não suportado');
  const file = randomUUID() + IMAGE_TYPES[match[1]];
  writeFileSync(join(UPLOADS_DIR, file), Buffer.from(match[2], 'base64'));
  return file;
}

function deleteImage(file) {
  if (!file) return;
  const path = join(UPLOADS_DIR, basename(file));
  if (existsSync(path)) unlinkSync(path);
}

async function handleApi(req, res, url) {
  const idMatch = /^\/api\/words\/(\d+)$/.exec(url.pathname);

  if (url.pathname === '/api/words' && req.method === 'GET') {
    return send(res, 200, q.list.all().map(toJson));
  }

  if (url.pathname === '/api/words' && req.method === 'POST') {
    const body = await readJson(req);
    const w = validate(body);
    const image = body.image ? saveImage(body.image) : null;
    const { lastInsertRowid } = q.insert.run(w.name, w.caption, w.category, w.date, image);
    return send(res, 201, toJson(q.get.get(lastInsertRowid)));
  }

  if (idMatch) {
    const current = q.get.get(Number(idMatch[1]));
    if (!current) throw new HttpError(404, 'Palavra não encontrada');

    if (req.method === 'PUT') {
      const body = await readJson(req);
      const w = validate(body);
      // image: data URL nova substitui; null remove; ausente mantém.
      let image = current.image;
      if (typeof body.image === 'string' && body.image.startsWith('data:')) {
        image = saveImage(body.image);
        deleteImage(current.image);
      } else if (body.image === null) {
        deleteImage(current.image);
        image = null;
      }
      q.update.run(w.name, w.caption, w.category, w.date, image, current.id);
      return send(res, 200, toJson(q.get.get(current.id)));
    }

    if (req.method === 'DELETE') {
      q.remove.run(current.id);
      deleteImage(current.image);
      return send(res, 204);
    }
  }

  throw new HttpError(404, 'Rota não encontrada');
}

function serveFile(res, baseDir, relPath) {
  const path = join(baseDir, relPath);
  // Impede escapar do diretório base.
  if (!path.startsWith(baseDir) || !existsSync(path)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Não encontrado');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream' });
  res.end(readFileSync(path));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname.startsWith('/uploads/')) {
      return serveFile(res, UPLOADS_DIR, basename(decodeURIComponent(url.pathname)));
    }
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    return serveFile(res, PUBLIC_DIR, rel);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    return send(res, 500, { error: 'Erro inesperado' });
  }
});

server.listen(PORT, () => {
  console.log(`Palavrinhas da Manu em http://localhost:${PORT}`);
});
