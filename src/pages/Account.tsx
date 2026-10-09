import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { deleteAccount, refreshAccount, signIn, signOut, syncNow, useAccount } from '../state/account';
import { exportSnapshot, mergeSnapshot, readSnapshotFile, snapshotFile } from '../lib/sync/snapshot';
import { init } from '../state/actions';
import { toast } from '../state/store';

/**
 * Account & Sync: a username and password so your kifu, games and player data go with you
 * to another device; and, with or without an account, a backup file to carry them by hand.
 */
export function Account() {
  const a = useAccount();
  useEffect(() => void refreshAccount(), []);
  return (
    <div className="page account-page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Your data, on every device</div>
          <h1>Account &amp; Sync</h1>
          <p className="sub">Everything works without an account and stays in this browser. Sign in to carry your kifu, games, player profile and copy to another phone or computer.</p>
        </div>
      </div>
      <div className="cols-2">
        {a.configured === null ? (
          <div className="panel">Checking…</div>
        ) : !a.configured ? (
          <NotSetUp />
        ) : a.user ? (
          <SignedIn />
        ) : (
          <SignInForm />
        )}
        <BackupPanel />
      </div>
    </div>
  );
}

function NotSetUp() {
  return (
    <div className="panel stack">
      <h3 className="with-icon">
        <Icon name="user" style={{ width: 16, height: 16 }} /> Accounts aren't switched on for this site yet
      </h3>
      <p className="small">
        Signing in needs a small free database on the site's host. Whoever runs this copy of the app can add one in two steps (they're in the project's README under "Accounts"). Until then, use a backup file to move your data.
      </p>
    </div>
  );
}

function SignInForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (mode === 'register' && pw !== pw2) return setErr("The two passwords don't match.");
    setBusy(true);
    setErr(null);
    try {
      await signIn(mode, name, pw);
      setPw('');
      setPw2('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="panel stack account-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="segmented" role="tablist">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'on' : ''} onClick={() => (setMode('login'), setErr(null))}>
          <strong>Sign in</strong>
        </button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => (setMode('register'), setErr(null))}>
          <strong>Create account</strong>
        </button>
      </div>
      <label>
        Username
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={32} />
      </label>
      <label>
        Password
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={8} />
      </label>
      {mode === 'register' && (
        <label>
          Password again
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required minLength={8} />
        </label>
      )}
      {err && <div className="callout bad small">{err}</div>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'One moment…' : mode === 'login' ? 'Sign in and sync' : 'Create account and sync'}
      </button>
      <p className="tiny muted">
        {mode === 'register'
          ? 'At least 8 characters. There is no email and no password reset, so keep the password somewhere safe; a backup file is a good extra.'
          : 'Signing in brings your account’s data into this browser and keeps both in step.'}
      </p>
    </form>
  );
}

function SignedIn() {
  const a = useAccount();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pw, setPw] = useState('');
  const when = (t: number) => new Date(t).toLocaleString();
  return (
    <div className="panel stack">
      <div className="spread">
        <h3 className="with-icon">
          <Icon name="user" style={{ width: 16, height: 16 }} /> Signed in as {a.user!.name}
        </h3>
        <button className="btn small ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
      <dl className="kv">
        <dt>Last sync here</dt>
        <dd>{a.lastSync ? when(a.lastSync) : 'not yet'}</dd>
        <dt>Account copy</dt>
        <dd>{a.snapshot ? `${(a.snapshot.size / 1.37 / 1_048_576).toFixed(1)} MB, from ${a.snapshot.device ?? 'a device'}, ${when(a.snapshot.updatedAt)}` : 'empty'}</dd>
      </dl>
      <button className="btn primary" onClick={() => void syncNow()} disabled={!!a.syncing}>
        <Icon name="sync" /> {a.syncing === 'download' ? `Downloading… ${a.progress ?? ''}` : a.syncing === 'upload' ? `Uploading… ${a.progress ?? ''}` : 'Sync now'}
      </button>
      {a.error && <div className="callout bad small">Last sync failed: {a.error}</div>}
      <p className="tiny muted">
        It syncs by itself when you open the app and when you leave it. Syncing adds what each side is missing and keeps the newer copy of anything changed in both places; deleting something on one device does not delete it on the
        others.
      </p>
      {!confirmDelete ? (
        <button className="btn small ghost" onClick={() => setConfirmDelete(true)}>
          Delete this account…
        </button>
      ) : (
        <form
          className="stack tight"
          onSubmit={(e) => {
            e.preventDefault();
            deleteAccount(pw)
              .then(() => toast('Account deleted. Your data in this browser is untouched.', 'ok'))
              .catch((err) => toast((err as Error).message, 'error'));
          }}
        >
          <span className="small">This deletes the account and its copy on the server. This browser keeps everything.</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Your password" autoComplete="current-password" />
          <div className="row">
            <button type="button" className="btn small ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button type="submit" className="btn small danger" disabled={!pw}>
              Delete account
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function BackupPanel() {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const blob = await snapshotFile(await exportSnapshot());
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `doppelganger-backup-${new Date().toISOString().slice(0, 10)}.json.gz`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      toast(`The backup could not be made: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const restore = async (f: File) => {
    setBusy(true);
    try {
      const r = await mergeSnapshot(await readSnapshotFile(f));
      await init();
      toast(`Backup opened: ${r.added} added, ${r.updated} updated, ${r.kept} already here.`, 'ok');
    } catch (e) {
      toast(`That file could not be opened: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel stack">
      <h3 className="with-icon">
        <Icon name="download" style={{ width: 16, height: 16 }} /> Backup file
      </h3>
      <p className="small">One file with your kifu, games and analyses, player profile, copy, opponents and settings. Open it on another device to bring everything there; nothing already on that device is lost.</p>
      <div className="row wrap">
        <button className="btn" onClick={() => void download()} disabled={busy}>
          <Icon name="download" /> Download backup
        </button>
        <button className="btn" onClick={() => file.current?.click()} disabled={busy}>
          <Icon name="upload" /> Open a backup
        </button>
        <input
          ref={file}
          type="file"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void restore(f);
          }}
        />
      </div>
    </div>
  );
}
