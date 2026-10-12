import * as store from './store.js';

const CATEGORIES = [
  { id: 'familia', label: 'Família' },
  { id: 'animais', label: 'Animais' },
  { id: 'comidas', label: 'Comidas' },
  { id: 'outros', label: 'Outros' },
];
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));
const TITLE_COLORS = ['#f29aa8', '#f2b862', '#7fb4e6', '#9fd09a', '#c3a6e6', '#f08a7e'];
const MAX_IMAGE_SIDE = 1000;

const state = {
  words: [],
  search: '',
  category: null,
  editing: null, // palavra em edição (ou null para nova)
  image: undefined, // Blob novo, null para remover, undefined para manter
  previewUrl: null,
};

const $ = (sel) => document.querySelector(sel);
const board = $('#board');
const timeline = $('#timeline');
const modal = $('#modal');
const form = $('#word-form');

// ---------- Utilidades ----------

// Datas são 'AAAA-MM-DD' ou só 'AAAA-MM' quando não se sabe o dia.
function parseDate(iso) {
  const [y, m, d = 1] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const isMonthOnly = (iso) => iso.length === 7;

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function todayIso() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
}

const fmtMonth = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });

function normalize(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Moldura ondulada (igual à das figurinhas) desenhada com arcos.
function scallopPath(w, h, inset, bump) {
  const iw = w - inset * 2;
  const ih = h - inset * 2;
  const nx = Math.max(1, Math.round(iw / (bump * 2)));
  const ny = Math.max(1, Math.round(ih / (bump * 2)));
  const sx = iw / nx;
  const sy = ih / ny;
  let d = `M${inset} ${inset}`;
  for (let i = 0; i < nx; i++) d += `a${sx / 2} ${sx / 2} 0 0 1 ${sx} 0`;
  for (let i = 0; i < ny; i++) d += `a${sy / 2} ${sy / 2} 0 0 1 0 ${sy}`;
  for (let i = 0; i < nx; i++) d += `a${sx / 2} ${sx / 2} 0 0 1 ${-sx} 0`;
  for (let i = 0; i < ny; i++) d += `a${sy / 2} ${sy / 2} 0 0 1 0 ${-sy}`;
  return d + 'z';
}

const CARD_FRAME = scallopPath(200, 300, 7, 5.5);

// Reduz a imagem no navegador antes de enviar, para o armazenamento ficar leve.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // Safari antigo não gera webp; nesse caso o toBlob devolve png.
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Não consegui ler essa imagem'))), 'image/webp', 0.9);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não consegui abrir essa imagem'));
    };
    img.src = url;
  });
}

// ---------- Renderização ----------

function renderTitle() {
  const el = $('#title-letters');
  let colorIndex = 0;
  for (const ch of 'Palavrinhas da Manu') {
    const span = document.createElement('span');
    if (ch === ' ') {
      span.className = 'space';
    } else {
      span.textContent = ch;
      span.style.color = TITLE_COLORS[colorIndex++ % TITLE_COLORS.length];
      span.style.transform = `rotate(${(Math.random() * 10 - 5).toFixed(1)}deg) translateY(${(Math.random() * 6 - 3).toFixed(1)}px)`;
    }
    el.append(span);
  }
}

function renderFilters() {
  const nav = $('#filters');
  nav.replaceChildren();
  const all = [{ id: null, label: 'Todas' }, ...CATEGORIES];
  for (const cat of all) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = cat.label;
    b.setAttribute('aria-pressed', String(state.category === cat.id));
    if (cat.id) {
      b.style.setProperty('--c', `var(--${cat.id})`);
      b.style.setProperty('--bg', `var(--${cat.id}-bg)`);
    }
    b.addEventListener('click', () => {
      state.category = cat.id;
      renderFilters();
      render();
    });
    nav.append(b);
  }
}

function renderCategoryPicker(selected) {
  const picker = $('#category-picker');
  picker.replaceChildren();
  for (const cat of CATEGORIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.value = cat.id;
    b.textContent = cat.label;
    b.style.setProperty('--c', `var(--${cat.id})`);
    b.style.setProperty('--bg', `var(--${cat.id}-bg)`);
    b.setAttribute('aria-pressed', String(cat.id === selected));
    b.addEventListener('click', () => {
      for (const other of picker.children) other.setAttribute('aria-pressed', String(other === b));
    });
    picker.append(b);
  }
}

function visibleWords() {
  const term = normalize(state.search.trim());
  return state.words.filter((w) => {
    if (state.category && w.category !== state.category) return false;
    if (!term) return true;
    return normalize(`${w.name} ${w.caption}`).includes(term);
  });
}

// Número de cada palavra na ordem em que foi aprendida, como numa pokédex (nº 1 = a primeira).
function numberWords(words) {
  const sorted = [...words].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
  return new Map(sorted.map((w, i) => [w.id, i + 1]));
}

const fmtMonthShort = new Intl.DateTimeFormat('pt-BR', { month: 'short' });

function cardDate(iso) {
  const d = parseDate(iso);
  const month = fmtMonthShort.format(d).replace('.', '');
  return isMonthOnly(iso) ? `${month} ${d.getFullYear()}` : `${d.getDate()} ${month} ${d.getFullYear()}`;
}

function createCard(word, number) {
  const node = $('#card-template').content.firstElementChild.cloneNode(true);
  node.dataset.category = word.category;
  node.dataset.month = word.date.slice(0, 7);
  node.querySelector('.card-number').textContent = `nº ${String(number).padStart(3, '0')}`;
  const date = node.querySelector('.card-date');
  date.textContent = cardDate(word.date);
  date.dateTime = word.date;
  node.querySelector('.frame-path').setAttribute('d', CARD_FRAME);
  node.setAttribute('aria-label', `${word.name}, ${CATEGORY_LABEL[word.category]}`);

  const art = node.querySelector('.card-art');
  if (word.image) {
    const img = document.createElement('img');
    img.src = word.image;
    img.alt = word.name;
    img.loading = 'lazy';
    art.append(img);
  } else {
    const initial = document.createElement('span');
    initial.className = 'initial';
    initial.textContent = word.name.charAt(0).toUpperCase();
    art.append(initial);
  }

  node.querySelector('.card-name').textContent = word.name;
  node.querySelector('.card-caption').textContent = word.caption;
  node.querySelector('.card-tag').textContent = CATEGORY_LABEL[word.category];

  if (store.canEdit()) {
    node.tabIndex = 0;
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', `${word.name}, ${CATEGORY_LABEL[word.category]}. Abrir para editar`);
    node.addEventListener('click', () => openModal(word));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModal(word);
      }
    });
  }
  return node;
}

function renderEmpty() {
  const filtering = state.search || state.category;
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.innerHTML = `
    <svg viewBox="0 0 200 140" aria-hidden="true">
      <g filter="url(#crayon)">
        <path d="M40 92c0-30 26-50 62-50 30 0 48 16 60 30 6-14 14-26 24-30-4 14-6 24-2 36-6 8-12 10-20 8-10 18-34 30-62 30-36 0-62-6-62-24z" fill="#a9cdf0"/>
        <path d="M44 98c10 14 34 20 58 20 18 0 34-4 44-10-30 6-70 4-102-10z" fill="#fdf3dd"/>
        <path d="M96 30c-6-10-16-12-22-6M100 30c0-12 4-20 12-22M104 32c8-8 18-8 22-2" stroke="#a9cdf0" stroke-width="6" stroke-linecap="round" fill="none"/>
      </g>
      <circle cx="66" cy="82" r="5" fill="#5b5160"/>
      <circle cx="82" cy="94" r="7" fill="#f9c4cc"/>
      <path d="M44 88c6 6 16 6 22 2" stroke="#5b5160" stroke-width="3" stroke-linecap="round" fill="none"/>
    </svg>
    <p></p>`;
  wrap.querySelector('p').textContent = filtering
    ? 'Nenhuma palavrinha encontrada por aqui.'
    : 'Ainda não tem nenhuma palavrinha. Que tal a primeira?';
  if (!filtering && store.canEdit()) {
    const b = document.createElement('button');
    b.className = 'btn btn-primary';
    b.innerHTML = '<span aria-hidden="true">+</span> Nova palavra';
    b.addEventListener('click', () => openModal(null));
    wrap.append(b);
  }
  board.replaceChildren(wrap);
}

// Linha do tempo: anos e meses, cada mês leva ao primeiro card dele.
function renderTimeline(words) {
  timeline.replaceChildren();
  const years = new Map();
  for (const w of words) {
    const [year, month] = w.date.split('-');
    if (!years.has(year)) years.set(year, new Map());
    const months = years.get(year);
    months.set(month, (months.get(month) ?? 0) + 1);
  }
  for (const [year, months] of years) {
    const li = document.createElement('li');
    const label = document.createElement('div');
    label.className = 'timeline-month';
    label.textContent = year;
    const list = document.createElement('ol');
    list.className = 'timeline-days';
    for (const [month, count] of months) {
      const key = `${year}-${month}`;
      const item = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'timeline-link';
      a.href = `#mes-${key}`;
      a.dataset.month = key;
      a.innerHTML = '<span></span><span class="timeline-count"></span>';
      a.firstChild.textContent = capitalize(fmtMonth.format(parseDate(key)).split(' ')[0]);
      a.lastChild.textContent = count;
      item.append(a);
      list.append(item);
    }
    li.append(label, list);
    timeline.append(li);
  }
}

let observer;
let clickedUntil = 0; // depois de clicar num mês, ele fica ativo enquanto a página rola até lá
function watchCards() {
  observer?.disconnect();
  const links = new Map([...timeline.querySelectorAll('.timeline-link')].map((a) => [a.dataset.month, a]));
  const visible = new Map(); // mês → quantos cards dele estão na tela
  const setActive = (month) => {
    for (const [m, a] of links) a.classList.toggle('active', m === month);
    const active = links.get(month);
    // Na faixa horizontal (celular), mantém o mês ativo à vista.
    const strip = timeline.parentElement;
    if (active && strip.scrollWidth > strip.clientWidth) {
      const left = active.offsetLeft - strip.offsetLeft;
      if (left < strip.scrollLeft || left + active.offsetWidth > strip.scrollLeft + strip.clientWidth) {
        strip.scrollTo({ left: left - 16, behavior: 'smooth' });
      }
    }
  };
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const m = e.target.dataset.month;
        visible.set(m, (visible.get(m) ?? 0) + (e.isIntersecting ? 1 : -1));
      }
      if (Date.now() < clickedUntil) return;
      // O primeiro mês visível, na ordem da página, é o ativo.
      const first = [...links.keys()].find((m) => visible.get(m) > 0);
      if (first) setActive(first);
    },
    { rootMargin: '-15% 0px -45% 0px' }
  );
  board.querySelectorAll('.card').forEach((c) => observer.observe(c));
  for (const [m, a] of links) {
    a.addEventListener('click', () => {
      clickedUntil = Date.now() + 1500;
      setActive(m);
    });
  }
}

function render() {
  const total = state.words.length;
  $('#counter').textContent = total
    ? `${total} ${total === 1 ? 'palavrinha aprendida' : 'palavrinhas aprendidas'} até agora`
    : '';

  const words = visibleWords(); // já vêm da mais recente para a mais antiga
  renderTimeline(words);
  if (!words.length) {
    observer?.disconnect();
    return renderEmpty();
  }

  const numbers = numberWords(state.words);
  const grid = document.createElement('div');
  grid.className = 'grid';
  const seen = new Set();
  for (const w of words) {
    const card = createCard(w, numbers.get(w.id));
    const month = w.date.slice(0, 7);
    if (!seen.has(month)) {
      seen.add(month);
      card.id = `mes-${month}`;
    }
    grid.append(card);
  }
  board.replaceChildren(grid);
  watchCards();
}

// ---------- Formulário ----------

function setPreview(src) {
  if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
  state.previewUrl = src?.startsWith('blob:') ? src : null;
  const img = $('#photo-preview');
  img.hidden = !src;
  $('#photo-hint').hidden = Boolean(src);
  $('#photo-remove').hidden = !src;
  if (src) img.src = src;
  else img.removeAttribute('src');
}

function openModal(word) {
  state.editing = word;
  state.image = undefined;
  form.reset();
  $('#form-error').textContent = '';
  $('#modal-title').textContent = word ? 'Editar palavrinha' : 'Nova palavrinha';
  $('#delete-word').hidden = !word;
  $('#f-name').value = word?.name ?? '';
  $('#f-caption').value = word?.caption ?? '';
  const date = word?.date ?? todayIso();
  const monthOnly = isMonthOnly(date);
  $('#f-date').value = monthOnly ? '' : date;
  $('#f-date').max = todayIso();
  fillMonthPicker(date.slice(0, 4), date.slice(5, 7));
  setDateMode(monthOnly ? 'month' : 'day');
  renderCategoryPicker(word?.category ?? state.category ?? 'outros');
  setPreview(word?.image ?? null);
  modal.showModal();
  $('#f-name').focus();
}

// ---------- Data: dia certinho ou só o mês ----------

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  capitalize(new Intl.DateTimeFormat('pt-BR', { month: 'long' }).format(new Date(2020, i, 1)))
);

function fillMonthPicker(year, month) {
  const current = new Date().getFullYear();
  const years = [];
  for (let y = current; y >= Math.min(current - 6, Number(year)); y--) years.push(String(y));
  $('#f-year').replaceChildren(...years.map((y) => new Option(y, y, false, y === year)));
  $('#f-month').replaceChildren(
    ...MONTHS.map((label, i) => {
      const value = String(i + 1).padStart(2, '0');
      return new Option(label, value, false, value === month);
    })
  );
}

let dateMode = 'day';
function setDateMode(mode) {
  dateMode = mode;
  for (const b of document.querySelectorAll('.date-mode .chip')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  }
  $('#f-date').hidden = mode !== 'day';
  $('#f-month-picker').hidden = mode !== 'month';
}

function readDate() {
  if (dateMode === 'month') return `${$('#f-year').value}-${$('#f-month').value}`;
  return $('#f-date').value;
}

for (const b of document.querySelectorAll('.date-mode .chip')) {
  b.addEventListener('click', () => {
    // Ao trocar, leva junto o que já estava escolhido.
    if (b.dataset.mode === 'month' && $('#f-date').value) {
      fillMonthPicker($('#f-date').value.slice(0, 4), $('#f-date').value.slice(5, 7));
    } else if (b.dataset.mode === 'day' && !$('#f-date').value) {
      const month = `${$('#f-year').value}-${$('#f-month').value}`;
      $('#f-date').value = month === todayIso().slice(0, 7) ? todayIso() : `${month}-01`;
    }
    setDateMode(b.dataset.mode);
  });
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    state.image = await resizeImage(file);
    setPreview(URL.createObjectURL(state.image));
  } catch (err) {
    $('#form-error').textContent = err.message;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: $('#f-name').value.trim(),
    caption: $('#f-caption').value.trim(),
    date: readDate(),
    category: $('#category-picker [aria-pressed="true"]')?.dataset.value ?? 'outros',
  };
  if (!payload.name) {
    $('#form-error').textContent = 'Escreva a palavrinha 🙂';
    return $('#f-name').focus();
  }
  if (!payload.date) {
    $('#form-error').textContent = 'Escolha quando ela aprendeu';
    return;
  }
  if (payload.date > todayIso()) {
    $('#form-error').textContent = 'Essa data ainda não chegou 🙂';
    return;
  }

  const save = $('#save');
  save.disabled = true;
  save.textContent = 'Guardando...';
  try {
    state.words = state.editing
      ? await store.updateWord(state.editing, payload, state.image)
      : await store.createWord(payload, state.image ?? null);
    modal.close();
    render();
  } catch (err) {
    $('#form-error').textContent = err.message;
  } finally {
    save.disabled = false;
    save.textContent = 'Guardar';
  }
});

$('#delete-word').addEventListener('click', async () => {
  const word = state.editing;
  if (!word || !confirm(`Apagar a palavrinha "${word.name}"?`)) return;
  try {
    state.words = await store.deleteWord(word);
    modal.close();
    render();
  } catch (err) {
    $('#form-error').textContent = err.message;
  }
});

$('#cancel').addEventListener('click', () => modal.close());
modal.addEventListener('click', (e) => {
  if (e.target === modal) modal.close();
});

$('#photo-input').addEventListener('change', (e) => handleFile(e.target.files[0]));
$('#photo-remove').addEventListener('click', () => {
  state.image = null;
  $('#photo-input').value = '';
  setPreview(null);
});

const drop = $('#photo-drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('dragging');
});
drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('dragging');
  handleFile(e.dataTransfer.files[0]);
});

$('#new-word').addEventListener('click', () => openModal(null));

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value;
    render();
  }, 120);
});

// ---------- Início ----------

async function load() {
  try {
    state.words = await store.listWords();
    render();
  } catch (err) {
    board.innerHTML = '<p class="empty"></p>';
    board.firstChild.textContent = `Não consegui carregar as palavrinhas: ${err.message}`;
  }
}

// As molduras dos formulários acompanham o tamanho real deles, para as ondinhas não esticarem.
for (const frame of document.querySelectorAll('.modal-frame')) {
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    frame.setAttribute('viewBox', `0 0 ${width} ${height}`);
    frame.querySelector('.frame-path').setAttribute('d', scallopPath(width, height, 8, 7));
  }).observe(frame.parentElement);
}

// ---------- Modo de edição (token do GitHub) ----------

const tokenModal = $('#token-modal');

function applyMode() {
  document.body.dataset.mode = store.canEdit() ? 'edit' : 'view';
}

$('#connect').addEventListener('click', () => {
  $('#token-form').reset();
  $('#token-error').textContent = '';
  tokenModal.showModal();
  $('#token-input').focus();
});

$('#token-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const button = $('#token-save');
  $('#token-error').textContent = '';
  button.disabled = true;
  try {
    await store.connect($('#token-input').value);
    tokenModal.close();
    applyMode();
    await load();
  } catch (err) {
    $('#token-error').textContent = err.message;
  } finally {
    button.disabled = false;
  }
});

$('#token-cancel').addEventListener('click', () => tokenModal.close());
tokenModal.addEventListener('click', (e) => {
  if (e.target === tokenModal) tokenModal.close();
});

$('#disconnect').addEventListener('click', async () => {
  if (!confirm('Sair do modo de edição neste aparelho?')) return;
  store.disconnect();
  applyMode();
  await load();
});

renderTitle();
renderFilters();
applyMode();
load();
