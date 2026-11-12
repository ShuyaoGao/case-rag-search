"""把 Kaggle 案例库切成检索用的小块（chunks），输出 data/chunks.json。

用法（在项目根目录）：
    python build/build_corpus.py [--src D:/教材/Kaggle_Cases]

只用 Python 标准库，不需要安装任何包。
每个案例产生：
  * 1 个“案例卡片”块：标题、简介、领域、类别、方法、数据、任务；
  * 讲稿里每个 `## ` 小节 1 个块；小节太长时按句子切开，前后块之间留一点重叠。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SRC = Path("D:/教材/Kaggle_Cases")
SITE = "https://shuyaogao.github.io/kaggle-case-library/"

MAX_CHARS = 260      # 一个块正文的最大字数（大约等于 token 数）
OVERLAP = 60         # 切开时，下一块开头重复上一块末尾的大约字数
MIN_TAIL = 40        # 最后一块太短就并回前一块

SENT_RE = re.compile(r"[^。！？!?；\n]*[。！？!?；\n]+|[^。！？!?；\n]+$")


def clean_line(line: str) -> str:
    line = line.strip()
    if line.startswith(">"):
        line = line.lstrip("> ").strip()
    line = line.replace("**", "").replace("`", "")
    return line


def split_sentences(text: str) -> list[str]:
    out = [s for s in SENT_RE.findall(text) if s.strip()]
    # 单句超长时硬切
    res = []
    for s in out:
        while len(s) > MAX_CHARS:
            res.append(s[:MAX_CHARS])
            s = s[MAX_CHARS - OVERLAP:]
        res.append(s)
    return res


def pack(text: str) -> list[tuple[str, int]]:
    """按句子装箱。返回 [(块正文, 与上一块重叠的字数)]。"""
    text = text.strip()
    if len(text) <= MAX_CHARS:
        return [(text, 0)]
    sents = split_sentences(text)
    chunks: list[tuple[str, int]] = []
    i = 0
    ov_sents: list[str] = []
    while i < len(sents):
        cur = list(ov_sents)
        ov_len = sum(len(s) for s in ov_sents)
        added = 0
        while i < len(sents) and (sum(len(s) for s in cur) + len(sents[i]) <= MAX_CHARS or added == 0):
            cur.append(sents[i])
            i += 1
            added += 1
        body = "".join(cur)
        chunks.append((body, ov_len))
        # 下一块的重叠：取本块末尾若干句，凑够约 OVERLAP 字
        ov_sents = []
        for s in reversed(cur):
            if sum(len(x) for x in ov_sents) >= OVERLAP:
                break
            if len(s) > OVERLAP * 2:
                break
            ov_sents.insert(0, s)
        if i >= len(sents):
            break
    # 末块太短就并回去
    if len(chunks) > 1:
        last, ov = chunks[-1]
        if len(last) - ov < MIN_TAIL:
            prev, pov = chunks[-2]
            chunks[-2] = (prev + last[ov:], pov)
            chunks.pop()
    return [(b.strip(), ov) for b, ov in chunks]


def section_kind(head: str) -> tuple[str, str, str]:
    """返回 (kind, 显示用的小节名, 案例页锚点)"""
    h = head.strip()
    if h.startswith("01"):
        return "intro", "一分钟看懂", "brief"
    if h.startswith("02"):
        return "data", re.sub(r"^02\s*", "", h), "data"
    if h.startswith("04"):
        return "result", re.sub(r"^04\s*", "", h), "results"
    if h.startswith("05"):
        return "discuss", re.sub(r"^05\s*", "", h), "discuss"
    if h.startswith("03"):
        if "·" not in h:
            return "skip", h, ""
        rest = h.split("·", 1)[1].strip()
        if rest.startswith("实验"):
            return "lab", rest, "lab"
        m = re.match(r"第\s*(\d+)\s*章\s*·\s*(.*)", rest)
        if m:
            return "chapter", f"第 {m.group(1)} 章 · {m.group(2).strip()}", "pipeline"
        return "chapter", rest, "pipeline"
    return "other", h, ""


def parse_script(md: str):
    parts = re.split(r"^## ", md, flags=re.M)[1:]
    for p in parts:
        lines = p.split("\n")
        head = lines[0].strip()
        body_lines = []
        for ln in lines[1:]:
            if ln.startswith("# "):
                continue
            if re.match(r"^\s*时长[:：]", ln):
                continue
            c = clean_line(ln)
            if c:
                body_lines.append(c)
        yield head, "\n".join(body_lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(DEFAULT_SRC))
    ap.add_argument("--out", default=str(ROOT / "data" / "chunks.json"))
    args = ap.parse_args()
    src = Path(args.src)
    metas = sorted((src / "meta").glob("*.json"))
    if not metas:
        print(f"找不到 {src / 'meta'}", file=sys.stderr)
        return 2

    cases = {}
    chunks = []
    n_split = 0
    for mp in metas:
        m = json.loads(mp.read_text(encoding="utf-8"))
        slug = m["slug"]
        page = f"{SITE}cases/{slug}.html"
        doc = f"{slug}_讲稿.docx"
        cases[slug] = {
            "title": m.get("title_zh", slug),
            "title_en": m.get("title_en", ""),
            "author": m.get("author", ""),
            "votes": m.get("votes", 0),
            "track": m.get("track", []),
            "group": m.get("group", ""),
            "field": m.get("field", ""),
            "domain": m.get("domain", ""),
            "data_type": m.get("data_type", ""),
            "task": m.get("task", ""),
            "level": m.get("level", ""),
            "summary": m.get("summary", ""),
            "kaggle": m.get("url", ""),
            "page": page,
            "doc": doc,
        }
        c = cases[slug]
        card = (
            f"{c['summary']}\n"
            f"领域：{c['field']}（{c['domain']}）；类别：{c['group']}；任务：{c['task']}\n"
            f"数据：{c['data_type']}，{m.get('dataset', '')}\n"
            f"方法：{'、'.join(m.get('methods', []))}"
        )
        chunks.append({"slug": slug, "sec": "案例卡片", "kind": "card", "part": 1, "parts": 1,
                       "ov": 0, "t": card, "url": page, "doc": doc})

        sp = src / "scripts" / f"{slug}.md"
        if not sp.exists():
            continue
        lab_no = 0
        for head, body in parse_script(sp.read_text(encoding="utf-8")):
            kind, label, anchor = section_kind(head)
            if kind == "skip" or not body.strip():
                continue
            if kind == "lab":
                lab_no += 1
                anchor = f"lab{lab_no}"
            pieces = pack(body)
            if len(pieces) > 1:
                n_split += 1
            for k, (txt, ov) in enumerate(pieces, 1):
                chunks.append({"slug": slug, "sec": label, "kind": kind, "part": k, "parts": len(pieces),
                               "ov": ov, "t": txt, "url": page + (f"#{anchor}" if anchor else ""), "doc": doc})

    for i, ch in enumerate(chunks):
        ch["id"] = i

    out = {
        "version": 1,
        "site": SITE,
        "params": {"max_chars": MAX_CHARS, "overlap": OVERLAP},
        "n_cases": len(cases),
        "cases": cases,
        "chunks": chunks,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    lens = sorted(len(c["t"]) for c in chunks)
    print(f"案例 {len(cases)} 个，块 {len(chunks)} 个；被切开的小节 {n_split} 个；"
          f"块长度中位数 {lens[len(lens)//2]}，最长 {lens[-1]}")
    print(f"已写出 {args.out}")
    return 0


def embed_text(case_title: str, sec: str, body: str) -> str:
    """真正送进向量模型的文本（Python 和浏览器两边必须一致）。"""
    return f"{case_title} · {sec}\n{body}"


if __name__ == "__main__":
    raise SystemExit(main())
