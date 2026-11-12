# 案例语义搜索：在浏览器里看懂 RAG

这是一个**完全离线、在浏览器里运行**的 RAG（检索增强生成）/ 向量检索教学演示。
资料库是 [Kaggle 案例库](https://shuyaogao.github.io/kaggle-case-library/) 里的 255 个案例和它们的大白话讲稿。

页面有两个模式：

- **搜案例**：用一句大白话提问，比如“怎么用机器学习发现信用卡盗刷”“有没有听声音识别的例子”，
  马上找到最相关的案例。每个结果会告诉你“为什么匹配”（讲稿里最相关的那一段），并给出
  打开案例、Kaggle 原 notebook、Word 讲稿三个链接。可以按大类（机器学习/深度学习/……）和领域筛选。
- **看原理**：把刚才那次搜索拆成 8 步，用**你的问题和真实数据**一步一步演示：
  切块 → 分词和向量 → 向量地图 → 余弦相似度 → 取前 k 块 → 和关键词检索（BM25）对照、混合（RRF）
  → 拼出给大模型的提示词 → 抽取式回答（含“没找到”的失败案例）。每一步都有一个生活中的比方。

不需要 API key，不用任何付费服务，不上传任何内容。模型、推理引擎、数据全部放在这个仓库里，
没有任何 CDN 依赖，所以断网也能用。

## 在自己电脑上运行

**双击 `start.bat`**。它会启动一个本地小服务器并自动打开浏览器（默认 http://localhost:8765/，端口被占用时自动换下一个）。用完关掉黑色窗口即可。

> 为什么不能直接双击 `index.html`？浏览器出于安全考虑，不允许 `file://` 打开的网页读取本地文件（模型和数据），
> 所以必须通过一个本地服务器打开。

没有 `start.bat` 的系统（Mac/Linux）：

```bash
cd case-rag-search
python3 -m http.server 8765
# 然后浏览器打开 http://localhost:8765/
```

第一次打开要加载约 55 MB（向量模型 24 MB + 推理引擎 21 MB + 案例数据 9 MB），页面顶部有进度条。
之后浏览器会缓存。需要较新的浏览器（Edge / Chrome / Firefox / Safari 近两年的版本）。

## 它是怎么工作的

```
离线（Python，在电脑上做一次）                 在线（浏览器里，每次提问）
────────────────────────────                 ─────────────────────────────
meta/*.json + scripts/*.md                    你的问题
  │ build/build_corpus.py 切块                  │ transformers.js 分词 + bge-small-zh（ONNX）
  ▼                                            ▼
data/chunks.json（6445 块）                   512 维向量（CLS 池化 + 归一化）
  │ build/embed.py（onnxruntime，同一个 ONNX）  │ 和 6445 块逐个点积 = 余弦相似度
  ▼                                            │ + BM25 关键词检索 → RRF 混合
data/vectors.i8.bin（int8，每行一个缩放系数）  ▼
data/pca.json（二维地图坐标 + 投影矩阵）      前 k 块 → 提示词 → 抽取式答案
```

- **切块**：每个案例 1 个“案例卡片”块（标题、简介、领域、类别、方法、数据、任务），
  讲稿里每个 `## ` 小节（一分钟看懂、数据、每一章、每个实验、结果、讨论）各 1 块。
  超过 260 字的小节按句子切开，相邻两块重叠约 60 字。每块都记着案例 slug、小节名、
  案例页链接（带锚点）和 Word 讲稿文件名。
- **向量**：模型 `Xenova/bge-small-zh-v1.5` 的量化版 `onnx/model_quantized.onnx`。
  送进模型的文本是 `案例标题 · 小节名\n正文`。取 [CLS] 位置的输出，再做 L2 归一化。
  Python 和浏览器用的是**同一个 ONNX 文件、同一个 tokenizer.json、同一种池化和归一化**。
  离线计算时一条一条地算（不分批），因为量化模型的激活缩放系数按整批数据估计，分批会带来细小偏差。
- **一致性自检**：打开 `tests/consistency.html`，浏览器会重新计算 6 句测试文本和 5 个语料块的向量，
  和 Python 算的结果比余弦（要求 > 0.99），并核对 token id 是否一模一样。
- **关键词检索**：浏览器现场建 BM25 索引（中文按相邻两个字切，英文按整词，k1=1.2，b=0.75）。
- **混合**：RRF，得分 = w/(60+语义名次) + (1−w)/(60+关键词名次)，搜索模式默认 w = 0.5。
- **“没找到”**：最高余弦相似度低于门槛（默认 0.55），且问题里没有能在库里精确找到的英文专有名词（如 YOLOv8、XGBoost），
  就回答“没有找到相关案例”。门槛可以在「看原理」第 8 步调。
- **生成**：本页不调用大模型。第 8 步从检索到的前 4 块里切出句子，用同一个模型给每句打分，
  挑最贴近问题的 3 句拼成答案并标 [1][2] 出处。真实的 RAG 会把第 7 步的提示词发给大模型。

## 案例库更新后，重建索引

```bash
# 1. 准备环境（只要一次；不需要 PyTorch）
python -m venv venv
venv\Scripts\pip install -r build/requirements.txt      # Mac/Linux: venv/bin/pip

# 2. 重新切块（默认读 D:/教材/Kaggle_Cases，可用 --src 指定）
python build/build_corpus.py --src D:/教材/Kaggle_Cases

# 3. 重新算向量、地图坐标和自检数据
venv\Scripts\python build/embed.py
```

然后用 `start.bat` 打开 `tests/consistency.html` 确认“通过”，再看一眼主页面即可。

## 文件

```
index.html  style.css  favicon.svg   页面
js/engine.js                         加载、向量、语义检索、BM25、RRF
js/app.js                            界面：搜案例 + 看原理 8 步
data/chunks.json                     6445 个文本块 + 255 个案例的信息
data/vectors.i8.bin, vectors.json    块向量（int8）和缩放系数
data/pca.json                        二维地图坐标和投影矩阵
data/selftest.json                   Python 算的测试向量（自检用）
models/Xenova/bge-small-zh-v1.5/     向量模型（量化 ONNX + 分词器）
vendor/transformers/                 Transformers.js 和 onnxruntime-web 的 wasm
build/                               build_corpus.py、embed.py、serve.py、requirements.txt
tests/consistency.html               浏览器 vs Python 向量一致性自检
start.bat                            本地一键启动
```

## 版本和许可

| 组件 | 版本 | 许可 |
|---|---|---|
| 本项目代码 | — | MIT（见 `LICENSE`） |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js)（Transformers.js） | 3.8.1 | Apache-2.0（`vendor/transformers/LICENSE`） |
| onnxruntime-web（随 Transformers.js 3.8.1 打包的 wasm） | 1.22.0-dev.20250409-89f8206ba4 | MIT（`vendor/transformers/LICENSE.onnxruntime-web`） |
| 模型 [BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)，ONNX 版 [Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5) | revision 75c43b0 | MIT |
| 离线构建：onnxruntime / tokenizers / numpy | 1.31.1 / 0.23.3 / 2.5.4 | MIT / Apache-2.0 / BSD |

案例内容来自 [Kaggle 案例库](https://shuyaogao.github.io/kaggle-case-library/)
（[总览](https://shuyaogao.github.io/kaggle-case-library/showcase.html) ·
[学习路线](https://shuyaogao.github.io/kaggle-case-library/routes.html)），
每个案例都链接到 Kaggle 上的原 notebook，原 notebook 的版权归各自作者。
