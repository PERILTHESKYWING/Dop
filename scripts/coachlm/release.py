"""The repository's public `coach-lm` release: download its assets, replace one with GITHUB_TOKEN.

Same pattern as scripts/student/evolve_local.py (the student network's home-GPU path).
Reading needs no token (the release is public); writing needs a token with
"Contents: read and write" on the repository.
"""
from __future__ import annotations

import json
import shutil
import urllib.error
import urllib.request
from pathlib import Path

from util import log

API = 'https://api.github.com/repos/{repo}/releases/tags/{tag}'


def request(url: str, token: str | None = None, data: bytes | None = None, method: str | None = None,
            ctype: str | None = None, accept: str = 'application/vnd.github+json', timeout: int = 600):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Accept', accept)
    req.add_header('User-Agent', 'kami-coach-trainer')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    if ctype:
        req.add_header('Content-Type', ctype)
    return urllib.request.urlopen(req, timeout=timeout)


def get_release(repo: str, tag: str, token: str | None = None) -> dict | None:
    """The release as JSON, or None when it does not exist yet."""
    try:
        with request(API.format(repo=repo, tag=tag), token) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def fetch_asset(rel: dict | None, name: str, dest: Path, token: str | None = None) -> Path | None:
    """Download one asset unless an identical-size copy is already here. None when missing."""
    if not rel:
        return None
    asset = next((a for a in rel.get('assets', []) if a['name'] == name), None)
    if not asset:
        return None
    dest = Path(dest)
    if dest.exists() and dest.stat().st_size == asset['size']:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    log(f'downloading {name} ({asset["size"] / 1e6:.1f} MB)')
    tmp = dest.with_name(dest.name + '.part')
    with request(asset['browser_download_url'], token, accept='application/octet-stream') as r, open(tmp, 'wb') as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.replace(dest)
    return dest


def upload_asset(rel: dict, path: Path, name: str, token: str) -> None:
    """Replace asset `name` with the file at `path`."""
    for a in rel.get('assets', []):
        if a['name'] == name:
            request(a['url'], token, method='DELETE').close()
    url = rel['upload_url'].split('{')[0] + f'?name={name}'
    with open(path, 'rb') as f:
        request(url, token, data=f.read(), method='POST', ctype='application/octet-stream').close()
    log(f'uploaded {name} to the {rel.get("tag_name", "")} release')


def check_token(repo: str, token: str) -> tuple[bool, str]:
    """(can write, plain message) for a GitHub token."""
    try:
        with request(f'https://api.github.com/repos/{repo}', token, timeout=30) as r:
            info = json.load(r)
    except urllib.error.HTTPError as e:
        return False, f'GitHub said {e.code}: the token is wrong, expired, or not allowed on {repo}'
    except OSError as e:
        return False, f'could not reach GitHub ({e})'
    perms = info.get('permissions') or {}
    if perms and not (perms.get('push') or perms.get('admin') or perms.get('maintain')):
        return False, 'GitHub token can read but not write: give it "Contents: Read and write" on this repository'
    # A fine-grained token reports its owner's rights here, so writing is only proven by the first upload.
    return True, 'GitHub token works (writing is confirmed by the first upload)'
