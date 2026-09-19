#!/usr/bin/env python3
"""business-english-500.md から words-data.js を生成する。

単語リストを直したら `python3 build-data.py` を実行して再生成する。
"""

import io
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "business-english-500.md"
TARGET = HERE / "words-data.js"

# 表示が長くなりすぎる見出しは短くする。
TITLE_OVERRIDES = {"連絡・伝達（メール／口頭／チャット共通）": "連絡・伝達"}


def parse(text):
    categories = []
    words = []
    current = None
    for line in text.split("\n"):
        heading = re.match(r"^## (\d+)\.\s*(.+?)\s*$", line)
        if heading:
            title = re.sub(r"（\d+[–\-]\d+）\s*$", "", heading.group(2)).strip()
            current = {"id": int(heading.group(1)), "title": TITLE_OVERRIDES.get(title, title)}
            categories.append(current)
            continue
        row = re.match(r"^\|\s*(\d+)\s*\|(.+)\|\s*$", line)
        if not row or current is None:
            continue
        cells = [cell.strip() for cell in row.group(2).split("|")]
        english, japanese, example = cells[0], cells[1], cells[2]
        split = re.match(r"^(.*?)（(.+)）\s*$", example)
        if not split:
            raise SystemExit(f"例文の形式が想定外です: {example}")
        words.append({
            "n": int(row.group(1)),
            "en": english,
            "ja": japanese,
            "ex": split.group(1).strip(),
            "exJa": split.group(2).strip(),
            "cat": current["id"],
        })
    for category in categories:
        category["count"] = sum(1 for w in words if w["cat"] == category["id"])
    return categories, words


def main():
    categories, words = parse(SOURCE.read_text(encoding="utf-8"))
    if [w["n"] for w in words] != list(range(1, len(words) + 1)):
        raise SystemExit("単語番号が連番になっていません")
    out = io.StringIO()
    out.write(f"// Auto-generated from {SOURCE.name} by build-data.py — do not edit by hand.\n")
    out.write("const CATEGORIES = " + json.dumps(categories, ensure_ascii=False, indent=2) + ";\n\n")
    out.write("const WORDS = [\n")
    for word in words:
        out.write("  " + json.dumps(word, ensure_ascii=False) + ",\n")
    out.write("];\n")
    TARGET.write_text(out.getvalue(), encoding="utf-8")
    print(f"{len(words)}語 / {len(categories)}カテゴリ を {TARGET.name} に書き出しました")


if __name__ == "__main__":
    main()
