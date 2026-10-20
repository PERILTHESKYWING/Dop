/**
 * ultraGO's name: a rainbow that slowly runs through the letters, like Claude's ultracode.
 * Holds still under reduced motion. Every other level's name is plain text.
 */
import type { Level } from '../lib/levels';

export function UltraGo({ children = 'ultraGO', className }: { children?: string; className?: string }) {
  return <span className={`ultrago${className ? ` ${className}` : ''}`}>{children}</span>;
}

export function LevelName({ level }: { level: Level }) {
  return level.id === 'ultrago' ? <UltraGo /> : <>{level.name}</>;
}
