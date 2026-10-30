#!/usr/bin/env python3
"""Lädt die Cover aller Bücher aus data.js von Open Library nach covers/.

Danach funktionieren die Cover auch offline und in Umgebungen, die keine
externen Bilder erlauben. Aufruf aus dem Projektordner:

    python3 scripts/fetch_covers.py

Pillow (pip install pillow) ist optional: damit werden die Bilder auf 240 px
Breite verkleinert, ohne bleiben sie in Originalgröße.
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COVERS = ROOT / "covers"
UA = {"User-Agent": "Buecherkarte/1.0 (cover fetch script)"}


def slug(s: str) -> str:
    # muss slug() in app.js entsprechen
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("Ä", "ae"), ("Ö", "oe"), ("Ü", "ue")):
        s = s.replace(a, b)
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").replace("ß", "ss")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def books():
    text = (ROOT / "data.js").read_text(encoding="utf-8")
    row = re.compile(r"\[\s*'((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)',\s*-?\d+,")
    seen = set()
    for title, author in row.findall(text):
        bid = slug(title)
        while bid in seen:
            bid += "-2"
        seen.add(bid)
        yield bid, title, author


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return json.load(r)


def cover_id(title, author):
    base = "https://openlibrary.org/search.json?limit=1&fields=cover_i&"
    for q in ({"title": title, "author": author}, {"q": f"{title} {author}"}):
        docs = get_json(base + urllib.parse.urlencode(q)).get("docs") or []
        if docs and docs[0].get("cover_i"):
            return docs[0]["cover_i"]
    return None


def save(data: bytes, path: Path):
    try:
        from io import BytesIO
        from PIL import Image
        img = Image.open(BytesIO(data)).convert("RGB")
        if img.width > 240:
            img = img.resize((240, round(img.height * 240 / img.width)), Image.LANCZOS)
        img.save(path, "JPEG", quality=82, optimize=True)
    except ImportError:
        path.write_bytes(data)


def main():
    COVERS.mkdir(exist_ok=True)
    manifest = {}
    missing = []
    for bid, title, author in books():
        path = COVERS / f"{bid}.jpg"
        if path.exists():
            manifest[bid] = f"covers/{bid}.jpg"
            continue
        try:
            cid = cover_id(title, author)
            if not cid:
                missing.append(title)
                continue
            url = f"https://covers.openlibrary.org/b/id/{cid}-M.jpg"
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                save(r.read(), path)
            manifest[bid] = f"covers/{bid}.jpg"
            print(f"✓ {title}")
        except Exception as e:  # Netzfehler: weitermachen, später erneut versuchen
            missing.append(title)
            print(f"✗ {title}: {e}", file=sys.stderr)
        time.sleep(0.4)
    (COVERS / "manifest.js").write_text(
        "// Erzeugt von scripts/fetch_covers.py: Buch-ID → lokale Cover-Datei.\n"
        "window.BOOK_COVERS = " + json.dumps(manifest, ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8",
    )
    print(f"\n{len(manifest)} Cover gespeichert, {len(missing)} ohne Cover.")
    if missing:
        print("Ohne Cover: " + ", ".join(missing))


if __name__ == "__main__":
    main()
