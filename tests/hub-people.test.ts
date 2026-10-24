// Account identity in the hub page (hub/ui/people.js): one account, one avatar, everywhere.
import { beforeAll, describe, expect, it } from 'vitest';

let people: any;
beforeAll(async () => {
  await import(/* @vite-ignore */ '../hub/ui/people.js' as string);
  people = (globalThis as any).hubPeople;
});

const accounts = [{ name: 'Alt' }, { name: 'Alt 2' }, { name: 'Helper1' }, { name: 'Main' }];

describe('hub people', () => {
  it('finds the right account for a sender, never a shorter name that starts it', () => {
    expect(people.acctOf(accounts, 'Alt 2')?.name).toBe('Alt 2');
    expect(people.acctOf(accounts, 'Alt')?.name).toBe('Alt');
    expect(people.acctOf(accounts, 'Alt 2 (lead)')?.name).toBe('Alt 2');
    expect(people.acctOf(accounts, 'Alt (member)')?.name).toBe('Alt');
    expect(people.acctOf(accounts, 'Coordinator')).toBeNull();
    expect(people.acctOf([...accounts].reverse(), 'Alt 2')?.name).toBe('Alt 2');
  });

  it('gives initials that stay apart and never read as AI', () => {
    const names = accounts.map((a) => a.name);
    expect(names.map((n) => people.initialOf(n, names))).toEqual(['A', 'A2', 'H', 'M']);
    const more = ['Alice', 'Alan', 'Ann 3', 'Ai'];
    for (const n of more) expect(people.initialOf(n, more)).not.toMatch(/^a[il]$/i);
    expect(people.initialOf('Ann 3', more)).toBe('A3');
  });
});
