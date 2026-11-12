// 页面逻辑：两个模式「搜案例」「看原理」。
import * as E from './engine.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f3 = (x) => (Math.round(x * 1000) / 1000).toFixed(3);
const TRACKS = { ML: '机器学习', DL: '深度学习', RL: '强化学习', DM: '数据挖掘', OPT: '优化运筹', ST: '统计分析' };
const EXAMPLES = ['怎么用机器学习发现信用卡盗刷', '有没有听声音识别的例子', '强化学习玩游戏', '看 X 光片判断肺炎',
  '预测房价', '电影推荐是怎么做的', '垃圾短信怎么识别', 'YOLOv8'];
const DEMO_SEM = '银行卡被人偷偷刷钱，怎么提前发现';
const DEMO_KW = 'YOLOv8';
const DEMO_OFF = '今天天气怎么样';
const DEFAULT_Q = EXAMPLES[0];

const settings = { k: 5, w: 0.5, T: 0.55, tracks: new Set(), field: '', method: 'hybrid' };
let cur = null;          // 当前问题的全部中间结果
let mode = 'search';
let howDirty = true;
let ready = false;
let fieldColor = {};

// ---------------- 加载 ----------------
const fill = $('#loadfill'), ltext = $('#loadtext'), bar = $('#loadbar');
const W = { data: [0, 0.18], model: [0.18, 0.9], engine: [0.9, 0.98], ready: [1, 1] };
const readyP = E.loadAll((stage, frac, text) => {
  const [a, b] = W[stage] || [0, 1];
  fill.style.width = `${(a + (b - a) * frac) * 100}%`;
  ltext.textContent = text;
}).then(() => {
  ready = true; bar.classList.add('done');
  initAfterLoad();
}).catch((err) => {
  console.error(err);
  bar.classList.add('err');
  ltext.textContent = `加载失败：${err.message}。如果你是直接双击打开的 index.html，请改用 start.bat（浏览器不允许 file:// 页面读取本地数据）。`;
});
window.__rag = { ready: readyP, settings, get cur() { return cur; }, run: (q) => runQuery(q), E };

// ---------------- 主题 ----------------
$('#themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const t = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('rag-theme', t); } catch (e) { /* 无痕模式等 */ }
  if (cur && mode === 'how') drawMap();
  if (cur && mode === 'how') drawBarcode();
});

// ---------------- 模式切换 ----------------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
function setMode(m) {
  mode = m;
  document.querySelectorAll('.tab').forEach((b) => { const on = b.dataset.mode === m; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
  $('#mode-search').hidden = m !== 'search';
  $('#mode-how').hidden = m !== 'how';
  writeHash();
  if (m === 'how' && ready) {
    if (!cur) runQuery($('#q').value.trim() || DEFAULT_Q);
    else if (howDirty) renderHow();
  }
}

// ---------------- 输入 ----------------
const chipsBox = $('#examples');
chipsBox.innerHTML = '<span class="muted" style="font-size:14px">试试：</span>' + EXAMPLES.map((q) => `<button type="button" class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('');
chipsBox.addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (b) { $('#q').value = b.dataset.q; runQuery(b.dataset.q); } });
$('#qform').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#q').value.trim(); if (q) runQuery(q); });

function initAfterLoad() {
  // 筛选器
  const tf = $('#trackFilters');
  tf.innerHTML = '<span>大类</span>' + Object.entries(TRACKS).map(([k, v]) => `<button type="button" class="chip small" data-t="${k}">${v} ${k}</button>`).join('');
  tf.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    const t = b.dataset.t; settings.tracks.has(t) ? settings.tracks.delete(t) : settings.tracks.add(t);
    b.classList.toggle('on'); if (cur) renderSearch();
  });
  const counts = {};
  Object.values(E.state.cases).forEach((c) => { counts[c.field] = (counts[c.field] || 0) + 1; });
  const fields = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  $('#fieldSel').innerHTML += fields.map(([f, n]) => `<option value="${esc(f)}">${esc(f)}（${n}）</option>`).join('');
  $('#fieldSel').addEventListener('change', (e) => { settings.field = e.target.value; if (cur) renderSearch(); });
  $('#methodSel').addEventListener('change', (e) => { settings.method = e.target.value; if (cur) renderSearch(); });
  // 地图颜色：前 7 大领域各占一个颜色，其余并成“其他领域”
  fields.forEach(([f], i) => { fieldColor[f] = i < 7 ? `--s${i + 1}` : '--other'; });

  const h = readHash();
  if (h.q) $('#q').value = h.q;
  if (h.mode === 'how') setMode('how');
  if (h.q) runQuery(h.q);
  else $('#status').textContent = `已就绪：${E.state.n} 个文本块，来自 ${Object.keys(E.state.cases).length} 个案例。输入问题，或点上面的示例。`;
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { q: p.get('q') || '', mode: p.get('mode') || '' };
}
function writeHash() {
  const p = new URLSearchParams();
  if (cur?.q) p.set('q', cur.q);
  if (mode === 'how') p.set('mode', 'how');
  try { history.replaceState(null, '', '#' + p.toString()); } catch (e) { /* ignore */ }
}

// ---------------- 核心：跑一次检索 ----------------
let runId = 0;
async function runQuery(q) {
  const my = ++runId;
  $('#q').value = q;
  const go = $('#go');
  if (!ready) { $('#status').textContent = '模型还在加载，稍等一下，加载完会自动搜索……'; await readyP; }
  if (my !== runId) return;
  go.disabled = true;
  const t0 = performance.now();
  const qv = await E.embed(q);
  const t1 = performance.now();
  const sem = E.semanticScores(qv);
  const semOrder = E.rankOf(sem);
  const bm = E.bm25Scores(q);
  const kwOrder = E.rankOf(bm.scores);
  const t2 = performance.now();
  const { ids, toks } = E.tokenize(q);
  if (my !== runId) return;
  cur = { q, qv, sem, semOrder, kw: bm.scores, kwOrder, kwTerms: bm.terms, ids, toks,
    tEmbed: t1 - t0, tSearch: t2 - t1, rare: E.rareAsciiHits(q) };
  go.disabled = false;
  writeHash();
  renderSearch();
  howDirty = true;
  if (mode === 'how') renderHow();
}

function isOffTopic(maxCos) { return maxCos < settings.T && cur.rare.length === 0; }

// ---------------- 模式一：搜案例 ----------------
function passFilter(i) {
  const c = E.state.cases[E.state.chunks[i].slug];
  if (settings.field && c.field !== settings.field) return false;
  if (settings.tracks.size && !c.track.some((t) => settings.tracks.has(t))) return false;
  return true;
}

function rankedChunks(method, filt) {
  const so = filt ? cur.semOrder.filter(filt) : cur.semOrder;
  const ko = filt ? cur.kwOrder.filter(filt) : cur.kwOrder;
  if (method === 'sem') return so.map((i) => [i, cur.sem[i]]);
  if (method === 'kw') return ko.filter((i) => cur.kw[i] > 0).map((i) => [i, cur.kw[i]]);
  return E.rrf(so, ko, cur.kw, settings.w);
}

function renderSearch() {
  const box = $('#results');
  const ranked = rankedChunks(settings.method, passFilter);
  const caseBest = new Map();   // 每个案例语义上最像的分数
  for (const i of cur.semOrder) { if (!passFilter(i)) continue; const s = E.state.chunks[i].slug; if (!caseBest.has(s)) caseBest.set(s, cur.sem[i]); }
  const maxCos = caseBest.size ? Math.max(...caseBest.values()) : 0;
  const status = $('#status');
  if (!ranked.length && settings.method === 'kw') {
    status.textContent = '';
    box.innerHTML = `<div class="empty">关键词检索一个字都没对上。换成“混合”或“只看意思”试试——它们能理解同义词。</div>`;
    return;
  }
  if (settings.method !== 'kw' && isOffTopic(maxCos)) {
    status.textContent = '';
    box.innerHTML = `<div class="empty nores"><b>没有找到相关案例。</b><br>最像的一块，相似度也只有 ${f3(maxCos)}，低于门槛 ${settings.T.toFixed(2)}。<br>这个问题可能和案例库无关；换个说法，或者问问和数据、模型有关的问题吧。<br><span class="muted">（想知道“门槛”是什么，去「看原理」第 8 步）</span></div>`;
    return;
  }
  const seen = new Map();
  for (const [i, s] of ranked) {
    const slug = E.state.chunks[i].slug;
    if (seen.has(slug)) continue;
    const best = caseBest.get(slug) || 0;
    const hasRare = cur.rare.some((t) => E.chunkFullText(E.state.chunks[i]).toLowerCase().includes(t));
    if (settings.method !== 'kw' && best < settings.T && !hasRare) continue;
    seen.set(slug, { i, s, best });
    if (seen.size >= 8) break;
  }
  const filtNote = (settings.field || settings.tracks.size) ? '（已筛选）' : '';
  status.innerHTML = `找到 ${seen.size} 个相关案例${filtNote} · 把问题变成向量用了 ${Math.round(cur.tEmbed)} ms，在 ${E.state.n} 块里比了一遍用了 ${Math.round(cur.tSearch)} ms`;
  if (!seen.size) { box.innerHTML = `<div class="empty">在当前筛选条件下没有足够相似的案例。试试去掉筛选。</div>`; return; }
  let r = 0;
  box.innerHTML = [...seen.entries()].map(([slug, { i, best }]) => {
    r++;
    const ch = E.state.chunks[i]; const c = E.state.cases[slug];
    const pct = Math.max(0, Math.min(1, (best - 0.3) / 0.5));
    const doc = encodeURI(E.state.site + '讲稿/' + ch.doc);
    return `<article class="card" data-slug="${esc(slug)}" style="animation-delay:${r * 40}ms">
      <h3><span class="rank">${r}.</span>${esc(c.title)}</h3>
      <div class="tags">${c.track.map((t) => `<span class="tag track">${TRACKS[t] || t}</span>`).join('')}
        <span class="tag">${esc(c.field)}</span><span class="tag">${esc(c.group)}</span><span class="tag">${esc(c.level)}</span></div>
      <div class="why"><span class="sec">为什么匹配：「${esc(ch.sec)}」${ch.parts > 1 ? `（第 ${ch.part}/${ch.parts} 块）` : ''}</span>${highlight(ch.t, cur.q)}</div>
      <div class="score"><span>意思相似度 ${f3(best)}</span><span class="meter"><i style="width:${pct * 100}%"></i></span>${cur.kw[i] > 0 ? `<span>关键词得分 ${cur.kw[i].toFixed(1)}</span>` : '<span>字面上没有对上，靠“意思”找到的</span>'}</div>
      <div class="btns">
        <a class="btn primary" href="${esc(ch.url)}" target="_blank" rel="noopener">打开案例</a>
        <a class="btn" href="${esc(c.kaggle)}" target="_blank" rel="noopener">Kaggle 原 notebook</a>
        <a class="btn" href="${esc(doc)}" target="_blank" rel="noopener">Word 讲稿</a>
      </div></article>`;
  }).join('');
}

function highlight(text, q) {
  const N = E.state.bm25.N;
  const terms = [...new Set(E.kwTokens(q))].filter((t) => E.df(t) < N * 0.2 && t.length >= 2);
  const low = text.toLowerCase(); const mask = new Uint8Array(text.length);
  for (const t of terms) { let p = 0; while ((p = low.indexOf(t, p)) >= 0) { mask.fill(1, p, p + t.length); p += 1; } }
  let out = '', on = false;
  for (let i = 0; i < text.length; i++) {
    if (mask[i] && !on) { out += '<mark>'; on = true; }
    if (!mask[i] && on) { out += '</mark>'; on = false; }
    out += text[i] === '\n' ? '<br>' : esc(text[i]);
  }
  return out + (on ? '</mark>' : '');
}

// ---------------- 模式二：看原理 ----------------
const STEPS = [
  ['切块', '文档 → 切块'], ['向量', '分词 → 向量'], ['向量库', '向量库：一张“意思地图”'], ['相似度', '相似度：比方向'],
  ['top-k', '检索前 k 块'], ['对照', '对照：关键词检索 vs 语义检索'], ['增强', '增强：拼出提示词'], ['生成', '生成：写出答案'],
];
$('#stepnav').innerHTML = STEPS.map(([s], i) => `<a href="#step-${i + 1}" data-n="${i + 1}">${i + 1} ${s}</a>`).join('');
$('#stepnav').addEventListener('click', (e) => {
  const a = e.target.closest('a'); if (!a) return; e.preventDefault();
  document.getElementById(a.getAttribute('href').slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#steps').innerHTML = STEPS.map(([, t], i) => `<section class="step" id="step-${i + 1}"><h2><span class="n">${i + 1}</span>${t}</h2><div class="body"></div></section>`).join('');

const io = 'IntersectionObserver' in window ? new IntersectionObserver((ents) => {
  for (const e of ents) {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      const n = e.target.id.split('-')[1];
      document.querySelectorAll('#stepnav a').forEach((a) => a.classList.toggle('cur', a.dataset.n === n));
      if (n === '2') animateBarcode();
      if (n === '3') animateMap();
    }
  }
}, { threshold: 0.12 }) : null;
document.querySelectorAll('.step').forEach((s) => (io ? io.observe(s) : s.classList.add('in')));

const body = (n) => $(`#step-${n} .body`);

function renderHow() {
  howDirty = false;
  $('#howQuery').innerHTML = `当前问题：<b>${esc(cur.q)}</b>　（在上面的搜索框换一个问题，下面每一步都会跟着变）`;
  step1(); step2(); step3(); step4(); step5(); step6(); step7(); step8();
  if ($('#step-2').classList.contains('in')) animateBarcode();
  if ($('#step-3').classList.contains('in')) animateMap();
}

function topSem(k, filt) { const out = []; for (const i of cur.semOrder) { if (filt && !filt(i)) continue; out.push(i); if (out.length >= k) break; } return out; }
function label(i) { const ch = E.state.chunks[i]; return `${E.state.cases[ch.slug].title} · ${ch.sec}${ch.parts > 1 ? `（${ch.part}/${ch.parts}）` : ''}`; }

// 第 1 步：切块
function step1() {
  const chunks = E.state.chunks;
  const top = cur.semOrder[0];
  let pick = chunks[top].parts > 1 ? top : -1;
  if (pick < 0) pick = chunks.findIndex((c) => c.slug === chunks[top].slug && c.parts > 1);
  if (pick < 0) pick = chunks.findIndex((c) => c.parts > 2);
  const ch = chunks[pick];
  let s = pick; while (s > 0 && chunks[s - 1].slug === ch.slug && chunks[s - 1].sec === ch.sec) s--;
  const parts = []; for (let i = s; i < chunks.length && chunks[i].slug === ch.slug && chunks[i].sec === ch.sec; i++) parts.push(chunks[i]);
  const lens = chunks.map((c) => c.t.length);
  const bins = new Array(20).fill(0); const bw = 20;
  lens.forEach((l) => { bins[Math.min(19, Math.floor(l / bw))]++; });
  const mx = Math.max(...bins);
  const nSplit = new Set(chunks.filter((c) => c.parts > 1).map((c) => c.slug + c.sec)).size;
  const nCard = chunks.filter((c) => c.kind === 'card').length;
  body(1).innerHTML = `
    <p>电脑没法一口气“读懂”一整份讲稿。所以先把每个案例拆成一张张小卡片（叫<b>块</b>，chunk）：每个案例 1 张“案例卡片”（标题、简介、领域、方法），讲稿里的每一节（每一章、每个实验）各 1 张。</p>
    <div class="analogy">图书馆不会让你翻遍每本书，而是给每本书、每一章做一张索引卡片。找东西时先翻卡片。</div>
    <div class="kv"><span>案例 <b>${Object.keys(E.state.cases).length}</b></span><span>块 <b>${chunks.length}</b></span><span>其中案例卡片 <b>${nCard}</b></span><span>每块最长约 <b>260</b> 字</span><span>太长被切开的小节 <b>${nSplit}</b></span></div>
    <p>一节太长时，会按句子切成几块，并且<b>下一块开头重复上一块末尾的一两句</b>（重叠约 60 字，下图橙色），这样一句话不会被拦腰切断、丢了上下文。下面是和你的问题最相关的一节，真实的切法：</p>
    <p class="muted" style="font-size:14px">《${esc(E.state.cases[ch.slug].title)}》· ${esc(ch.sec)}</p>
    <div class="pieces">${parts.map((p, k) => `<div class="piece" style="animation-delay:${k * 120}ms"><span class="lab">第 ${p.part} 块 · ${p.t.length} 字${p.ov ? ` · 开头 ${p.ov} 字和上一块重叠` : ''}</span>${p.ov ? `<span class="ov">${esc(p.t.slice(0, p.ov))}</span>` : ''}${esc(p.t.slice(p.ov)).replace(/\n/g, '<br>')}</div>`).join('')}</div>
    <p style="margin-top:12px">所有 ${chunks.length} 块的长度分布（每根柱子 = ${bw} 字一档）：</p>
    <div class="hist" id="hist">${bins.map((b, i) => `<div style="height:${(b / mx) * 100}%" data-tip="${i * bw}–${i * bw + bw - 1} 字：${b} 块"></div>`).join('')}</div>
    <div class="hist-ax"><span>0 字</span><span>200 字</span><span>400 字</span></div>`;
  bindTips(body(1));
}

// 第 2 步：分词 → 向量
function step2() {
  const { ids, toks, qv } = cur;
  const nrm = E.norm(qv);
  body(2).innerHTML = `
    <p><b>先分词：</b>模型只认识数字。它有一本 21128 个“字”的字典，把你的问题里每个字（英文是一段一段的）换成字典里的编号。开头的 [CLS] 和结尾的 [SEP] 是两个特殊记号，表示“一句话开始/结束”。</p>
    <div class="tokens">${toks.map((t, k) => `<span class="tok${/^\[.*\]$/.test(t) ? ' special' : ''}" style="animation-delay:${k * 40}ms">${esc(t)}<small>${ids[k]}</small></span>`).join('')}</div>
    <p class="muted" style="font-size:14px">共 ${ids.length} 个 token（含 2 个特殊记号）。</p>
    <p><b>再变向量：</b>这串编号送进模型（bge-small-zh，一个只有 4 层的小型 Transformer，约 2400 万个参数），出来的是 <b>${qv.length}</b> 个小数，叫<b>向量</b>。我们取 [CLS] 位置的那一组数代表整句话的意思。下面每一根竖条是一个数：<span style="color:var(--pos)">橙色</span>是正数，<span style="color:var(--neg)">蓝色</span>是负数，颜色越深数越大。</p>
    <canvas class="barcode" id="barcode" width="1024" height="120" aria-label="问题向量的条形码"></canvas>
    <div class="kv"><span>维度 <b>${qv.length}</b></span><span>前 6 个数 <b>${Array.from(qv.slice(0, 6), (x) => x.toFixed(3)).join(', ')} …</b></span><span>向量长度 |q| = <b>${nrm.toFixed(4)}</b>（已归一化）</span></div>
    <div class="analogy">像商品条形码：每一格单独看没意义，合在一起就是这句话的“意思指纹”。意思相近的两句话，条形码也长得像。</div>
    <p>每一块文字也提前用<b>同一个模型、同一种取法</b>算好了向量（在电脑上用 Python 算的，和你浏览器里算的完全一致），存成一个 ${(E.state.n * 512 / 1e6).toFixed(1)} MB 的小文件。</p>`;
  drawBarcode(1);
}
let barAnim = 0;
function drawBarcode(p = 1) {
  const cv = $('#barcode'); if (!cv || !cur) return;
  const ctx = cv.getContext('2d'); const v = cur.qv; const n = v.length;
  const cs = getComputedStyle(document.documentElement);
  const neg = cs.getPropertyValue('--neg').trim(), pos = cs.getPropertyValue('--pos').trim(), mid = cs.getPropertyValue('--mid').trim();
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = mid; ctx.fillRect(0, 0, cv.width, cv.height);
  const m = Math.max(...Array.from(v, Math.abs));
  const show = Math.floor(n * p); const w = cv.width / n;
  for (let i = 0; i < show; i++) {
    const a = Math.min(1, Math.abs(v[i]) / m);
    ctx.globalAlpha = 0.15 + 0.85 * a;
    ctx.fillStyle = v[i] >= 0 ? pos : neg;
    ctx.fillRect(i * w, 0, Math.max(1, w), cv.height);
  }
  ctx.globalAlpha = 1;
}
function animateBarcode() {
  if (!cur || document.visibilityState !== 'visible') return; const t0 = performance.now(); const id = ++barAnim;
  const tick = (t) => { if (id !== barAnim) return; const p = Math.min(1, (t - t0) / 900); drawBarcode(p); if (p < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setTimeout(() => { if (id === barAnim) { barAnim++; drawBarcode(1); } }, 1200);   // 后台标签页里 rAF 可能暂停，保证最后画完整
}

// 第 3 步：向量库地图
const mapState = { solo: null, prog: 1, topk: [] };
function step3() {
  const fields = Object.keys(fieldColor);
  const groups = {}; fields.forEach((f) => { const k = fieldColor[f]; (groups[k] = groups[k] || []).push(f); });
  const leg = fields.filter((f) => fieldColor[f] !== '--other').map((f) => [f, fieldColor[f]]);
  const others = fields.filter((f) => fieldColor[f] === '--other');
  const ex = E.state.pca.explained; const pct = Math.round((ex[0] + ex[1]) * 100);
  body(3).innerHTML = `
    <p>${E.state.n} 块文字，每块都是一个 512 维的向量。512 维没法画，我们用一种叫 <b>PCA</b>（主成分分析）的方法把它“压扁”成 2 维，画成一张地图：每个点是一块文字，颜色是它所属的领域。</p>
    <div class="analogy">像一座图书馆的平面图：讲医学的书放在一片，讲金融的放在另一片。你的问题（★）被放到地图上，旁边的书就是最可能有答案的。</div>
    <div class="legend" id="legend">${leg.map(([f, k]) => `<button type="button" data-f="${esc(f)}"><span class="sw" style="background:var(${k})"></span>${esc(f)}</button>`).join('')}<button type="button" data-f="__other"><span class="sw" style="background:var(--other)"></span>其他领域（${others.map(esc).join('、')}）</button><span class="muted">点一个领域只看它，再点一次恢复</span></div>
    <canvas class="map" id="map" width="900" height="675" aria-label="所有文本块的二维地图"></canvas>
    <p class="muted" style="font-size:14px">★ 是你的问题，<span style="color:var(--bad)">红圈</span>是和它最相似的 ${settings.k} 块（用细线连着）。压扁到 2 维只保留了约 ${pct}% 的差别，所以地图上看着近不一定真的近——真正算相似度用的是完整的 512 维（下一步）。把鼠标放到点上能看是哪一块。</p>`;
  $('#legend').addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]'); if (!b) return;
    mapState.solo = mapState.solo === b.dataset.f ? null : b.dataset.f;
    document.querySelectorAll('#legend button').forEach((x) => { x.classList.toggle('off', !!mapState.solo && x.dataset.f !== mapState.solo); x.classList.toggle('solo', x.dataset.f === mapState.solo); });
    drawMap();
  });
  const cv = $('#map');
  cv.addEventListener('mousemove', (e) => mapHover(e));
  cv.addEventListener('mouseleave', () => hideTip());
  mapState.prog = 1;
  drawMap();
}
function mapGeom(cv) {
  const xy = E.state.pca.xy;
  if (!mapGeom.b) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of xy) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    mapGeom.b = { x0, x1, y0, y1 };
  }
  const { x0, x1, y0, y1 } = mapGeom.b; const pad = 24;
  return { sx: (x) => pad + (x - x0) / (x1 - x0) * (cv.width - 2 * pad), sy: (y) => cv.height - pad - (y - y0) / (y1 - y0) * (cv.height - 2 * pad) };
}
function drawMap() {
  const cv = $('#map'); if (!cv || !cur) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1); const W = Math.round((cv.clientWidth || 900) * dpr);
  if (W > 0 && cv.width !== W) { cv.width = W; cv.height = Math.round(W * 0.75); }
  const u = dpr;   // 点、线、星星的大小跟着屏幕像素走，手机上也看得清
  const ctx = cv.getContext('2d'); const cs = getComputedStyle(document.documentElement);
  const col = (k) => cs.getPropertyValue(k).trim();
  const { sx, sy } = mapGeom(cv); const xy = E.state.pca.xy; const chunks = E.state.chunks;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const palette = {}; Object.values(fieldColor).forEach((k) => { palette[k] = col(k); });
  const otherC = col('--other');
  for (let i = 0; i < xy.length; i++) {
    const f = E.state.cases[chunks[i].slug].field; const k = fieldColor[f];
    const key = k === '--other' ? '__other' : f;
    const dim = mapState.solo && mapState.solo !== key;
    ctx.globalAlpha = dim ? 0.08 : 0.55;
    ctx.fillStyle = dim ? otherC : palette[k];
    ctx.beginPath(); ctx.arc(sx(xy[i][0]), sy(xy[i][1]), 2.2 * u, 0, 6.283); ctx.fill();
  }
  ctx.globalAlpha = 1;
  const [qx, qy] = E.project2d(cur.qv);
  const p = mapState.prog; const tx = sx(qx), ty = sy(qy);
  const yy = -30 + (ty + 30) * easeOut(p);
  const top = topSem(settings.k); mapState.topk = top;
  if (p >= 1) {
    ctx.strokeStyle = col('--text'); ctx.lineWidth = 1.2 * u; ctx.globalAlpha = 0.6;
    for (const i of top) { ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(sx(xy[i][0]), sy(xy[i][1])); ctx.stroke(); }
    ctx.globalAlpha = 1;
  }
  star(ctx, tx, yy, 10 * u, col('--text'), col('--surface'));
  if (p >= 1) {   // 圈画在星星上面，挨得很近时也看得见
    for (const i of top) {
      const x = sx(xy[i][0]), y = sy(xy[i][1]);
      ctx.lineWidth = 3.5 * u; ctx.strokeStyle = col('--surface'); ctx.beginPath(); ctx.arc(x, y, 6.5 * u, 0, 6.283); ctx.stroke();
      ctx.lineWidth = 2 * u; ctx.strokeStyle = col('--bad'); ctx.beginPath(); ctx.arc(x, y, 6.5 * u, 0, 6.283); ctx.stroke();
    }
  }
}
function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
function star(ctx, x, y, r, fillC, ringC) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); }
  ctx.closePath(); ctx.lineWidth = r / 3.5; ctx.strokeStyle = ringC; ctx.stroke(); ctx.fillStyle = fillC; ctx.fill();
}
let mapAnim = 0;
function animateMap() {
  if (!cur || !$('#map') || document.visibilityState !== 'visible') return; const t0 = performance.now();
  const id = ++mapAnim;
  const tick = (t) => { if (id !== mapAnim) return; mapState.prog = Math.min(1, (t - t0) / 700); drawMap(); if (mapState.prog < 1) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  setTimeout(() => { if (id === mapAnim) { mapAnim++; mapState.prog = 1; drawMap(); } }, 1000);
}
function mapHover(e) {
  const cv = e.currentTarget; const r = cv.getBoundingClientRect();
  const mx = (e.clientX - r.left) * cv.width / r.width, my = (e.clientY - r.top) * cv.height / r.height;
  const { sx, sy } = mapGeom(cv); const xy = E.state.pca.xy;
  let best = -1, bd = 100;
  for (let i = 0; i < xy.length; i++) { const dx = sx(xy[i][0]) - mx, dy = sy(xy[i][1]) - my; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = i; } }
  if (best < 0) return hideTip();
  const ch = E.state.chunks[best];
  showTip(e.clientX, e.clientY, `${label(best)}\n领域：${E.state.cases[ch.slug].field}\n和问题的相似度 ${f3(cur.sem[best])}`);
}

// 第 4 步：相似度
function step4() {
  const q = cur.qv; const top = topSem(3); const worst = cur.semOrder[cur.semOrder.length - 1];
  const rows = top.map((i, r) => {
    const d = E.chunkVec(i); const terms = [0, 1, 2].map((j) => `${q[j].toFixed(3)}×${d[j].toFixed(3)}`);
    return `<div class="calc"><b>第 ${r + 1} 名</b> ${esc(label(i))}<br>|q| = ${E.norm(q).toFixed(4)}，|d| = ${E.norm(d).toFixed(4)}<br>q·d = ${terms.join(' + ')} + …（一共 512 项相乘再相加）= <b>${f3(E.dot(q, d))}</b></div>`;
  }).join('');
  const c1 = cur.sem[top[0]], c2 = cur.sem[worst];
  body(4).innerHTML = `
    <p>怎么判断两块文字“意思像不像”？看它们向量的<b>方向</b>一不一样。数学上叫<b>余弦相似度</b>：</p>
    <div class="formula">cos(q, d) = <span class="frac"><span>q · d</span><span>|q| × |d|</span></span> = <span class="frac"><span>q₁d₁ + q₂d₂ + … + q₅₁₂d₅₁₂</span><span>|q| × |d|</span></span></div>
    <p>因为所有向量都已经<b>归一化</b>（长度都变成 1），分母就是 1×1 = 1，所以相似度 = 把 512 对数字<b>对应相乘再加起来</b>（点积）。越接近 1 越像，接近 0 就是不相干。这是刚才真实算出来的：</p>
    ${rows}
    <div class="svgbox">${angleSvg(c1, c2, label(worst))}</div>
    <div class="analogy">两个人指路，手指的方向越一致，说的就越可能是同一个地方。至于手臂长短（向量长度）不重要，所以先统一成一样长。</div>`;
}
function angleSvg(c1, c2, worstLabel) {
  const a1 = Math.acos(Math.max(-1, Math.min(1, c1))), a2 = Math.acos(Math.max(-1, Math.min(1, c2)));
  const cx = 30, cy = 170, R = 140;
  const pt = (a) => [cx + R * Math.cos(-a), cy + R * Math.sin(-a)];
  const [x1, y1] = pt(a1), [x2, y2] = pt(a2);
  const deg = (a) => Math.round(a * 180 / Math.PI);
  return `<svg viewBox="0 0 360 200" role="img" aria-label="向量夹角示意">
    <defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>
    <g style="color:var(--text)"><line x1="${cx}" y1="${cy}" x2="${cx + R}" y2="${cy}" stroke="currentColor" stroke-width="3" marker-end="url(#ah)"/></g>
    <g style="color:var(--s1)"><line x1="${cx}" y1="${cy}" x2="${x1}" y2="${y1}" stroke="currentColor" stroke-width="3" marker-end="url(#ah)"/></g>
    <g style="color:var(--other)"><line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="3" marker-end="url(#ah)"/></g>
    <text x="${cx + R + 4}" y="${cy + 4}" font-size="13" fill="var(--text)">问题 q</text>
    <text x="${x1 + 6}" y="${y1}" font-size="12.5" fill="var(--text)">最像：cos ${f3(c1)}，夹角 ${deg(a1)}°</text>
    <text x="${Math.max(4, x2 - 20)}" y="${Math.max(14, y2 - 8)}" font-size="12.5" fill="var(--text-2)">最不像：cos ${f3(c2)}，夹角 ${deg(a2)}°</text>
  </svg><p class="muted" style="font-size:13px;text-align:center;margin:0">（512 维里的夹角，画在平面上示意。最不像的是：${esc(worstLabel)}）</p>`;
}

// 第 5 步：top-k
function step5() {
  body(5).innerHTML = `
    <p>把问题和全部 ${E.state.n} 块各算一次相似度（浏览器里只用了 ${Math.round(cur.tSearch)} ms），从高到低排好，取最前面的 <b>k</b> 块。拖动滑块改 k：</p>
    <div class="slider"><label for="kRange">k =</label><input type="range" id="kRange" min="1" max="20" value="${settings.k}"><output id="kOut">${settings.k}</output></div>
    <div class="rows" id="topkRows"></div>
    <p>k 太小，可能漏掉有用的资料；k 太大，会混进不相干的内容，后面拼的提示词也更长、更贵。灰掉的行是相似度低于门槛 ${settings.T.toFixed(2)} 的。</p>
    <div class="analogy">去书架上抽书：抽 1 本可能不够，抽 50 本又看不完，一般抽三五本最合适。</div>`;
  const draw = () => {
    const top = topSem(settings.k);
    $('#topkRows').innerHTML = top.map((i, r) => `<div class="row${cur.sem[i] < settings.T ? ' below' : ''}" style="animation-delay:${r * 30}ms"><span class="r">${r + 1}</span><span class="t" title="${esc(label(i))}">${esc(label(i))}</span><span class="v">${f3(cur.sem[i])}</span><span class="bar"><i style="width:${Math.max(0, cur.sem[i]) * 100}%"></i></span></div>`).join('');
  };
  draw();
  $('#kRange').addEventListener('input', (e) => {
    settings.k = +e.target.value; $('#kOut').textContent = settings.k; draw();
    if ($('#map')) drawMap(); step7(); step8();
  });
}

// 第 6 步：关键词 vs 语义 vs 混合
function step6() {
  const N = E.state.bm25.N;
  const terms = cur.kwTerms.map((t) => `<span class="tok">${esc(t)}<small>出现在 ${E.df(t)} 块</small></span>`).join('');
  body(6).innerHTML = `
    <p><b>关键词检索</b>（老办法，叫 BM25）只看字面：把问题切成“相邻两个字”（英文按整词），数一数每块里出现了几次。越稀有的词（出现的块越少）分越高。你的问题被切成：</p>
    <div class="tokens">${terms || '<span class="muted">（没有可用的词）</span>'}</div>
    <div class="demo"><span class="muted" style="font-size:14px">换个例子看看：</span>
      <button type="button" class="chip" data-q="${esc(DEMO_SEM)}">语义赢：${esc(DEMO_SEM)}</button>
      <button type="button" class="chip" data-q="${esc(DEMO_KW)}">关键词赢：${esc(DEMO_KW)}</button></div>
    <div class="cols">
      <div class="col"><h4>关键词检索（看字面）</h4><div class="rows" id="kwRows"></div></div>
      <div class="col"><h4>语义检索（看意思）</h4><div class="rows" id="semRows"></div></div>
    </div>
    <p>绿框 = 两边都找到了。<b>语义检索</b>懂同义词：“盗刷”和“欺诈”、“偷偷刷钱”和“异常交易”，字不同，意思近，它也能找到；关键词检索只能找到字面一模一样的。反过来，<b>关键词检索</b>对生僻的专有名词更准：问“YOLOv8”，语义模型不太认识这个词，会找来一些“差不多”的目标检测案例；关键词检索则能直接揪出正好写了 YOLOv8 的那几块。</p>
    <h4 style="margin:14px 0 4px">混合检索：两张名单合成一张（RRF）</h4>
    <div class="formula" style="font-size:15px">得分 = w × <span class="frac"><span>1</span><span>60 + 语义名次</span></span> + (1 − w) × <span class="frac"><span>1</span><span>60 + 关键词名次</span></span></div>
    <p>只看<b>名次</b>不看原始分数，所以两种分数尺度不同也能合并。在两张名单里都排得靠前的，合起来最高。</p>
    <div class="slider"><label for="wRange">语义权重 w =</label><input type="range" id="wRange" min="0" max="1" step="0.05" value="${settings.w}"><output id="wOut">${settings.w.toFixed(2)}</output></div>
    <div class="rows" id="hybRows"></div>
    <div class="analogy">找人时，一个朋友按“名字一字不差”帮你找，另一个按“长相气质差不多”帮你找。两人都推荐的那个，八成就是你要找的。</div>`;
  const semTop = topSem(5); const kwTop = cur.kwOrder.slice(0, 5).filter((i) => cur.kw[i] > 0);
  const semSet = new Set(semTop.map((i) => E.state.chunks[i].slug)), kwSet = new Set(kwTop.map((i) => E.state.chunks[i].slug));
  const row = (i, r, v, other) => `<div class="row${other.has(E.state.chunks[i].slug) ? ' both' : ''}"><span class="r">${r + 1}</span><span class="t" title="${esc(label(i))}">${esc(E.state.cases[E.state.chunks[i].slug].title)}<br><small>${esc(E.state.chunks[i].sec)}</small></span><span class="v">${v}</span></div>`;
  $('#kwRows').innerHTML = kwTop.length ? kwTop.map((i, r) => row(i, r, cur.kw[i].toFixed(1), semSet)).join('') : '<p class="muted">一个字都没对上，关键词检索什么也找不到。</p>';
  $('#semRows').innerHTML = semTop.map((i, r) => row(i, r, f3(cur.sem[i]), kwSet)).join('');
  const drawHyb = () => {
    const fused = E.rrf(cur.semOrder, cur.kwOrder, cur.kw, settings.w).slice(0, 5);
    const semRank = new Map(cur.semOrder.map((i, r) => [i, r + 1])); const kwRank = new Map(); let r = 0;
    for (const i of cur.kwOrder) { if (cur.kw[i] <= 0) break; kwRank.set(i, ++r); }
    $('#hybRows').innerHTML = fused.map(([i, s], r) => `<div class="row"><span class="r">${r + 1}</span><span class="t" title="${esc(label(i))}">${esc(E.state.cases[E.state.chunks[i].slug].title)}<br><small>${esc(E.state.chunks[i].sec)} · 语义第 ${semRank.get(i)} 名 · 关键词${kwRank.has(i) ? `第 ${kwRank.get(i)} 名` : '没对上'}</small></span><span class="v">${(s * 1000).toFixed(2)}‰</span></div>`).join('');
  };
  drawHyb();
  $('#wRange').addEventListener('input', (e) => { settings.w = +e.target.value; $('#wOut').textContent = settings.w.toFixed(2); drawHyb(); step7(); step8(); });
  body(6).querySelectorAll('.demo [data-q]').forEach((b) => b.addEventListener('click', () => runQuery(b.dataset.q)));
}

// 第 7 步：增强（拼提示词）
function retrieved() { return E.rrf(cur.semOrder, cur.kwOrder, cur.kw, settings.w).slice(0, settings.k).map(([i]) => i); }
const SYS = '你是“Kaggle 案例库”的助教，回答对象是零基础的中学生。\n只根据下面【资料】里的内容回答，用简单的话说。\n每句话后面用 [编号] 标出它来自哪条资料。\n如果资料里没有答案，就直接说“资料里没有找到”，不要自己编。';
function buildPrompt(ids) {
  const ctx = ids.map((i, n) => { const ch = E.state.chunks[i]; return `[${n + 1}] 《${E.state.cases[ch.slug].title}》· ${ch.sec}\n${ch.t}`; }).join('\n\n');
  return { sys: SYS, ctx, q: cur.q, full: `【系统说明】\n${SYS}\n\n【资料】\n${ctx}\n\n【问题】\n${cur.q}` };
}
function step7() {
  const ids = retrieved(); const p = buildPrompt(ids);
  const ntok = E.state.tokenizer.encode(p.full).length;
  body(7).innerHTML = `
    <p>检索只是“找资料”。RAG 的 <b>A</b>（Augment，增强）就是把找到的资料<b>塞进给大模型的提示词里</b>。下面就是这次真的会发出去的提示词：系统说明 + 带编号的 ${ids.length} 条资料（第 6 步混合检索的前 k 块，k = ${settings.k}）+ 你的问题。</p>
    <pre class="prompt"><span class="p-sys">【系统说明】\n${esc(p.sys)}</span>\n\n<span class="p-ctx">【资料】\n${esc(p.ctx)}</span>\n\n<span class="p-q">【问题】\n${esc(p.q)}</span></pre>
    <div class="kv"><span>总长 <b>${p.full.length}</b> 字</span><span>约 <b>${ntok}</b> 个 token</span><span>（用本页模型的分词器数的；不同的大模型数法略有不同，中文大约 1 个字 ≈ 1 个 token）</span></div>
    <div class="btns"><button type="button" class="btn" id="copyPrompt">复制提示词</button></div>
    <div class="analogy">开卷考试：老师允许你带几页笔记进考场。笔记就是“资料”，带哪几页是检索决定的，带对了才答得好。</div>`;
  $('#copyPrompt').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(p.full); $('#copyPrompt').textContent = '已复制'; } catch { $('#copyPrompt').textContent = '复制失败，请手动选中'; }
  });
}

// 第 8 步：生成（抽取式）
let genId = 0;
async function step8() {
  const my = ++genId;
  const maxCos = cur.sem[cur.semOrder[0]];
  const off = isOffTopic(maxCos);
  body(8).innerHTML = `
    <p>真正的 RAG 系统，到这一步会把第 7 步的提示词发给一个<b>大语言模型</b>（比如 ChatGPT、DeepSeek、Claude），让它读完资料、用自己的话写答案。这个页面不联网、不用大模型，所以我们用一种简单办法代替：<b>从找到的资料里挑出最贴近问题的几句话</b>，拼成答案，并标出出处（这叫“抽取式”回答）。</p>
    <div class="slider"><label for="tRange">相似度门槛 =</label><input type="range" id="tRange" min="0.40" max="0.70" step="0.01" value="${settings.T}"><output id="tOut">${settings.T.toFixed(2)}</output></div>
    <p class="muted" style="font-size:14px">这次最高相似度是 <b>${f3(maxCos)}</b>${cur.rare.length ? `；问题里的专有名词 ${cur.rare.map(esc).join('、')} 在库里能精确找到` : ''}。最高相似度低于门槛、又没有专有名词对上，就判定“没找到”。</p>
    <div id="ans" class="answer">${off ? '' : '正在从资料里挑句子……'}</div>
    <div class="demo"><span class="muted" style="font-size:14px">看看失败的情况：</span><button type="button" class="chip" data-q="${esc(DEMO_OFF)}">${esc(DEMO_OFF)}</button><button type="button" class="chip" data-q="${esc(DEFAULT_Q)}">回到：${esc(DEFAULT_Q)}</button></div>
    <p><b>为什么“先检索再生成”能减少胡编（幻觉）？</b>大模型只靠记忆答题时，记不清就容易一本正经地编。RAG 让它“看着资料答”，每句话都要标出处，资料里没有的就说没有——你也能点开出处自己核对。</p>
    <div class="analogy">闭卷考试记不清时容易瞎写；开卷考试能翻书，还要写清“答案在课本第几页”，老师一查就知道对不对。</div>`;
  $('#tRange').addEventListener('input', (e) => { settings.T = +e.target.value; $('#tOut').textContent = settings.T.toFixed(2); clearTimeout(step8.t); step8.t = setTimeout(() => { step8(); step5(); renderSearch(); }, 250); });
  body(8).querySelectorAll('.demo [data-q]').forEach((b) => b.addEventListener('click', () => runQuery(b.dataset.q)));
  const ans = $('#ans');
  if (off) {
    ans.classList.add('nores');
    ans.innerHTML = `<b>没有找到相关案例。</b><br>最像的一块相似度只有 ${f3(maxCos)}，低于门槛 ${settings.T.toFixed(2)}。案例库里讲的都是数据和模型，这个问题可能不在它的范围里。<br><span class="muted">如果硬要回答，大模型就只能靠“记忆”瞎猜——这正是 RAG 要设门槛的原因：宁可说不知道，也不乱编。（最像的那块其实是：${esc(label(cur.semOrder[0]))}，看看是不是不沾边？）</span>`;
    return;
  }
  const ids = retrieved().slice(0, 4);
  const sents = []; const seenS = new Set();
  ids.forEach((i, n) => {
    E.state.chunks[i].t.split(/(?<=[。！？!?])|\n/).map((s) => s.trim()).filter((s) => s.length >= 10 && s.length <= 140 && !/^[？?]/.test(s) && !/^操作[:：]/.test(s))
      .forEach((s) => { if (seenS.has(s)) return; seenS.add(s); sents.push({ s, n: n + 1, i }); });   // 重叠部分的句子只算一次
  });
  const vecs = await E.embedMany(sents.map((x) => x.s));
  if (my !== genId) return;
  sents.forEach((x, k) => { x.score = E.dot(vecs[k], cur.qv); });
  const pick = []; const per = {};
  for (const x of [...sents].sort((a, b) => b.score - a.score)) {
    if ((per[x.n] || 0) >= 2) continue;
    pick.push(x); per[x.n] = (per[x.n] || 0) + 1; if (pick.length >= 3) break;
  }
  pick.sort((a, b) => a.n - b.n);
  const slugs = [...new Set(ids.map((i) => E.state.chunks[i].slug))];
  ans.classList.add('okres');
  ans.innerHTML = `<p style="margin:0 0 6px"><b>根据检索到的资料：</b></p>
    <p style="margin:0">${pick.map((x) => `${esc(x.s)}<span class="cite">[${x.n}]</span>`).join(' ')}</p>
    <p style="margin:10px 0 2px"><b>推荐你看这些案例：</b></p>
    <ol class="refs">${slugs.map((s) => `<li><a href="${esc(E.state.cases[s].page)}" target="_blank" rel="noopener">${esc(E.state.cases[s].title)}</a></li>`).join('')}</ol>
    <p class="muted" style="font-size:13px;margin:8px 0 0">出处：${ids.map((i, n) => `[${n + 1}] ${esc(label(i))}`).join('；')}<br>（每句话是从资料原文里挑出来的，按和问题的相似度排序取前 3 句、每条资料最多 2 句。真正的大模型会把它们改写得更通顺。）</p>`;
}

// ---------------- 小工具：悬停提示 ----------------
const tip = $('#tip');
function showTip(x, y, text) { tip.hidden = false; tip.textContent = text; tip.style.whiteSpace = 'pre-line'; const w = tip.offsetWidth; tip.style.left = `${Math.min(innerWidth - w - 8, x + 12)}px`; tip.style.top = `${y + 14}px`; }
function hideTip() { tip.hidden = true; }
function bindTips(root) {
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('mousemove', (e) => showTip(e.clientX, e.clientY, el.dataset.tip));
    el.addEventListener('mouseleave', hideTip);
  });
}

let rzT = 0;
window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => { if (cur && mode === 'how') drawMap(); }, 150); });
