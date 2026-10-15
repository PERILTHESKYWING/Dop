"""Small shared helpers: logging, jsonl(.gz) files, atomic writes, sizes."""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import time
from pathlib import Path
from typing import Iterable, Iterator


def log(*a) -> None:
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def _open(path: Path, mode: str):
    path = Path(path)
    if path.suffix == '.gz':
        return gzip.open(path, mode + 't', encoding='utf-8')
    return open(path, mode, encoding='utf-8')


def read_jsonl(path: Path) -> Iterator[dict]:
    """Rows of a .jsonl or .jsonl.gz file (concatenated gzip members are fine). Bad lines are skipped."""
    path = Path(path)
    if not path.exists():
        return
    with _open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def write_jsonl(path: Path, rows: Iterable[dict]) -> int:
    """Write rows atomically (temp file, then rename). Returns the row count."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    n = 0
    if path.suffix == '.gz':
        f = gzip.open(tmp, 'wt', encoding='utf-8')
    else:
        f = open(tmp, 'w', encoding='utf-8')
    with f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')
            n += 1
    os.replace(tmp, path)
    return n


def append_jsonl(path: Path, rows: Iterable[dict]) -> int:
    """Append rows. For .gz this adds a new gzip member, which readers handle."""
    rows = list(rows)
    if not rows:
        return 0
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with _open(path, 'a') as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, separators=(',', ':')) + '\n')
    return len(rows)


def read_json(path: Path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError):
        return default


def write_json(path: Path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding='utf-8')
    os.replace(tmp, path)


def text_key(*parts: str) -> str:
    """Stable id for deduping: whitespace-normalised, case-kept."""
    h = hashlib.sha1()
    for p in parts:
        h.update(' '.join(str(p).split()).encode('utf-8'))
        h.update(b'\x1f')
    return h.hexdigest()[:20]


def dir_size(path: Path) -> int:
    path = Path(path)
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    total = 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
    return total


def remove(path: Path) -> None:
    path = Path(path)
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    elif path.exists():
        path.unlink()


def copy_dir(src: Path, dst: Path) -> None:
    """Replace dst with a copy of src (via a temp dir, so a crash never leaves half a copy)."""
    src, dst = Path(src), Path(dst)
    tmp = dst.with_name(dst.name + '.tmp')
    remove(tmp)
    shutil.copytree(src, tmp)
    remove(dst)
    os.replace(tmp, dst)
