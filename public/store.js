// Acesso ao Supabase: login, palavras (tabela "words") e imagens (bucket "imagens").
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const BUCKET = 'imagens';
const SIGNED_URL_TTL = 60 * 60 * 6; // 6 horas

export const configured = !SUPABASE_URL.includes('SEU-PROJETO') && !SUPABASE_ANON_KEY.includes('COLE-AQUI');

const client = configured ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function check({ data, error }) {
  if (error) throw new Error(translate(error.message));
  return data;
}

function translate(message) {
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos';
  if (/email not confirmed/i.test(message)) return 'Confirme o e-mail antes de entrar';
  if (/jwt|not authenticated|row-level security/i.test(message)) return 'Sua sessão expirou, entre de novo';
  return message;
}

// ---------- Login ----------

export async function currentUser() {
  const { data } = await client.auth.getSession();
  return data.session?.user ?? null;
}

export function onAuthChange(callback) {
  client.auth.onAuthStateChange((_event, session) => callback(session?.user ?? null));
}

export async function signIn(email, password) {
  check(await client.auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  await client.auth.signOut();
}

// ---------- Palavras ----------

function toWord(row, urls) {
  return {
    id: row.id,
    name: row.name,
    caption: row.caption,
    category: row.category,
    date: row.learned_on,
    imagePath: row.image_path,
    image: row.image_path ? urls.get(row.image_path) ?? null : null,
  };
}

async function signedUrls(paths) {
  if (!paths.length) return new Map();
  const data = check(await client.storage.from(BUCKET).createSignedUrls(paths, SIGNED_URL_TTL));
  return new Map(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
}

export async function listWords() {
  const rows = check(
    await client
      .from('words')
      .select('id, name, caption, category, learned_on, image_path')
      .order('learned_on', { ascending: false })
      .order('id', { ascending: false })
  );
  const urls = await signedUrls(rows.map((r) => r.image_path).filter(Boolean));
  return rows.map((r) => toWord(r, urls));
}

async function uploadImage(blob) {
  const ext = blob.type.split('/')[1] || 'png';
  const path = `${crypto.randomUUID()}.${ext}`;
  check(await client.storage.from(BUCKET).upload(path, blob, { contentType: blob.type }));
  return path;
}

async function removeImage(path) {
  if (path) await client.storage.from(BUCKET).remove([path]);
}

function toRow(fields) {
  return {
    name: fields.name,
    caption: fields.caption,
    category: fields.category,
    learned_on: fields.date,
  };
}

// image: Blob para enviar uma nova, null para não ter imagem.
export async function createWord(fields, image) {
  const image_path = image ? await uploadImage(image) : null;
  try {
    check(await client.from('words').insert({ ...toRow(fields), image_path }));
  } catch (err) {
    await removeImage(image_path);
    throw err;
  }
}

// image: Blob troca a imagem, null remove, undefined mantém a atual.
export async function updateWord(word, fields, image) {
  const row = toRow(fields);
  let uploaded = null;
  if (image) row.image_path = uploaded = await uploadImage(image);
  else if (image === null) row.image_path = null;
  try {
    check(await client.from('words').update(row).eq('id', word.id));
  } catch (err) {
    await removeImage(uploaded);
    throw err;
  }
  if (image !== undefined) await removeImage(word.imagePath);
}

export async function deleteWord(word) {
  check(await client.from('words').delete().eq('id', word.id));
  await removeImage(word.imagePath);
}
