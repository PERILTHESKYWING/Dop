import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icons';
import { deleteAccount, refreshAccount, signIn, signOut, syncNow, useAccount } from '../state/account';
import { exportSnapshot, mergeSnapshot, readSnapshotFile, snapshotFile } from '../lib/sync/snapshot';
import { init } from '../state/actions';
import { toast } from '../state/store';
import { href } from '../router';

/** On Home, while accounts are on and nobody is signed in: sign up or log in to keep everything. */
export function AccountPrompt() {
  const a = useAccount();
  if (!a.configured || a.user) return null;
  return (
    <div className="callout account-prompt">
      <Icon name="user" style={{ width: 16, height: 16 }} />
      <span>Sign up or log in, and every game, review and setting is saved to your account on its own.</span>
      <a className="btn small primary" href={href('account')}>
        Sign up / Log in
      </a>
    </div>
  );
}

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
          <h1>Account &amp; Sync</h1>
          <p className="sub">Log in on any device and your games, reviews and settings are there.</p>
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
        <Icon name="user" style={{ width: 16, height: 16 }} /> Accounts not enabled
      </h3>
      <p className="small">
        Sign up and log in appear here once the site's free account database is connected on Vercel (README, "Accounts"). Until then everything is still saved in this browser.
      </p>
    </div>
  );
}

function SignInForm() {
  // A browser that has never synced most likely needs a new account.
  const [mode, setMode] = useState<'login' | 'register'>(() => (useAccount.getState().lastSync ? 'login' : 'register'));
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    if (mode === 'register' && pw !== pw2) return setErr('Passwords differ.');
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
          <strong>Log in</strong>
        </button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'on' : ''} onClick={() => (setMode('register'), setErr(null))}>
          <strong>Sign up</strong>
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
          Confirm password
          <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required minLength={8} />
        </label>
      )}
      {err && <div className="callout bad small">{err}</div>}
      <button className="btn primary" type="submit" disabled={busy}>
        {busy ? 'Wait…' : mode === 'login' ? 'Log in' : 'Create account'}
      </button>
      <p className="tiny muted">
        {mode === 'register'
          ? '8+ characters. There is no password reset, so keep it somewhere safe. What is in this browser now goes into the new account.'
          : 'Your account and this browser are merged; nothing here is lost.'}
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
          <Icon name="user" style={{ width: 16, height: 16 }} /> {a.user!.name}
        </h3>
        <button className="btn small ghost" onClick={() => void signOut()}>
          Log out
        </button>
      </div>
      <dl className="kv">
        <dt>Last sync</dt>
        <dd>{a.lastSync ? when(a.lastSync) : 'not yet'}</dd>
        <dt>Server copy</dt>
        <dd>{a.snapshot ? `${(a.snapshot.size / 1.37 / 1_048_576).toFixed(1)} MB, ${a.snapshot.device ?? 'unknown device'}, ${when(a.snapshot.updatedAt)}` : 'empty'}</dd>
      </dl>
      <button className="btn primary" onClick={() => void syncNow()} disabled={!!a.syncing}>
        <Icon name="sync" /> {a.syncing === 'download' ? `Downloading… ${a.progress ?? ''}` : a.syncing === 'upload' ? `Saving… ${a.progress ?? ''}` : 'Sync now'}
      </button>
      {a.error && <div className="callout bad small">Last sync failed: {a.error}</div>}
      <p className="tiny muted">
        Saves to your account on its own a little after every change, and when you leave the tab. Opening the site brings in what you did on other devices. Newer copies win; deletions do not sync.
      </p>
      {!confirmDelete ? (
        <button className="btn small ghost" onClick={() => setConfirmDelete(true)}>
          Delete account…
        </button>
      ) : (
        <form
          className="stack tight"
          onSubmit={(e) => {
            e.preventDefault();
            deleteAccount(pw)
              .then(() => toast('Account deleted. Local data kept.', 'ok'))
              .catch((err) => toast((err as Error).message, 'error'));
          }}
        >
          <span className="small">Deletes the account and server copy. Local data stays.</span>
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoComplete="current-password" />
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
      toast(`Backup failed: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const restore = async (f: File) => {
    setBusy(true);
    try {
      const r = await mergeSnapshot(await readSnapshotFile(f));
      await init();
      toast(`Restored: ${r.added} added, ${r.updated} updated, ${r.kept} kept.`, 'ok');
    } catch (e) {
      toast(`Cannot open file: ${(e as Error).message}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel stack">
      <h3 className="with-icon">
        <Icon name="download" style={{ width: 16, height: 16 }} /> Backup
      </h3>
      <p className="small">All your data in one file. Restoring merges; nothing is lost.</p>
      <div className="row wrap">
        <button className="btn" onClick={() => void download()} disabled={busy}>
          <Icon name="download" /> Download
        </button>
        <button className="btn" onClick={() => file.current?.click()} disabled={busy}>
          <Icon name="upload" /> Restore
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
