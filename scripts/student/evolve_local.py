"""Evolve the student network on your own computer's graphics card or a free Kaggle GPU.

    python scripts/student/evolve_local.py --hours 8            # train, keep the result here
    python scripts/student/evolve_local.py --hours 8 --upload   # and send the winner to the arena

It downloads the cloud training's data and champion from the repository's public
"ai-training" release, then runs generations of the same evolution as the cloud
(population.py: each generation's minds start from the local champion, with mutated
settings or size, and the best by the arena's fitness becomes the next champion). A GPU
trains several times faster than the cloud's CPU machines, so a night here is worth many
cloud runs. With --upload (needs GITHUB_TOKEN, a token with "Contents: read and write" on
the repository) the local champion goes to the release as candidate-<name>.pt; the next
cloud run puts it in its arena like any other mind, and keeps it only if it wins there
too.

Needs Python 3.10+ with numpy and PyTorch. For an NVIDIA RTX 50-series card:
    pip install numpy torch --index-url https://download.pytorch.org/whl/cu128
On Kaggle (free GPU, about 30 hours a week; turn on Internet in the notebook's settings):
    !git clone --depth 1 https://github.com/PERILTHESKYWING/Dop
    import os; from kaggle_secrets import UserSecretsClient
    os.environ['GITHUB_TOKEN'] = UserSecretsClient().get_secret('GITHUB_TOKEN')
    !python Dop/scripts/student/evolve_local.py --hours 8 --upload --name kaggle
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
API = 'https://api.github.com/repos/{repo}/releases/tags/ai-training'


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def request(url: str, token: str | None, data: bytes | None = None, method: str | None = None, ctype: str | None = None):
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Accept', 'application/vnd.github+json')
    req.add_header('User-Agent', 'dop-evolve-local')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    if ctype:
        req.add_header('Content-Type', ctype)
    return urllib.request.urlopen(req, timeout=600)


def fetch(asset: dict, dest: Path, token: str | None) -> Path:
    """Download one release asset unless the same file is already here."""
    if dest.exists() and dest.stat().st_size == asset['size']:
        return dest
    log(f'downloading {asset["name"]} ({asset["size"] / 1e6:.0f} MB)')
    tmp = dest.with_suffix(dest.suffix + '.part')
    with request(asset['browser_download_url'], token) as r, open(tmp, 'wb') as f:
        shutil.copyfileobj(r, f, 1 << 20)
    tmp.replace(dest)
    return dest


def gunzip(src: Path) -> Path:
    import gzip
    out = src.with_suffix('')
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        with gzip.open(src, 'rb') as i, open(out, 'wb') as o:
            shutil.copyfileobj(i, o, 1 << 20)
    return out


def download(a, work: Path, token: str | None) -> dict:
    rel = json.load(request(API.format(repo=a.repo), token))
    assets = {x['name']: x for x in rel['assets']}
    labels = sorted((x for x in rel['assets'] if x['name'].startswith('labels-') and x['name'].endswith('.dpd.gz')),
                    key=lambda x: x['created_at'], reverse=True)
    people = [x for x in labels if '-kata-' not in x['name']][: a.parts]
    kata = [x for x in labels if '-kata-' in x['name']][: a.kata_parts]
    data = work / 'labels'
    data.mkdir(parents=True, exist_ok=True)
    keep = {x['name'] for x in people + kata}
    for f in data.glob('labels-*'):
        if f.name.removesuffix('.part').removesuffix('.gz') + '.gz' not in keep:
            f.unlink()  # an older part, out of the window now
    for x in people + kata:
        gunzip(fetch(x, data / x['name'], token))
    if 'val.dpd.gz' not in assets:
        raise SystemExit('the release has no validation set yet; let the cloud training run once first')
    gunzip(fetch(assets['val.dpd.gz'], work / 'val.dpd.gz', token))
    if 'champion.pt' in assets:
        fetch(assets['champion.pt'], work / 'cloud-champion.pt', token)
    else:
        shutil.copy(HERE.parent.parent / 'data' / 'student' / 'seed-champion.pt', work / 'cloud-champion.pt')
    if 'population.json' in assets:
        fetch(assets['population.json'], work / 'cloud-population.json', token)
    log(f'{len(people)} label parts from people\'s games, {len(kata)} from KataGo self-play')
    return rel


def upload(rel: dict, path: Path, name: str, token: str) -> None:
    for x in rel['assets']:
        if x['name'] == name:
            request(x['url'], token, method='DELETE').close()
    url = rel['upload_url'].split('{')[0] + f'?name={name}'
    with open(path, 'rb') as f:
        request(url, token, data=f.read(), method='POST', ctype='application/octet-stream').close()
    log(f'uploaded {name}; the next cloud run judges it in its arena')


def main():
    ap = argparse.ArgumentParser(description='Evolve the student network on a local GPU')
    ap.add_argument('--hours', type=float, default=8)
    ap.add_argument('--minds', type=int, default=4, help='minds per generation')
    ap.add_argument('--minutes', type=float, default=0, help='minutes per mind (default: a generation about every 2 hours)')
    ap.add_argument('--parts', type=int, default=24, help='newest label parts from people\'s games')
    ap.add_argument('--kata-parts', type=int, default=4, help='newest KataGo self-play parts')
    ap.add_argument('--repo', default='PERILTHESKYWING/Dop')
    ap.add_argument('--dir', default=str(Path.home() / 'DopTrain'))
    ap.add_argument('--name', default=platform.node().split('.')[0].lower() or 'pc', help='names the uploaded candidate')
    ap.add_argument('--upload', action='store_true', help='send the local champion to the cloud arena (GITHUB_TOKEN)')
    ap.add_argument('--fresh', action='store_true', help='start again from the cloud champion')
    a = ap.parse_args()
    token = os.environ.get('GITHUB_TOKEN') or os.environ.get('GH_TOKEN')
    if a.upload and not token:
        raise SystemExit('--upload needs GITHUB_TOKEN (a token with Contents: read and write on the repository)')
    import torch  # noqa: F401  (fail early when PyTorch is missing)
    gpu = torch.cuda.is_available()
    log('GPU:', torch.cuda.get_device_name(0) if gpu else 'none (training on the processor; slow)')

    work = Path(a.dir).expanduser()
    work.mkdir(parents=True, exist_ok=True)
    rel = download(a, work, token)
    champion, pop = work / 'champion.pt', work / 'population.json'
    if a.fresh or not champion.exists():
        shutil.copy(work / 'cloud-champion.pt', champion)
        if (work / 'cloud-population.json').exists():
            shutil.copy(work / 'cloud-population.json', pop)
        else:
            pop.unlink(missing_ok=True)
    minutes = a.minutes or max(5.0, 110.0 / a.minds)
    end = time.time() + a.hours * 3600
    py = sys.executable
    gen = 0
    won = 0
    while time.time() + minutes * 60 * a.minds < end + 60:
        gen += 1
        run = int(time.time()) % 10_000_000
        minds = json.loads(subprocess.check_output([py, str(HERE / 'population.py'), 'plan', '--population', str(pop),
                                                    '--minds', str(a.minds), '--run', str(run)]))
        out = work / 'minds'
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir()
        for m in minds:
            log(f'generation {gen}, mind {m["id"]}: {m["changed"] or "champion settings"}')
            subprocess.run([py, str(HERE / 'train.py'), '--data', str(work / 'labels' / '*.dpd'), '--val-data', str(work / 'val.dpd'),
                            '--init', str(champion), '--minutes', str(minutes), '--batch', '1024' if gpu else '256',
                            '--lr', str(m['lr']), '--search-weight', str(m['searchWeight']), '--seed', str(m['seed']),
                            '--curriculum', str(m['curriculum']), '--kata-share', str(m['kataShare']),
                            '--mutate', m['mutate'], '--changed', m['changed'],
                            '--name', f'{a.name}-{run}-{m["id"]}', '--out', str(out / f'mind-{m["id"]}.pt')], check=True)
        subprocess.run([py, str(HERE / 'population.py'), 'arena', '--population', str(pop), '--val', str(work / 'val.dpd'),
                        '--minds', str(out / 'mind-*.pt'), '--champion', str(champion), '--out', str(champion),
                        '--report', str(work / 'arena.json'), '--run', str(run)], check=True)
        if json.loads((work / 'arena.json').read_text()).get('changed'):
            won += 1
    log(f'{gen} generations, the champion was replaced {won} times')
    if a.upload:
        if champion.read_bytes() != (work / 'cloud-champion.pt').read_bytes():
            upload(rel, champion, f'candidate-{a.name}.pt', token)
        else:
            log('the local champion is still the cloud\'s; nothing to upload')


if __name__ == '__main__':
    main()
