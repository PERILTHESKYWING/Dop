"""Writing KataGo .cfg files: copy an example config and replace or add keys.

KataGo configs are `key = value  # comment` lines. Rather than keeping our own copies of KataGo's
long configs, we start from the ones shipped with the matching release and override what we need.
"""

from __future__ import annotations

import re
from pathlib import Path

_KEY = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=")


def with_overrides(text: str, overrides: dict[str, object], drop: tuple[str, ...] = ()) -> str:
    """Return `text` with each key in `overrides` set to its value.

    Existing lines for a key are replaced (the first) or removed (any repeats); keys that are not
    present are appended at the end. Keys in `drop` are removed entirely.
    """
    values = {k: _fmt(v) for k, v in overrides.items()}
    seen: set[str] = set()
    out: list[str] = []
    for line in text.splitlines():
        m = _KEY.match(line)
        if m:
            key = m.group(1)
            if key in drop:
                continue
            if key in values:
                if key in seen:
                    continue
                seen.add(key)
                out.append(f"{key} = {values[key]}")
                continue
        out.append(line)
    extra = [k for k in values if k not in seen]
    if extra:
        out.append("")
        out.append("# Added by Dop Trainer")
        out.extend(f"{k} = {values[k]}" for k in extra)
    return "\n".join(out) + "\n"


def write_cfg(src: Path, dst: Path, overrides: dict[str, object], drop: tuple[str, ...] = ()) -> Path:
    text = src.read_text(encoding="utf-8")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(with_overrides(text, overrides, drop), encoding="utf-8")
    return dst


def _fmt(v: object) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (list, tuple)):
        return ",".join(_fmt(x) for x in v)
    return str(v)
