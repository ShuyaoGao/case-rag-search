// 检索引擎：加载数据和模型、算向量、语义检索、关键词检索（BM25）、混合（RRF）。
// 全部在浏览器里跑，不联网。
import { env, pipeline } from '../vendor/transformers/transformers.min.js';

const BASE = new URL('../', import.meta.url).href;
export const MODEL_ID = 'Xenova/bge-small-zh-v1.5';
export const SITE = 'https://shuyaogao.github.io/kaggle-case-library/';

// ---- 只用本地文件：不从 Hugging Face 下载模型，也不从 CDN 下载推理引擎 ----
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = BASE + 'models/';
env.useBrowserCache = false;
env.backends.onnx.wasm.wasmPaths = BASE + 'vendor/transformers/';
env.backends.onnx.wasm.numThreads = 1;

export const state = {
  cases: null, chunks: null, dim: 512, n: 0,
  vecs: null,         // Float32Array n*dim，已归一化
  pca: null,          // {mean, comps, xy, explained}
  extractor: null, tokenizer: null,
  bm25: null,
};

async function fetchWithProgress(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败：${url}（${res.status}）`);
  const total = +res.headers.get('content-length') || 0;
  if (!res.body || !onBytes) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const parts = []; let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); got += value.length; onBytes(got, total);
  }
  const out = new Uint8Array(got); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const dec = new TextDecoder();
const json = (u8) => JSON.parse(dec.decode(u8));

/** 加载全部东西。onProgress(stage, fraction, text) */
export async function loadAll(onProgress) {
  const files = [
    ['chunks', 'data/chunks.json', 5.8e6],
    ['meta', 'data/vectors.json', 0.1e6],
    ['vecs', 'data/vectors.i8.bin', 3.3e6],
    ['pca', 'data/pca.json', 0.2e6],
  ];
  const totalGuess = files.reduce((a, f) => a + f[2], 0);
  const got = {}; const raw = {};
  const report = () => {
    const s = Object.values(got).reduce((a, b) => a + b, 0);
    onProgress?.('data', Math.min(1, s / totalGuess), `案例数据 ${(s / 1e6).toFixed(1)} / ≈${(totalGuess / 1e6).toFixed(0)} MB`);
  };
  await Promise.all(files.map(async ([k, path]) => {
    raw[k] = await fetchWithProgress(BASE + path, (g) => { got[k] = g; report(); });
  }));
  const cj = json(raw.chunks);
  state.cases = cj.cases; state.chunks = cj.chunks; state.site = cj.site || SITE;
  const meta = json(raw.meta);
  state.n = meta.n; state.dim = meta.dim; state.vecMeta = meta;
  const q = new Int8Array(raw.vecs.buffer, raw.vecs.byteOffset, meta.n * meta.dim);
  const v = new Float32Array(meta.n * meta.dim);
  for (let i = 0; i < meta.n; i++) {
    const s = meta.scales[i]; let nn = 0; const o = i * meta.dim;
    for (let j = 0; j < meta.dim; j++) { const x = q[o + j] * s; v[o + j] = x; nn += x * x; }
    nn = 1 / Math.sqrt(nn);
    for (let j = 0; j < meta.dim; j++) v[o + j] *= nn;
  }
  state.vecs = v;
  state.pca = json(raw.pca);
  buildBM25();

  // ---- 模型 ----
  const fileProg = {};
  state.extractor = await pipeline('feature-extraction', MODEL_ID, {
    dtype: 'q8', device: 'wasm',
    progress_callback: (p) => {
      if (p.status === 'progress' && p.total) {
        fileProg[p.file] = [p.loaded, p.total];
        const L = Object.values(fileProg).reduce((a, b) => a + b[0], 0);
        const T = Object.values(fileProg).reduce((a, b) => a + b[1], 0);
        onProgress?.('model', L / T, `向量模型 ${(L / 1e6).toFixed(1)} / ${(T / 1e6).toFixed(1)} MB`);
      } else if (p.status === 'done' && /onnx/.test(p.file || '')) {
        onProgress?.('engine', 1, '正在启动推理引擎（约 21 MB）…');
      }
    },
  });
  state.tokenizer = state.extractor.tokenizer;
  // 预热一次
  await embed('你好');
  onProgress?.('ready', 1, '准备好了');
}

// ---------------- 向量 ----------------
export async function embed(text) {
  const out = await state.extractor(text, { pooling: 'cls', normalize: true });
  return Float32Array.from(out.data);
}
export async function embedMany(texts) {
  if (!texts.length) return [];
  const out = await state.extractor(texts, { pooling: 'cls', normalize: true });
  const d = out.dims[1];
  return texts.map((_, i) => Float32Array.from(out.data.subarray(i * d, (i + 1) * d)));
}
export function tokenize(text) {
  const ids = state.tokenizer.encode(text);
  let toks;
  try { toks = state.tokenizer.model.convert_ids_to_tokens(ids); }
  catch { toks = ids.map((i) => state.tokenizer.decode([i])); }
  return { ids, toks };
}
export function chunkVec(i) { return state.vecs.subarray(i * state.dim, (i + 1) * state.dim); }
export function dot(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
export function norm(a) { return Math.sqrt(dot(a, a)); }

export function semanticScores(qv) {
  const { n, dim, vecs } = state; const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0; const o = i * dim;
    for (let j = 0; j < dim; j++) s += qv[j] * vecs[o + j];
    out[i] = s;
  }
  return out;
}
export function project2d(v) {
  const { mean, comps } = state.pca; let x = 0, y = 0;
  for (let j = 0; j < v.length; j++) { const c = v[j] - mean[j]; x += c * comps[0][j]; y += c * comps[1][j]; }
  return [x, y];
}

// ---------------- 关键词检索 BM25 ----------------
// 分词规则：中文按“相邻两个字”切（二元组），英文/数字按整词，小写。
const CJK = /[㐀-鿿豈-﫿]/;
export function kwTokens(text) {
  const out = [];
  const t = text.toLowerCase();
  const re = /[a-z0-9][a-z0-9.+#\-]*[a-z0-9+#]|[a-z0-9]|[㐀-鿿豈-﫿]+/g;
  let m;
  while ((m = re.exec(t))) {
    const w = m[0];
    if (CJK.test(w[0])) {
      if (w.length === 1) out.push(w);
      else for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2));
    } else out.push(w);
  }
  return out;
}
export function chunkFullText(c) { return `${state.cases[c.slug].title} · ${c.sec}\n${c.t}`; }

function buildBM25() {
  const N = state.chunks.length; const post = new Map(); const len = new Uint16Array(N); let tot = 0;
  state.chunks.forEach((c, i) => {
    const toks = kwTokens(chunkFullText(c)); len[i] = toks.length; tot += toks.length;
    const tf = new Map(); for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, f] of tf) { let p = post.get(t); if (!p) post.set(t, (p = [])); p.push(i, f); }
  });
  state.bm25 = { N, post, len, avg: tot / N, k1: 1.2, b: 0.75 };
}
export function df(term) { const p = state.bm25.post.get(term); return p ? p.length / 2 : 0; }
export function idf(term) { const N = state.bm25.N, d = df(term); return Math.log(1 + (N - d + 0.5) / (d + 0.5)); }
export function bm25Scores(query) {
  const { N, post, len, avg, k1, b } = state.bm25; const out = new Float32Array(N);
  const terms = [...new Set(kwTokens(query))];
  for (const t of terms) {
    const p = post.get(t); if (!p) continue; const w = idf(t);
    for (let k = 0; k < p.length; k += 2) {
      const i = p[k], f = p[k + 1];
      out[i] += w * (f * (k1 + 1)) / (f + k1 * (1 - b + b * len[i] / avg));
    }
  }
  return { scores: out, terms };
}

export function rankOf(scores, filterFn) {
  const idx = [];
  for (let i = 0; i < scores.length; i++) if (!filterFn || filterFn(i)) idx.push(i);
  idx.sort((a, b) => scores[b] - scores[a]);
  return idx;
}
/** RRF 融合：score = w/(K+语义名次) + (1-w)/(K+关键词名次)。关键词得分为 0 的不算名次。 */
export function rrf(semOrder, kwOrder, kwScores, w, K = 60) {
  const s = new Map();
  semOrder.forEach((i, r) => s.set(i, w / (K + r + 1)));
  let r = 0;
  for (const i of kwOrder) { if (kwScores[i] <= 0) break; s.set(i, (s.get(i) || 0) + (1 - w) / (K + r + 1)); r++; }
  return [...s.entries()].sort((a, b) => b[1] - a[1]);
}

/** 英文专有名词（模型名、库名）是否在库里精确出现：用来避免把 “YOLOv8” 这类问题误判成跑题 */
export function rareAsciiHits(query) {
  const N = state.bm25.N;
  return [...new Set(kwTokens(query))].filter((t) => /^[a-z0-9]/.test(t) && t.length >= 2 && !/^\d+$/.test(t))
    .filter((t) => { const d = df(t); return d > 0 && d < N * 0.03; });
}
