/** Gates: real-world events found by TinyFish (sample list until the API exists). */
import { RankBadge } from '../../components/system/Bits';
import { SampleNotice } from '../../components/system/SampleNotice';
import { SystemWindow } from '../../components/system/SystemWindow';
import { getGates } from '../../lib/ui/samples';

export default function GatesPage() {
  const gates = getGates();
  return (
    <div className="mx-auto max-w-3xl">
      <SystemWindow title="Gates Detected">
        <SampleNotice what="Gates (TinyFish)" />
        <p className="mb-4 text-sm text-sys-dim">
          Real events near you become dungeons. Clear a Gate by checking in with a photo for CHA.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {gates.map((g) => (
            <li key={g.title} className="flex gap-3 rounded-lg border border-sys/20 p-3">
              <RankBadge rank={g.rank} />
              <div className="min-w-0">
                <p className="text-sys-text">{g.title}</p>
                <p className="mt-1 font-mono text-[11px] text-sys-dim">{g.date}</p>
                <p className="font-mono text-[11px] text-sys-dim">{g.location}</p>
                {g.url && (
                  <a href={g.url} target="_blank" rel="noreferrer" className="mt-1 inline-block font-mono text-xs text-sys hover:underline">
                    Event page ↗
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </SystemWindow>
    </div>
  );
}
