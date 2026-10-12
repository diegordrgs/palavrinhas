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
  image: undefined, // data URL nova, null para remover, undefined para manter
};

const $ = (sel) => document.querySelector(sel);
const board = $('#board');
const timeline = $('#timeline');
const modal = $('#modal');
const form = $('#word-form');

// ---------- Utilidades ----------

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayIso() {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
}

const fmtLong = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' });
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

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Algo deu errado');
  }
  return res.status === 204 ? null : res.json();
}

// Reduz a imagem no navegador antes de enviar, para o banco ficar leve.
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
      let data = canvas.toDataURL('image/webp', 0.9);
      if (!data.startsWith('data:image/webp')) data = canvas.toDataURL('image/png');
      resolve(data);
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

function groupByDate(words) {
  const groups = new Map();
  for (const w of words) {
    if (!groups.has(w.date)) groups.set(w.date, []);
    groups.get(w.date).push(w);
  }
  // As palavras já vêm do servidor da mais recente para a mais antiga.
  return [...groups.entries()];
}

function createCard(word) {
  const node = $('#card-template').content.firstElementChild.cloneNode(true);
  node.dataset.category = word.category;
  node.querySelector('.frame-path').setAttribute('d', CARD_FRAME);
  node.setAttribute('aria-label', `${word.name}, ${CATEGORY_LABEL[word.category]}. Abrir para editar`);

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

  node.addEventListener('click', () => openModal(word));
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openModal(word);
    }
  });
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
  if (!filtering) {
    const b = document.createElement('button');
    b.className = 'btn btn-primary';
    b.innerHTML = '<span aria-hidden="true">+</span> Nova palavra';
    b.addEventListener('click', () => openModal(null));
    wrap.append(b);
  }
  board.replaceChildren(wrap);
}

function renderTimeline(groups) {
  timeline.replaceChildren();
  const months = new Map();
  for (const [date, words] of groups) {
    const key = date.slice(0, 7);
    if (!months.has(key)) months.set(key, []);
    months.get(key).push([date, words.length]);
  }
  for (const [key, days] of months) {
    const li = document.createElement('li');
    const label = document.createElement('div');
    label.className = 'timeline-month';
    label.textContent = fmtMonth.format(parseDate(`${key}-01`));
    const list = document.createElement('ol');
    list.className = 'timeline-days';
    for (const [date, count] of days) {
      const item = document.createElement('li');
      const a = document.createElement('a');
      a.className = 'timeline-link';
      a.href = `#dia-${date}`;
      a.dataset.date = date;
      a.innerHTML = '<span></span><span class="timeline-count"></span>';
      a.firstChild.textContent = fmtShort.format(parseDate(date)).replace('.', '');
      a.lastChild.textContent = count;
      item.append(a);
      list.append(item);
    }
    li.append(label, list);
    timeline.append(li);
  }
}

let observer;
function watchSections() {
  observer?.disconnect();
  const links = new Map([...timeline.querySelectorAll('.timeline-link')].map((a) => [a.dataset.date, a]));
  const visible = new Set();
  const setActive = (date) => {
    for (const [d, a] of links) a.classList.toggle('active', d === date);
    const active = links.get(date);
    // Na faixa horizontal (celular), mantém o dia ativo à vista.
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
        if (e.isIntersecting) visible.add(e.target.dataset.date);
        else visible.delete(e.target.dataset.date);
      }
      // O primeiro dia visível, na ordem da página, é o ativo.
      const first = [...links.keys()].find((d) => visible.has(d));
      if (first) setActive(first);
    },
    { rootMargin: '-10% 0px -50% 0px' }
  );
  board.querySelectorAll('.day-section').forEach((s) => observer.observe(s));
}

function render() {
  const total = state.words.length;
  $('#counter').textContent = total
    ? `${total} ${total === 1 ? 'palavrinha aprendida' : 'palavrinhas aprendidas'} até agora`
    : '';

  const groups = groupByDate(visibleWords());
  renderTimeline(groups);
  if (!groups.length) {
    observer?.disconnect();
    return renderEmpty();
  }

  const sections = groups.map(([date, words]) => {
    const section = document.createElement('section');
    section.className = 'day-section';
    section.id = `dia-${date}`;
    section.dataset.date = date;

    const h = document.createElement('h2');
    h.className = 'day-title';
    h.textContent = fmtLong.format(parseDate(date));
    const small = document.createElement('small');
    small.textContent = `${words.length} ${words.length === 1 ? 'palavra' : 'palavras'}`;
    h.append(small);

    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.append(...words.map(createCard));

    section.append(h, grid);
    return section;
  });
  board.replaceChildren(...sections);
  watchSections();
}

// ---------- Formulário ----------

function setPreview(src) {
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
  $('#f-date').value = word?.date ?? todayIso();
  $('#f-date').max = todayIso();
  renderCategoryPicker(word?.category ?? state.category ?? 'outros');
  setPreview(word?.image ?? null);
  modal.showModal();
  $('#f-name').focus();
}

async function handleFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  try {
    state.image = await resizeImage(file);
    setPreview(state.image);
  } catch (err) {
    $('#form-error').textContent = err.message;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    name: $('#f-name').value.trim(),
    caption: $('#f-caption').value.trim(),
    date: $('#f-date').value,
    category: $('#category-picker [aria-pressed="true"]')?.dataset.value ?? 'outros',
  };
  if (!payload.name) {
    $('#form-error').textContent = 'Escreva a palavrinha 🙂';
    return $('#f-name').focus();
  }
  if (state.image !== undefined) payload.image = state.image;

  const save = $('#save');
  save.disabled = true;
  try {
    if (state.editing) {
      await api(`/api/words/${state.editing.id}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await api('/api/words', { method: 'POST', body: JSON.stringify(payload) });
    }
    modal.close();
    await load();
  } catch (err) {
    $('#form-error').textContent = err.message;
  } finally {
    save.disabled = false;
  }
});

$('#delete-word').addEventListener('click', async () => {
  const word = state.editing;
  if (!word || !confirm(`Apagar a palavrinha "${word.name}"?`)) return;
  try {
    await api(`/api/words/${word.id}`, { method: 'DELETE' });
    modal.close();
    await load();
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
    state.words = await api('/api/words');
    render();
  } catch (err) {
    board.innerHTML = '<p class="empty"></p>';
    board.firstChild.textContent = `Não consegui carregar as palavrinhas: ${err.message}`;
  }
}

// A moldura do formulário acompanha o tamanho real dele, para as ondinhas não esticarem.
const modalFrame = $('.modal-frame');
new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect;
  if (!width || !height) return;
  modalFrame.setAttribute('viewBox', `0 0 ${width} ${height}`);
  modalFrame.querySelector('.frame-path').setAttribute('d', scallopPath(width, height, 8, 7));
}).observe(form);
renderTitle();
renderFilters();
load();
