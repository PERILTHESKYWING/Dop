"""Grow Kami's own Go-explaining model on this PC's graphics card (or a free Kaggle GPU).

    python scripts/coachlm/run.py --check                 # is everything ready? prints next steps
    python scripts/coachlm/run.py --hours 8 --upload      # train for 8 hours, share the results
    python scripts/coachlm/run.py --schedule              # Windows: also train every night at 01:00
    python scripts/coachlm/run.py --unschedule            # remove that again

Safe to stop at any time (close the window or press Ctrl+C) and to run again: it continues
where it stopped. Everything lives in the data folder (%LOCALAPPDATA%\\kami-train on Windows,
~/.kami-train elsewhere); tokens can sit in its .env file (HF_TOKEN, GITHUB_TOKEN, GEMINI_API_KEY).
"""
from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from config import load_config, load_env_file  # noqa: E402
from truth import VerifyError  # noqa: E402
from util import log, read_jsonl, text_key, write_jsonl  # noqa: E402

TASK_NAME = 'KamiTraining'


# ------------------------------------------------------------------ lock ----

class Lock:
    """One run per data folder (a nightly run and a manual one must not collide)."""

    def __init__(self, path: Path):
        self.path, self.f = Path(path), None

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.f = open(self.path, 'a+')
        try:
            if os.name == 'nt':
                import msvcrt
                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.f.close()
            self.f = None
            return False
        return True

    def release(self) -> None:
        if self.f:
            self.f.close()
            self.f = None


# ------------------------------------------------------------------ data ----

def prepare_tasks(cfg, token: str | None) -> str:
    """tasks.jsonl.gz (train) and eval.jsonl.gz (held out) into <data>/tasks: from the coach-lm
    release, or made locally by the factory when the release has none yet."""
    from release import fetch_asset, get_release
    from truth import VerifyError, make_tasks, node_status
    tdir = cfg.path('tasks')
    tdir.mkdir(parents=True, exist_ok=True)
    try:
        rel = get_release(cfg.repo, cfg.release_tag, token)
        got = [n for n in ('tasks.jsonl.gz', 'eval.jsonl.gz') if fetch_asset(rel, n, tdir / n, token)]
    except OSError as e:
        rel, got = None, []
        log(f'could not reach GitHub ({e}); using the tasks already here')
    if (tdir / 'tasks.jsonl.gz').exists() and (tdir / 'eval.jsonl.gz').exists():
        return 'tasks from the coach-lm release' if got else 'tasks already here'
    ok, why = node_status(cfg)
    if not ok:
        return f'no tasks: the coach-lm release has none yet and {why}'
    log('the release has no tasks yet; making 200 here with the factory (KataGo on this PC)')
    local = tdir / 'local-tasks.jsonl'
    try:
        make_tasks(cfg, local, n=200, minutes=30)
    except VerifyError as e:
        return f'no tasks: {e}'
    rows = list(read_jsonl(local))
    ev = [t for t in rows if t.get('split') == 'eval']
    if not ev:   # hold out about 15 % by id hash, never trained on
        ev = [t for t in rows if int(text_key(t['id']), 16) % 100 < 15]
    ev_ids = {t['id'] for t in ev}
    write_jsonl(tdir / 'eval.jsonl.gz', ev)
    write_jsonl(tdir / 'tasks.jsonl.gz', [t for t in rows if t['id'] not in ev_ids])
    return f'made {len(rows) - len(ev)} train and {len(ev)} eval tasks locally'


# ----------------------------------------------------------------- check ----

def check(cfg) -> int:
    lines, must = [], []

    def ok(msg):
        lines.append('  OK    ' + msg)

    def bad(msg, fix, essential=True):
        lines.append('  FIX   ' + msg)
        if essential:
            must.append(fix)
        else:
            lines.append('        -> ' + fix)

    v = sys.version_info
    if v >= (3, 11):
        ok(f'Python {v.major}.{v.minor}')
    else:
        bad(f'Python {v.major}.{v.minor} is too old', 'Install Python 3.12 from python.org (tick "Add python.exe to PATH")')
    try:
        import torch
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            gb = p.total_memory / 2**30
            cap = torch.cuda.get_device_capability(0)
            arch = f'sm_{cap[0]}{cap[1]}'
            ok(f'GPU {p.name}, {gb:.1f} GB, CUDA {torch.version.cuda}, PyTorch {torch.__version__}')
            if arch not in torch.cuda.get_arch_list() and cap[0] >= 12:
                bad(f'this PyTorch has no kernels for {arch} (RTX 50 series)',
                    'Reinstall PyTorch for CUDA 12.8: pip install --force-reinstall torch --index-url https://download.pytorch.org/whl/cu128')
            if gb < 11:
                bad(f'{gb:.0f} GB of graphics memory is tight', 'Set "base_model": "qwen3-0.6b" in config.json, or close other GPU programs', False)
            if not torch.cuda.is_bf16_supported():
                lines.append('        (no bfloat16 on this card: training uses float16)')
        else:
            bad(f'PyTorch {torch.__version__} sees no NVIDIA GPU',
                'Install PyTorch for CUDA 12.8: pip install torch --index-url https://download.pytorch.org/whl/cu128 '
                '(and update the NVIDIA driver)')
    except ImportError:
        bad('PyTorch is not installed', 'Run start-kami-training-windows.bat (it installs everything)')
    for mod, name in (('transformers', 'transformers'), ('peft', 'peft'), ('trl', 'trl'), ('datasets', 'datasets'),
                      ('accelerate', 'accelerate'), ('safetensors', 'safetensors'), ('huggingface_hub', 'huggingface_hub')):
        try:
            m = __import__(mod)
            ok(f'{name} {getattr(m, "__version__", "")}')
        except ImportError:
            bad(f'{name} is missing', f'pip install -r {HERE / "requirements.txt"}')
    from truth import node_status
    good, why = node_status(cfg)
    if good:
        ok(why)
    else:
        bad(why, 'Install Node.js LTS from nodejs.org, then run the .bat again')
    if good and not (Path(cfg.repo_root) / 'node_modules').exists():
        bad('the repo has no node_modules', f'Run "npm ci" in {cfg.repo_root}')
    free = shutil.disk_usage(cfg.data_dir if Path(cfg.data_dir).exists() else Path.home()).free / 1e9
    if free >= 15:
        ok(f'{free:.0f} GB free disk')
    else:
        bad(f'only {free:.0f} GB free disk', 'Free at least 15 GB (the model is about 4 GB, training files up to the disk cap)')
    hf, gh, gm, oa = (os.environ.get(k, '').strip() for k in ('HF_TOKEN', 'GITHUB_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY'))
    if hf:
        try:
            from upload import hf_user
            ok(f'Hugging Face token works (user {hf_user(hf)})')
        except Exception as e:
            bad(f'Hugging Face token did not work ({type(e).__name__})', 'Make a new "Write" token at huggingface.co/settings/tokens', False)
    else:
        lines.append('  --    no HF_TOKEN: the champion stays on this PC (optional)')
    if gh:
        from release import check_token
        good, msg = check_token(cfg.repo, gh)
        if good:
            ok(msg)
        else:
            bad(msg, 'Make a fine-grained token with Contents: Read and write on PERILTHESKYWING/Dop', False)
    else:
        lines.append('  --    no GITHUB_TOKEN: the pool is not shared with other machines (optional)')
    if gm:
        from judge import check_key
        good, msg = check_key(gm)
        if good:
            ok(msg)
        else:
            bad(msg, 'Make a key at aistudio.google.com/apikey', False)
    else:
        lines.append('  --    no GEMINI_API_KEY: no writing judge, KataGo checks only (optional)')
    if oa:
        from tone import check_key as check_openai
        good, msg = check_openai(oa)
        if good:
            ok(msg)
        else:
            bad(msg, 'Make a key at platform.openai.com/api-keys (the API is billed separately from ChatGPT Plus)', False)
    else:
        lines.append('  --    no OPENAI_API_KEY: no ChatGPT tone reviewer (optional; paid API, not part of ChatGPT Plus)')
    print('Kami training check (data folder: %s)' % cfg.data_dir)
    print('\n'.join(lines))
    if must:
        print('\nNext steps:')
        for i, m in enumerate(must, 1):
            print(f'  {i}. {m}')
        return 1
    print('\nReady. Next: python scripts/coachlm/run.py --hours 8 --upload')
    return 0


# -------------------------------------------------------------- schedule ----

def schedule(cfg, hours: float, at: str, name: str) -> int:
    if platform.system() != 'Windows':
        print('Nightly scheduling is for Windows. Elsewhere add a cron line like:\n'
              f'  0 1 * * * cd {cfg.repo_root} && {sys.executable} {HERE / "run.py"} --hours {hours:g} --upload --name {name}')
        return 1
    wrapper = cfg.path('kami-nightly.cmd')
    wrapper.parent.mkdir(parents=True, exist_ok=True)
    wrapper.write_text('@echo off\n'
                       f'cd /d "{cfg.repo_root}"\n'
                       f'git pull --ff-only >> "{cfg.path("nightly.log")}" 2>&1\n'
                       f'"{sys.executable}" "{HERE / "run.py"}" --hours {hours:g} --upload --name {name} '
                       f'--data-dir "{cfg.data_dir}" >> "{cfg.path("nightly.log")}" 2>&1\n', encoding='utf-8', newline='\r\n')
    cmd = ['schtasks', '/Create', '/TN', TASK_NAME, '/TR', f'"{wrapper}"', '/SC', 'DAILY', '/ST', at, '/RL', 'LIMITED', '/F']
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        print('Could not add the nightly task:', (p.stderr or p.stdout).strip())
        return 1
    print(f'Added: Kami trains every night at {at} for {hours:g} hours when this PC is on and you are signed in.\n'
          f'Its log is {cfg.path("nightly.log")}. Remove it with: python scripts/coachlm/run.py --unschedule')
    return 0


def unschedule() -> int:
    if platform.system() != 'Windows':
        print('Nothing to remove here (remove your cron line instead).')
        return 0
    p = subprocess.run(['schtasks', '/Delete', '/TN', TASK_NAME, '/F'], capture_output=True, text=True)
    print('Removed the nightly training.' if p.returncode == 0 else 'There was no nightly training task.')
    return 0


# ------------------------------------------------------------------ main ----

def after_generation(cfg, upload: bool):
    def hook(evo, row):
        if not upload:
            return
        from pool import sync
        log(sync(evo.pool, cfg, os.environ.get('GITHUB_TOKEN', '').strip() or None, upload=True))
        if row.get('championChanged') and os.environ.get('HF_TOKEN'):
            from upload import upload_adapters
            log(upload_adapters(cfg, evo.state))
            ch = evo.state.get('champion') or {}
            evo.state['uploadedChampion'] = f'{ch.get("member")}@{ch.get("generation")}'
    return hook


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Grow Kami's own Go-explaining model")
    ap.add_argument('--hours', type=float, help='stop after this many hours (default 8; 6 for --schedule)')
    ap.add_argument('--generations', type=int, help='or after this many generations')
    ap.add_argument('--upload', action='store_true', help='share the pool (GITHUB_TOKEN) and champion (HF_TOKEN)')
    ap.add_argument('--name', default=(platform.node().split('.')[0].lower() or 'pc'), help='names this machine in the pool')
    ap.add_argument('--data-dir', help='data folder (default %%LOCALAPPDATA%%\\kami-train or ~/.kami-train)')
    ap.add_argument('--check', action='store_true', help='check GPU, libraries, Node and tokens, then stop')
    ap.add_argument('--schedule', action='store_true', help='Windows: train every night (see --at)')
    ap.add_argument('--at', default='01:00', help='nightly start time for --schedule (default 01:00)')
    ap.add_argument('--unschedule', action='store_true', help='Windows: remove the nightly training')
    a = ap.parse_args(argv)

    cfg = load_config(Path(a.data_dir) if a.data_dir else None)
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    load_env_file(cfg.path('.env'))
    os.environ.setdefault('HF_HOME', str(cfg.path('hf')))   # the base model cache lives with the rest
    name = ''.join(c for c in a.name if c.isalnum() or c in '-_')[:24] or 'pc'

    if a.check:
        return check(cfg)
    if a.schedule:
        return schedule(cfg, a.hours or 6.0, a.at, name)
    if a.unschedule:
        return unschedule()

    lock = Lock(cfg.path('run.lock'))
    if not lock.acquire():
        print('Kami training is already running for this data folder (maybe the nightly task). Nothing to do.')
        return 0
    backend = None
    try:
        deadline = time.time() + (a.hours or 8.0) * 3600
        gh = os.environ.get('GITHUB_TOKEN', '').strip() or None
        log(prepare_tasks(cfg, gh))
        from evolve import Evolution, HFBackend
        from judge import Judge
        from pool import sync
        judge = Judge(cfg)
        if not judge.enabled:
            log(f'writing judge off ({judge.stopped}); KataGo truth check only')
        backend = HFBackend(cfg)
        evo = Evolution(cfg, backend, judge, name=name, on_generation=after_generation(cfg, a.upload))
        if a.upload and os.environ.get('HF_TOKEN') and not evo.state['members'] and not evo.state['champion']:
            from upload import pull
            msg = pull(cfg, evo.state)
            if msg:
                log(msg)
                evo.save()
        log(sync(evo.pool, cfg, gh, upload=False))
        log(f'{len(evo.tasks)} train tasks, {len(evo.eval_tasks)} eval tasks, pool {evo.pool.stats()}')
        result = evo.run(deadline, a.generations)
        log(f'stopped: {result}')
        if a.upload:
            log(sync(evo.pool, cfg, gh, upload=True))
            ch = evo.state.get('champion') or {}
            mark = f'{ch.get("member")}@{ch.get("generation")}'
            if ch and os.environ.get('HF_TOKEN') and evo.state.get('uploadedChampion') != mark:
                from upload import upload_adapters
                try:
                    log(upload_adapters(cfg, evo.state))
                    evo.state['uploadedChampion'] = mark
                    evo.save()
                except Exception as e:
                    log(f'champion upload failed ({e}); it is safe here and goes up next time')
        print(f'\nProgress chart: {cfg.path("chart.txt")}\nRun again any time to continue.')
        return 0
    except KeyboardInterrupt:
        print('\nStopped. Everything so far is saved; run again to continue.')
        return 0
    except VerifyError as e:
        print(f'\nStopped: the KataGo truth check did not work, and Kami never trains on unchecked text.\n{e}\n'
              'Fix that (python scripts/coachlm/run.py --check), then run again to continue.')
        return 1
    finally:
        if backend is not None:
            backend.close()
        lock.release()


if __name__ == '__main__':
    sys.exit(main())
