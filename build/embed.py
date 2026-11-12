"""离线给每个块算向量（不用 PyTorch，只用 onnxruntime + tokenizers）。

用法（在项目根目录）：
    pip install -r build/requirements.txt
    python build/embed.py

用的是浏览器里同一个 ONNX 文件：models/Xenova/bge-small-zh-v1.5/onnx/model_quantized.onnx
池化方式：取 [CLS] 位置的向量（bge 官方做法），再做 L2 归一化（长度变成 1）。
浏览器端 transformers.js 用 {pooling: 'cls', normalize: true}，两边一致。

输出：
  data/vectors.i8.bin   每个块 512 维，int8 量化（每行一个缩放系数）
  data/vectors.json     维度、条数、缩放系数、模型信息
  data/pca.json         所有块投到二维平面的坐标 + 投影矩阵（浏览器把问题也投上去）
  data/selftest.json    几句测试文本在 Python 里的向量，用来核对浏览器算得一不一样
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

ROOT = Path(__file__).resolve().parent.parent
MODEL_DIR = ROOT / "models" / "Xenova" / "bge-small-zh-v1.5"
ONNX = MODEL_DIR / "onnx" / "model_quantized.onnx"
MAX_LEN = 512
BATCH = 32

SELFTEST = [
    "怎么用机器学习发现信用卡盗刷",
    "有没有听声音识别的例子",
    "强化学习玩游戏",
    "今天天气怎么样",
    "YOLOv8 目标检测",
    "用 CNN 识别手写数字，准确率能到多少？",
]


class Embedder:
    def __init__(self):
        self.tok = Tokenizer.from_file(str(MODEL_DIR / "tokenizer.json"))
        self.tok.enable_truncation(MAX_LEN)
        so = ort.SessionOptions()
        so.log_severity_level = 3
        self.sess = ort.InferenceSession(str(ONNX), so, providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.sess.get_inputs()}

    def encode(self, texts: list[str]) -> np.ndarray:
        encs = self.tok.encode_batch(texts)
        L = max(len(e.ids) for e in encs)
        ids = np.zeros((len(encs), L), dtype=np.int64)
        mask = np.zeros_like(ids)
        for i, e in enumerate(encs):
            ids[i, : len(e.ids)] = e.ids
            mask[i, : len(e.ids)] = 1
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.inputs:
            feed["token_type_ids"] = np.zeros_like(ids)
        out = self.sess.run(None, feed)[0]           # [B, L, 512] last_hidden_state
        cls = out[:, 0, :].astype(np.float32)        # CLS 池化
        cls /= np.linalg.norm(cls, axis=1, keepdims=True) + 1e-12   # L2 归一化
        return cls


def embed_text(case_title: str, sec: str, body: str) -> str:
    return f"{case_title} · {sec}\n{body}"


def main() -> int:
    data = json.loads((ROOT / "data" / "chunks.json").read_text(encoding="utf-8"))
    cases, chunks = data["cases"], data["chunks"]
    texts = [embed_text(cases[c["slug"]]["title"], c["sec"], c["t"]) for c in chunks]
    emb = Embedder()

    # 注意：一条一条地算，不要分批。
    # 量化模型会按“整批数据”动态估计缩放系数，分批（尤其是补零）会让结果和浏览器里单条计算略有偏差。
    vecs = np.zeros((len(texts), 512), dtype=np.float32)
    t0 = time.time()
    for i, t in enumerate(texts):
        vecs[i] = emb.encode([t])[0]
        if i % 500 == 0:
            print(f"  {i + 1}/{len(texts)}  {time.time() - t0:.0f}s", flush=True)
    print(f"向量计算完成：{len(texts)} 条，用时 {time.time() - t0:.0f}s")

    # int8 量化：每行一个缩放系数
    scale = np.abs(vecs).max(axis=1) / 127.0
    q = np.clip(np.round(vecs / scale[:, None]), -127, 127).astype(np.int8)
    deq = q.astype(np.float32) * scale[:, None]
    deq /= np.linalg.norm(deq, axis=1, keepdims=True)
    err = float((deq * vecs).sum(axis=1).min())
    print(f"int8 量化后与原向量的最小余弦：{err:.5f}")
    (ROOT / "data" / "vectors.i8.bin").write_bytes(q.tobytes())
    meta = {
        "n": int(len(texts)), "dim": 512, "dtype": "int8", "layout": "row-major",
        "scales": [float(f"{x:.6g}") for x in scale],
        "model": "Xenova/bge-small-zh-v1.5", "onnx": "onnx/model_quantized.onnx",
        "pooling": "cls", "normalize": True, "max_len": MAX_LEN,
        "text_template": "{案例标题} · {小节名}\\n{正文}",
        "quant_min_cos": err,
    }
    (ROOT / "data" / "vectors.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    # PCA 到二维
    mean = vecs.mean(axis=0)
    X = vecs - mean
    _, _, vt = np.linalg.svd(X, full_matrices=False)
    comps = vt[:2]
    xy = X @ comps.T
    var = (xy.var(axis=0) / X.var(axis=0).sum()).tolist()
    pca = {
        "mean": [round(float(x), 6) for x in mean],
        "comps": [[round(float(x), 6) for x in r] for r in comps],
        "xy": [[round(float(a), 4), round(float(b), 4)] for a, b in xy],
        "explained": var,
    }
    (ROOT / "data" / "pca.json").write_text(json.dumps(pca, separators=(",", ":")), encoding="utf-8")

    # 自检用：Python 算出的测试句向量 + token ids
    st = []
    for t in SELFTEST:
        v = emb.encode([t])[0]
        st.append({"text": t, "ids": emb.tok.encode(t).ids, "vec": [round(float(x), 7) for x in v]})
    (ROOT / "data" / "selftest.json").write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    print("已写出 data/vectors.i8.bin, vectors.json, pca.json, selftest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
