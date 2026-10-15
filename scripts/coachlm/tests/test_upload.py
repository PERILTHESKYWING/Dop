"""Uploads with Hugging Face and GitHub faked (no network)."""
import json
import sys
import types

import pytest

pytest.importorskip('safetensors')

import release  # noqa: E402
import upload  # noqa: E402
from conftest import write_fake_adapter  # noqa: E402
from pool import POOL_ASSET, Pool, sync  # noqa: E402
from util import read_jsonl, write_jsonl  # noqa: E402


class FakeApi:
    log = []

    def __init__(self, token=None):
        self.token = token

    def whoami(self):
        return {'name': 'xiao'}

    def create_repo(self, repo, **kw):
        FakeApi.log.append(('create', repo, kw))

    def upload_folder(self, repo_id, folder_path, commit_message=''):
        from pathlib import Path
        files = sorted(str(p.relative_to(folder_path)).replace('\\', '/') for p in Path(folder_path).rglob('*') if p.is_file())
        FakeApi.log.append(('upload', repo_id, files, commit_message))


@pytest.fixture
def fake_hub(monkeypatch, tmp_path):
    FakeApi.log = []
    mod = types.ModuleType('huggingface_hub')
    mod.HfApi = FakeApi
    shared = tmp_path / 'hub-snapshot'

    def snapshot_download(repo, allow_patterns=None, token=None):
        if not shared.exists():
            raise FileNotFoundError(repo)
        return str(shared)
    mod.snapshot_download = snapshot_download
    monkeypatch.setitem(sys.modules, 'huggingface_hub', mod)
    return shared


def test_adapters_need_a_token(cfg, monkeypatch, fake_hub):
    monkeypatch.delenv('HF_TOKEN', raising=False)
    assert 'no HF_TOKEN' in upload.upload_adapters(cfg, {})
    assert FakeApi.log == []


def test_upload_champion_and_hive(cfg, fake_hub):
    write_fake_adapter(cfg.path('champion'), 4, 1)
    write_fake_adapter(cfg.path('hive'), 8, 2)
    state = {'champion': {'member': 'm0003', 'generation': 5, 'run': 'pc', 'fit': {'truthRate': 1.0}},
             'hive': {'mass': 2.5, 'folded': ['m1'], 'rank': 8}, 'generation': 6}
    msg = upload.upload_adapters(cfg, state, token='hf_x')
    assert 'xiao/kami-coach' in msg
    create, up = FakeApi.log
    assert create[1] == 'xiao/kami-coach' and create[2]['private'] is False
    assert {'champion/adapter_config.json', 'hive/adapter_model.safetensors', 'kami.json', 'README.md'} <= set(up[2])
    assert 'generation 5' in up[3]


def test_upload_web_needs_export(cfg, fake_hub, tmp_path):
    assert 'run export.py first' in upload.upload_web(cfg, tmp_path / 'none', token='hf_x')
    web = tmp_path / 'web'
    (web / 'onnx').mkdir(parents=True)
    (web / 'onnx' / 'model_q4f16.onnx').write_bytes(b'x')
    (web / 'config.json').write_text('{}')
    assert 'xiao/kami-coach-web' in upload.upload_web(cfg, web, token='hf_x')
    assert 'README.md' in FakeApi.log[-1][2]


def test_pull_continues_shared_lineage(cfg, fake_hub):
    state = {'champion': None, 'hive': None}
    assert 'no shared champion' in upload.pull(cfg, state, token='hf_x')
    write_fake_adapter(fake_hub / 'champion', 4, 1)
    write_fake_adapter(fake_hub / 'hive', 8, 2)
    (fake_hub / 'kami.json').write_text(json.dumps({'base': cfg.base_id, 'champion': {'member': 'm7', 'generation': 9,
                                                                                    'fit': {'truthRate': 1}},
                                                    'hive': {'mass': 3.0, 'rank': 8}}))
    assert 'pulled' in upload.pull(cfg, state, token='hf_x')
    assert (cfg.path('champion') / 'adapter_config.json').exists() and state['champion']['fit'] is None
    assert state['hive'] == {'mass': 3.0, 'folded': [], 'rank': 8}
    assert upload.pull(cfg, state, token='hf_x') == ''              # already has a champion


def test_pull_refuses_other_base(cfg, fake_hub):
    write_fake_adapter(fake_hub / 'champion', 4, 1)
    (fake_hub / 'kami.json').write_text(json.dumps({'base': 'other/model'}))
    assert 'starting fresh' in upload.pull(cfg, {}, token='hf_x')


def test_pool_sync_merges_then_uploads_union(cfg, monkeypatch, tmp_path):
    remote = tmp_path / 'remote.jsonl.gz'
    write_jsonl(remote, [{'kind': 'good', 'taskId': 't9', 'promptVersion': 1, 'text': 'from kaggle', 'member': 'kaggle/m1'}])
    uploaded = {}
    rel = {'tag_name': 'coach-lm', 'assets': [{'name': POOL_ASSET}]}
    monkeypatch.setattr(release, 'get_release', lambda *a, **k: rel)

    def fetch(r, name, dest, token=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(remote.read_bytes())
        return dest
    monkeypatch.setattr(release, 'fetch_asset', fetch)
    monkeypatch.setattr(release, 'upload_asset', lambda r, path, name, token: uploaded.update(
        {name: [x['text'] for x in read_jsonl(path)]}))
    p = Pool(cfg.path('pool.jsonl.gz'))
    p.add([{'kind': 'good', 'taskId': 't1', 'promptVersion': 1, 'text': 'from pc', 'member': 'pc/m1'}])
    assert 'not uploaded (no GITHUB_TOKEN)' in sync(p, cfg, None, upload=True)
    msg = sync(p, cfg, 'ghp_x', upload=True)
    assert 'uploaded 2 rows' in msg
    assert sorted(uploaded[POOL_ASSET]) == ['from kaggle', 'from pc']


def test_pool_sync_without_release_stays_local(cfg, monkeypatch):
    monkeypatch.setattr(release, 'get_release', lambda *a, **k: None)
    assert 'does not exist yet' in sync(Pool(cfg.path('pool.jsonl.gz')), cfg, 'ghp_x', upload=True)
