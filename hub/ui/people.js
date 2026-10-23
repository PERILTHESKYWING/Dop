// Who is who in the hub page: which account a message came from, and its avatar initials.
// Classic script: sets globalThis.hubPeople. Tested in tests/hub-people.test.ts.
(function (root) {
  // The account a message is from. An exact name wins; otherwise the longest account name that
  // starts the sender ("Alt 2 (lead)"), so "Alt 2" is never taken for "Alt".
  function acctOf(accounts, from) {
    const f = String(from ?? '');
    let best = null;
    for (const a of accounts || []) {
      if (a.name === f) return a;
      if (f.startsWith(a.name + ' ') && (!best || a.name.length > best.name.length)) best = a;
    }
    return best;
  }
  // One letter when it is unique. On a clash: the letter plus the trailing number ("Alt 2" → A2; the one
  // without a number keeps the bare letter), else the first letter of the second word, else the next
  // consonant. Never "Al", "AI" or "Ai": these avatars stand for accounts, and must not read as "AI".
  function initialOf(n, names) {
    const f = n[0].toUpperCase();
    const clash = names.filter((x) => x !== n && x[0].toUpperCase() === f);
    if (!clash.length) return f;
    const num = (x) => /(\d+)\s*$/.exec(x)?.[1];
    if (num(n)) return f + num(n);
    if (clash.every((x) => num(x))) return f;
    const bad = (x) => /^a[il]$/i.test(x);
    const word = n.split(/[\s_-]+/)[1];
    if (word && !bad(f + word[0])) return f + word[0].toUpperCase();
    for (const c of n.slice(1)) if (/[bcdfghjkmnpqrstvwxz]/i.test(c) && !bad(f + c)) return f + c.toLowerCase();
    return f;
  }
  root.hubPeople = { acctOf, initialOf };
})(typeof window !== 'undefined' ? window : globalThis);
