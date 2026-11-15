/** Six-axis stat radar, hand-drawn SVG. */
import type { Stat } from '../../lib/schemas';
import { STATS } from '../../lib/ui/ranks';

const SIZE = 240;
const C = SIZE / 2;
const R = 84;

function point(i: number, frac: number): [number, number] {
  const angle = (Math.PI * 2 * i) / STATS.length - Math.PI / 2;
  return [C + Math.cos(angle) * R * frac, C + Math.sin(angle) * R * frac];
}

export function StatRadar({ stats }: { stats: Record<Stat, number> }) {
  const max = Math.max(5, ...STATS.map((s) => stats[s]));
  const shape = STATS.map((s, i) => point(i, Math.max(0.04, stats[s] / max)).join(',')).join(' ');

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="mx-auto w-full max-w-[280px]" role="img" aria-label={STATS.map((s) => `${s} ${stats[s]}`).join(', ')}>
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={STATS.map((_, i) => point(i, f).join(',')).join(' ')} fill="none" stroke="rgba(56,189,248,0.15)" />
      ))}
      {STATS.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="rgba(56,189,248,0.12)" />;
      })}
      <polygon points={shape} fill="rgba(56,189,248,0.22)" stroke="var(--system)" strokeWidth="2" className="radar-shape" />
      {STATS.map((s, i) => {
        const [x, y] = point(i, 1.22);
        return (
          <text key={s} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-sys-dim font-mono text-[10px]">
            {s} <tspan className="fill-sys">{stats[s]}</tspan>
          </text>
        );
      })}
    </svg>
  );
}
