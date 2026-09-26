import { useState } from 'react';
import { engineKomi } from '../lib/go/rules';

export const KOMI_CHOICES = [7.5, 7, 6.5, 6, 5.5, 3.75, 0.5, 0, -0.5];

/**
 * Komi and scoring rules for a position KataGo analyses. KataGo scores by area, so
 * territory rules (Japanese) are given half a point more (go/rules.ts engineKomi).
 */
export function KomiPicker({
  komi,
  rules,
  onKomi,
  onRules,
  compact,
}: {
  komi: number;
  rules?: string;
  onKomi: (k: number) => void;
  onRules?: (r: string) => void;
  compact?: boolean;
}) {
  const [custom, setCustom] = useState(!KOMI_CHOICES.includes(komi));
  const territory = rules === 'japanese';
  return (
    <span className="komi-picker row" title={`KataGo scores with komi ${engineKomi(komi, territory ? 'japanese' : 'chinese')}${territory ? ' (territory counted by area)' : ''}`}>
      <label className="small">
        Komi{' '}
        {custom ? (
          <input
            type="number"
            step={0.5}
            min={-50}
            max={50}
            value={komi}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onKomi(Math.round(v * 4) / 4);
            }}
            style={{ width: 70 }}
            aria-label="Komi"
          />
        ) : (
          <select
            value={komi}
            onChange={(e) => {
              if (e.target.value === 'custom') setCustom(true);
              else onKomi(Number(e.target.value));
            }}
            aria-label="Komi"
          >
            {KOMI_CHOICES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
            <option value="custom">other…</option>
          </select>
        )}
      </label>
      {onRules && (
        <select value={territory ? 'japanese' : 'chinese'} onChange={(e) => onRules(e.target.value)} aria-label="Scoring rules">
          <option value="chinese">{compact ? 'Area' : 'Chinese (area)'}</option>
          <option value="japanese">{compact ? 'Territory' : 'Japanese (territory)'}</option>
        </select>
      )}
    </span>
  );
}
