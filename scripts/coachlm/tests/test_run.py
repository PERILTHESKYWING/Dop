import json
import subprocess

import pytest

import evolve
import release
import run
import truth
from conftest import STUB_FACTORY, STUB_VERIFY
from util import read_json, read_jsonl


@pytest.fixture
def offline(monkeypatch, tmp_path):
    monkeypatch.setattr(release, 'get_release', lambda *a, **k: None)
    monkeypatch.setenv('HF_HOME', str(tmp_path / 'hf'))
    for k in ('HF_TOKEN', 'GITHUB_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY'):
        monkeypatch.delenv(k, raising=False)


def test_lock_allows_one_run(tmp_path):
    a, b = run.Lock(tmp_path / 'run.lock'), run.Lock(tmp_path / 'run.lock')
    assert a.acquire()
    assert not b.acquire()
    a.release()
    assert b.acquire()
    b.release()


def test_main_trains_and_resumes(tmp_path, monkeypatch, offline, tasks_on_disk, cfg):
    from test_evolve import FakeBackend
    monkeypatch.setattr(evolve, 'HFBackend', lambda c: FakeBackend())
    monkeypatch.setattr(evolve, 'node_status', lambda c: (True, 'stub'))
    (cfg.path('config.json')).write_text(json.dumps({
        'base_model': 'tiny/test-model', 'population': 4, 'train_tasks': 4, 'eval_tasks': 4, 'judged_eval_tasks': 2,
        'sft_steps': 2, 'dpo_steps': 2, 'first_sft_steps': 2, 'grad_accum': 2, 'hard_tasks': 2,
        'verify_cmd': list(STUB_VERIFY), 'factory_cmd': list(STUB_FACTORY), 'repo_root': str(tmp_path)}))
    assert run.main(['--data-dir', str(cfg.data_dir), '--generations', '1', '--name', 'my pc!']) == 0
    st = read_json(cfg.path('state.json'))
    assert st['generation'] == 2 and st['champion']
    assert any(r.get('run') == 'mypc' for r in read_jsonl(cfg.path('pool.jsonl.gz')))
    assert run.main(['--data-dir', str(cfg.data_dir), '--generations', '1']) == 0      # continues
    assert read_json(cfg.path('state.json'))['generation'] == 3


def test_main_stops_plainly_when_truth_check_fails(tmp_path, monkeypatch, offline, tasks_on_disk, cfg, capsys):
    from test_evolve import FakeBackend
    monkeypatch.setattr(evolve, 'HFBackend', lambda c: FakeBackend())
    monkeypatch.setenv('STUB_FAIL', '1')
    (cfg.path('config.json')).write_text(json.dumps({'base_model': 'tiny/test-model', 'population': 2, 'train_tasks': 2,
                                                     'eval_tasks': 2, 'first_sft_steps': 1, 'grad_accum': 1,
                                                     'verify_cmd': list(STUB_VERIFY), 'repo_root': str(tmp_path)}))
    assert run.main(['--data-dir', str(cfg.data_dir), '--generations', '1']) == 1
    assert 'never trains on unchecked text' in capsys.readouterr().out
    assert read_json(cfg.path('state.json'))['phase'] == 'verify'           # resumes at the check


def test_prepare_tasks_makes_local_ones_without_a_release(cfg, monkeypatch, offline):
    monkeypatch.setattr(truth, 'node_status', lambda c: (True, 'stub'))
    msg = run.prepare_tasks(cfg, None)
    assert 'locally' in msg
    train = list(read_jsonl(cfg.path('tasks', 'tasks.jsonl.gz')))
    ev = list(read_jsonl(cfg.path('tasks', 'eval.jsonl.gz')))
    assert ev and train and not {t['id'] for t in train} & {t['id'] for t in ev}


def test_prepare_tasks_without_node_says_why(cfg, monkeypatch, offline):
    monkeypatch.setattr(truth, 'node_status', lambda c: (False, 'Node.js is not installed'))
    assert 'Node.js is not installed' in run.prepare_tasks(cfg, None)


def test_schedule_on_windows(cfg, monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(run.platform, 'system', lambda: 'Windows')
    monkeypatch.setattr(run.subprocess, 'run', lambda cmd, **k: calls.append(cmd) or subprocess.CompletedProcess(cmd, 0, '', ''))
    assert run.schedule(cfg, 6, '01:00', 'pc') == 0
    cmd = calls[0]
    assert cmd[:4] == ['schtasks', '/Create', '/TN', 'KamiTraining'] and '/F' in cmd and cmd[cmd.index('/ST') + 1] == '01:00'
    wrapper = cfg.path('kami-nightly.cmd')
    assert cmd[cmd.index('/TR') + 1] == f'"{wrapper}"'
    text = wrapper.read_bytes().decode()
    assert '--hours 6 --upload --name pc' in text and 'nightly.log' in text
    assert text.count('\r\n') == 4 and '\r\r' not in text
    assert run.unschedule() == 0 and calls[-1][:4] == ['schtasks', '/Delete', '/TN', 'KamiTraining']


def test_schedule_elsewhere_prints_cron(cfg, monkeypatch, capsys):
    monkeypatch.setattr(run.platform, 'system', lambda: 'Linux')
    assert run.schedule(cfg, 6, '01:00', 'pc') == 1
    assert '0 1 * * *' in capsys.readouterr().out


def test_check_runs_without_gpu_libs(cfg, monkeypatch, offline, capsys):
    code = run.check(cfg)
    out = capsys.readouterr().out
    assert 'Kami training check' in out and ('Next steps' in out or code == 0)


def test_env_file_loading(tmp_path, monkeypatch):
    from config import load_env_file
    monkeypatch.delenv('HF_TOKEN', raising=False)
    monkeypatch.setenv('GITHUB_TOKEN', 'from-env')
    p = tmp_path / '.env'
    p.write_text('# tokens\nHF_TOKEN=hf_abc\nGITHUB_TOKEN=from-file\nGEMINI_API_KEY=\n')
    assert load_env_file(p) == ['HF_TOKEN']
    import os
    assert os.environ['HF_TOKEN'] == 'hf_abc' and os.environ['GITHUB_TOKEN'] == 'from-env'
    monkeypatch.delenv('HF_TOKEN')
