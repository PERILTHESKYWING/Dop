import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { account, NOT_SYNCED, UNREACHABLE, useAccount } from '../lib/account';
import { ago } from '../lib/accountView';
import { Icon } from './Icon';
import './account.css';

const COPY = {
  blurb: 'Optional and free. Sign in to keep your path, days in a row and settings the same on every device. Chats and boards stay on this device.',
  small: 'Kiai keeps a one-way fingerprint of your email, not the address, and never sends email. Your password is hashed on the server and never stored.',
  codeHead: 'Save your recovery code',
  codeText: "Kiai can't email you, so this code is the only way back in if you forget your password. It is shown once. Keep it in a password manager or on paper.",
  recoverHelp: "Lost the code too? The account can't be opened again, but your path is still on each device you used. Create a new account there and it comes along.",
  deleteHelp: 'Removes the account and its copy of your path from the server. This device keeps its own copy.',
};

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="acct-field">
      <span className="set-label">{label}</span>
      {children}
      {help && <span className="set-help">{help}</span>}
    </label>
  );
}

/** Shown once after create, recover or a new code. */
function RecoveryCode({ code, email, onDone }: { code: string; email: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => setCopied(true))
      .catch(() => undefined);
  };
  const save = () => {
    const blob = new Blob([`Kiai recovery code\n\nEmail: ${email}\nCode: ${code}\n`], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'kiai-recovery-code.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="acct-code" role="region" aria-label={COPY.codeHead}>
      <h4>{COPY.codeHead}</h4>
      <div className="acct-code-value">{code}</div>
      <p className="set-help">{COPY.codeText}</p>
      <div className="acct-actions">
        <button type="button" className="btn" onClick={copy}>
          <Icon name={copied ? 'check' : 'copy'} size={16} />
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn" onClick={save}>
          <Icon name="download" size={16} />
          Save as file
        </button>
        <button type="button" className="btn primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

function SignedOut({ onCode }: { onCode: (code: string, email: string) => void }) {
  const [mode, setMode] = useState<'signin' | 'create' | 'recover'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signin') await account.login(email, password);
      else if (mode === 'create') onCode((await account.register(email, password)).recovery, email.trim());
      else onCode((await account.recover(email, code, password)).recovery, email.trim());
      setPassword('');
    } catch (err) {
      setError((err as Error).message || UNREACHABLE);
    } finally {
      setBusy(false);
    }
  };
  const recover = mode === 'recover';
  return (
    <>
      <p className="set-blurb">{COPY.blurb}</p>
      {recover ? (
        <h4 className="acct-head">Reset your password</h4>
      ) : (
        <span className="seg acct-seg" role="radiogroup" aria-label="Sign in or create an account">
          {(
            [
              ['signin', 'Sign in'],
              ['create', 'Create account'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              className={mode === id ? 'on' : ''}
              onClick={() => {
                setMode(id);
                setError(null);
              }}
            >
              {label}
            </button>
          ))}
        </span>
      )}
      <form className="acct-form" onSubmit={submit}>
        <Field label="Email">
          <input className="textbox" type="email" name="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {recover && (
          <Field label="Recovery code">
            <input className="textbox mono-in" type="text" name="code" autoComplete="off" spellCheck={false} required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-XXXXX" />
          </Field>
        )}
        <Field label={recover ? 'New password' : 'Password'} help={mode === 'signin' ? undefined : 'At least 8 characters.'}>
          <input
            className="textbox"
            type="password"
            name="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'signin' ? undefined : 8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && (
          <p className="acct-error" role="alert">
            {error}
          </p>
        )}
        <div className="acct-actions">
          <button type="submit" className="btn primary" disabled={busy}>
            {mode === 'signin' ? (busy ? 'Signing in…' : 'Sign in') : mode === 'create' ? (busy ? 'Creating…' : 'Create account') : busy ? 'Resetting…' : 'Reset password'}
          </button>
          {recover ? (
            <button type="button" className="text-btn" onClick={() => setMode('signin')}>
              Back to sign in
            </button>
          ) : (
            <button
              type="button"
              className="text-btn"
              onClick={() => {
                setMode('recover');
                setError(null);
              }}
            >
              Forgot your password?
            </button>
          )}
        </div>
        {recover && <p className="set-help">{COPY.recoverHelp}</p>}
      </form>
      <p className="set-help acct-small">{COPY.small}</p>
    </>
  );
}

/** A row that opens a small form under it: password and a confirm button. */
function PasswordAction({
  label,
  help,
  open,
  onOpen,
  button,
  danger,
  second,
  run,
}: {
  label: string;
  help?: string;
  open: boolean;
  onOpen: (v: boolean) => void;
  button: string;
  danger?: boolean;
  /** A second field (new password). */
  second?: string;
  run: (pw: string, next: string) => Promise<void>;
}) {
  const [pw, setPw] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) {
      setPw('');
      setNext('');
      setError(null);
    }
  }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await run(pw, next);
      onOpen(false);
    } catch (err) {
      setError((err as Error).message || UNREACHABLE);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`set-row${open ? ' stack' : ''}`}>
      <div className="set-text">
        <div className="set-label">{label}</div>
        {help && <div className="set-help">{help}</div>}
      </div>
      <div className="set-control">
        {open ? (
          <form className="acct-form inline" onSubmit={submit}>
            <Field label={second ? 'Current password' : 'Password'}>
              <input className="textbox" type="password" autoComplete="current-password" required value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
            </Field>
            {second && (
              <Field label={second} help="At least 8 characters.">
                <input className="textbox" type="password" autoComplete="new-password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
            )}
            {error && (
              <p className="acct-error" role="alert">
                {error}
              </p>
            )}
            <div className="acct-actions">
              <button type="button" className="btn" onClick={() => onOpen(false)}>
                Cancel
              </button>
              <button type="submit" className={`btn ${danger ? 'danger' : 'primary'}`} disabled={busy}>
                {button}
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className={`btn${danger ? ' danger-outline' : ''}`} onClick={() => onOpen(true)}>
            {label}
          </button>
        )}
      </div>
    </div>
  );
}

function SignedIn({ onCode }: { onCode: (code: string, email: string) => void }) {
  const v = useAccount();
  const [open, setOpen] = useState<'password' | 'code' | 'delete' | null>(null);
  const [clear, setClear] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  const state = v.syncing
    ? 'Syncing…'
    : v.available === false
      ? "Can't reach the sync server right now."
      : v.error && v.error !== NOT_SYNCED
        ? v.error
        : v.error || !v.lastSync
          ? NOT_SYNCED
          : `Synced ${ago(v.lastSync)}`;
  const toggle = (k: typeof open) => (on: boolean) => setOpen(on ? k : null);
  return (
    <>
      <p className="set-blurb">
        Signed in as <strong>{v.email}</strong>
        <br />
        <span className="acct-state">{state}</span>
      </p>
      <div className="set-list">
        <div className="set-row">
          <div className="set-text">
            <div className="set-label">Sync now</div>
            <div className="set-help">Your path, days in a row and synced settings. Chats and boards stay on this device.</div>
          </div>
          <div className="set-control">
            <button type="button" className="btn" disabled={v.syncing} onClick={() => void account.syncNow()}>
              Sync now
            </button>
          </div>
        </div>
        <PasswordAction label="Change password" second="New password" open={open === 'password'} onOpen={toggle('password')} button="Change password" run={(pw, next) => account.changePassword(pw, next)} />
        <PasswordAction
          label="New recovery code"
          help="The old code stops working."
          open={open === 'code'}
          onOpen={toggle('code')}
          button="Show new code"
          run={async (pw) => onCode((await account.newRecoveryCode(pw)).recovery, v.email ?? '')}
        />
        <div className="set-row">
          <div className="set-text">
            <div className="set-label">Sign out</div>
            <label className="acct-check">
              <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} />
              Also remove my path from this device
            </label>
          </div>
          <div className="set-control">
            <button type="button" className="btn" onClick={() => void account.logout(clear)}>
              Sign out
            </button>
          </div>
        </div>
        <PasswordAction label="Delete account" help={COPY.deleteHelp} open={open === 'delete'} onOpen={toggle('delete')} button="Delete account" danger run={(pw) => account.remove(pw)} />
      </div>
    </>
  );
}

/** Settings › Account. Only rendered when the sync server answered (or a session is stored). */
export function AccountPage() {
  const v = useAccount();
  const [code, setCode] = useState<{ code: string; email: string } | null>(null);
  if (code) return <RecoveryCode code={code.code} email={code.email} onDone={() => setCode(null)} />;
  const onCode = (c: string, email: string) => setCode({ code: c, email });
  return v.signedIn ? <SignedIn onCode={onCode} /> : <SignedOut onCode={onCode} />;
}
