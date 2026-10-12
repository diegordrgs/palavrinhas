// As palavrinhas moram no próprio repositório:
//   public/data/palavras.json  → a lista de palavras
//   public/data/imagens/       → as imagens
// Qualquer um lê o arquivo publicado junto com o site. Para criar, editar ou apagar,
// a página faz um commit pela API do GitHub com um token guardado só neste navegador.
import { GITHUB_OWNER, GITHUB_REPO } from './config.js';

const DATA_DIR = 'public/data';
const DATA_FILE = `${DATA_DIR}/palavras.json`;
const TOKEN_KEY = 'palavrinhas:github-token';
const API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

let token = readToken();
let branch = null;
let lastCommit = null; // último commit lido ou gravado, para montar links das imagens

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function canEdit() {
  return Boolean(token);
}

// ---------- API do GitHub ----------

async function gh(path, options = {}) {
  const res = await fetch(path.startsWith('http') ? path : API + path, {
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = new Error(ghMessage(res.status));
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

function ghMessage(status) {
  if (status === 401) return 'O token não é válido (ou expirou)';
  if (status === 403 || status === 404) return 'O token não tem permissão para gravar neste repositório';
  if (status === 409 || status === 422) return 'Outra pessoa salvou ao mesmo tempo, tente de novo';
  return `O GitHub respondeu com erro ${status}`;
}

export async function connect(newToken) {
  const previous = token;
  token = newToken.trim();
  try {
    const repo = await gh('');
    if (!repo.permissions?.push) throw new Error('O token não tem permissão para gravar neste repositório');
    branch = repo.default_branch;
  } catch (err) {
    token = previous;
    throw err;
  }
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Sem localStorage o token vale só até fechar a página.
  }
}

export function disconnect() {
  token = null;
  branch = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

async function defaultBranch() {
  branch ??= (await gh('')).default_branch;
  return branch;
}

function utf8ToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

// Lê a lista como está num commit específico.
async function readAt(commitSha) {
  try {
    const file = await gh(`/contents/${DATA_FILE}?ref=${commitSha}`);
    return JSON.parse(base64ToUtf8(file.content));
  } catch (err) {
    if (err.status === 404) return [];
    throw err;
  }
}

// Aplica uma mudança e grava tudo (lista + imagens) num único commit.
// Se alguém salvou no meio do caminho, relê e tenta de novo.
async function commit(message, change, { add = [], remove = [] } = {}) {
  const ref = `/git/refs/heads/${encodeURIComponent(await defaultBranch())}`;
  const blobs = await Promise.all(
    add.map(async ({ path, blob }) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const { sha } = await gh('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: bytesToBase64(bytes), encoding: 'base64' }),
      });
      return { path, sha };
    })
  );

  for (let attempt = 0; ; attempt++) {
    const head = await gh(ref);
    const parent = await gh(`/git/commits/${head.object.sha}`);
    const words = change(await readAt(head.object.sha));
    const tree = await gh('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        base_tree: parent.tree.sha,
        tree: [
          { path: DATA_FILE, mode: '100644', type: 'blob', content: JSON.stringify(words, null, 2) + '\n' },
          ...blobs.map(({ path, sha }) => ({ path, mode: '100644', type: 'blob', sha })),
          ...remove.map((path) => ({ path, mode: '100644', type: 'blob', sha: null })),
        ],
      }),
    });
    const created = await gh('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message, tree: tree.sha, parents: [head.object.sha] }),
    });
    try {
      await gh(ref, { method: 'PATCH', body: JSON.stringify({ sha: created.sha }) });
      lastCommit = created.sha;
      return words;
    } catch (err) {
      if (err.status !== 422 || attempt >= 2) throw err;
    }
  }
}

// ---------- Palavras ----------

function imageUrl(path) {
  if (!path) return null;
  // Logo depois de salvar, o site ainda não foi republicado; o arquivo cru do GitHub já existe.
  return canEdit()
    ? `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/${lastCommit ?? branch}/${DATA_DIR}/${path}`
    : `data/${path}`;
}

function sortWords(words) {
  return [...words].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

function present(words) {
  return sortWords(words).map((w) => ({ ...w, imagePath: w.image ?? null, image: imageUrl(w.image) }));
}

export async function listWords() {
  if (canEdit()) {
    const head = await gh(`/git/refs/heads/${encodeURIComponent(await defaultBranch())}`);
    lastCommit = head.object.sha;
    return present(await readAt(lastCommit));
  }
  const res = await fetch('data/palavras.json', { cache: 'no-store' });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error('Não consegui ler as palavrinhas');
  return present(await res.json());
}

function newImage(blob) {
  const ext = blob.type.split('/')[1] || 'png';
  return { path: `imagens/${crypto.randomUUID()}.${ext}`, blob };
}

const repoPath = (path) => `${DATA_DIR}/${path}`;

function toStored(fields, image) {
  return { name: fields.name, caption: fields.caption, category: fields.category, date: fields.date, image };
}

// image: Blob para enviar uma nova, null para não ter imagem.
export async function createWord(fields, image) {
  const img = image ? newImage(image) : null;
  const words = await commit(
    `Nova palavrinha: ${fields.name}`,
    (words) => [...words, { id: Math.max(0, ...words.map((w) => w.id)) + 1, ...toStored(fields, img?.path ?? null) }],
    { add: img ? [{ path: repoPath(img.path), blob: img.blob }] : [] }
  );
  return present(words);
}

// image: Blob troca a imagem, null remove, undefined mantém a atual.
export async function updateWord(word, fields, image) {
  const img = image ? newImage(image) : null;
  const replacing = image !== undefined && word.imagePath;
  const words = await commit(
    `Edita palavrinha: ${fields.name}`,
    (words) =>
      words.map((w) =>
        w.id === word.id ? { id: w.id, ...toStored(fields, image === undefined ? w.image : img?.path ?? null) } : w
      ),
    {
      add: img ? [{ path: repoPath(img.path), blob: img.blob }] : [],
      remove: replacing ? [repoPath(word.imagePath)] : [],
    }
  );
  return present(words);
}

export async function deleteWord(word) {
  const words = await commit(`Apaga palavrinha: ${word.name}`, (words) => words.filter((w) => w.id !== word.id), {
    remove: word.imagePath ? [repoPath(word.imagePath)] : [],
  });
  return present(words);
}
