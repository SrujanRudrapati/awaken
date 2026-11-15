'use client';
/** / — the OATH scroll site (port of design/oath.html): seven sections over a particle field that morphs as you scroll. */
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { IrisGlyph } from '../oath/IrisGlyph';
import { BoardDemo, Countdown, VowDemo } from './demos';
import './landing.css';
import { ParticleField, type FieldProgress } from './ParticleField';
import { SECTION_LOOKS } from './shapes';

const SECTION_IDS = ['hero', 'vow', 'proof', 'ascend', 'const', 'reckon', 'cta'] as const;
const RANKS = ['E', 'D', 'C', 'B', 'A'] as const;
const DEMO_RANK = 'C';
const SENSORS = [
  { glyph: '◇', name: 'Rep Pad', note: 'Depth-verified reps' },
  { glyph: '◷', name: 'Watch', note: 'Motion + Health' },
  { glyph: '▣', name: 'Phone Lock', note: "Focus you can't fake" },
  { glyph: '◐', name: 'Light + Sound', note: 'Sleep and silence' },
  { glyph: '✦', name: 'Chapter Test', note: 'Timed, AI-generated' },
  { glyph: '◎', name: 'Photo Proof', note: 'Judged by vision AI' },
] as const;
const MARQUEE = ['Proven, not claimed', 'Every rep counted', 'Every page tested', 'Every hour locked'] as const;
const LOADER_STEP_MS = 45;

interface SectionProps {
  index: number;
  className: string;
  isIn: boolean;
  register: (index: number, element: HTMLElement | null) => void;
}

function Section({ index, className, isIn, register, children }: SectionProps & { children: ReactNode }) {
  return (
    <section id={SECTION_IDS[index]} ref={(element) => register(index, element)} className={`l-section ${className}`} data-in={isIn ? '' : undefined}>
      {children}
    </section>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0L14 8L8 16L2 8Z" fill="none" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="1.6" fill="currentColor" /></svg>
  );
}

export function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const cursorRef = useRef<HTMLDivElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const [onScreen, setOnScreen] = useState<ReadonlySet<number>>(new Set());
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [hasField, setHasField] = useState(true);
  const isIntroDone = loaded >= 100;

  // loader: counts to 100, then lifts
  useEffect(() => {
    const timer = setInterval(() => setLoaded((value) => Math.min(100, value + Math.ceil(Math.random() * 9))), LOADER_STEP_MS);
    return () => clearInterval(timer);
  }, []);

  const getProgress = useCallback((): FieldProgress => {
    const middle = window.innerHeight * 0.5;
    let section = 0;
    sectionRefs.current.forEach((element, index) => {
      if (element && element.getBoundingClientRect().top <= middle) section = index;
    });
    const box = sectionRefs.current[section]?.getBoundingClientRect();
    const local = box ? Math.min(1, Math.max(0, (middle - box.top) / box.height)) : 0;
    return { section, mix: Math.min(1, Math.max(0, (local - 0.55) / 0.45)) };
  }, []);

  // reveals + which demos run
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const index = sectionRefs.current.indexOf(entry.target as HTMLElement);
          if (index < 0) return;
          setOnScreen((current) => {
            const next = new Set(current);
            if (entry.isIntersecting) next.add(index);
            else next.delete(index);
            return next;
          });
          if (entry.isIntersecting) setSeen((current) => (current.has(index) ? current : new Set(current).add(index)));
        });
      },
      { threshold: 0.25 },
    );
    sectionRefs.current.forEach((element) => element && observer.observe(element));
    return () => observer.disconnect();
  }, []);

  // progress dots + accent colour follow the section in the middle of the screen
  useEffect(() => {
    const onScroll = (): void => setActive(getProgress().section);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [getProgress]);

  // cursor, glass light and magnetic buttons (mouse only)
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !window.matchMedia('(hover: hover)').matches) return;
    const halo = { x: window.innerWidth / 2, y: window.innerHeight / 2, targetX: window.innerWidth / 2, targetY: window.innerHeight / 2 };
    let raf = 0;
    const follow = (): void => {
      halo.x += (halo.targetX - halo.x) * 0.16;
      halo.y += (halo.targetY - halo.y) * 0.16;
      if (haloRef.current) haloRef.current.style.transform = `translate(${halo.x}px, ${halo.y}px)`;
      raf = Math.abs(halo.targetX - halo.x) + Math.abs(halo.targetY - halo.y) > 0.3 ? requestAnimationFrame(follow) : 0;
    };
    const onMove = (event: PointerEvent): void => {
      halo.targetX = event.clientX;
      halo.targetY = event.clientY;
      if (cursorRef.current) cursorRef.current.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
      if (!raf) raf = requestAnimationFrame(follow);
      root.querySelectorAll<HTMLElement>('.glass').forEach((element) => {
        const box = element.getBoundingClientRect();
        if (box.bottom < 0 || box.top > window.innerHeight) return;
        element.style.setProperty('--mx', `${event.clientX - box.left}px`);
        element.style.setProperty('--my', `${event.clientY - box.top}px`);
      });
      const hovered = (event.target as Element | null)?.closest?.('[data-hover]');
      haloRef.current?.toggleAttribute('data-big', Boolean(hovered));
      root.querySelectorAll<HTMLElement>('[data-mag]').forEach((element) => {
        if (element !== hovered) {
          element.style.transform = '';
          return;
        }
        const box = element.getBoundingClientRect();
        element.style.transform = `translate(${(event.clientX - box.left - box.width / 2) * 0.3}px, ${(event.clientY - box.top - box.height / 2) * 0.4}px)`;
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const handleAnchor = (event: React.MouseEvent<HTMLAnchorElement>): void => {
    const id = event.currentTarget.getAttribute('href')?.slice(1);
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    event.preventDefault();
    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: isReduced ? 'auto' : 'smooth' });
  };

  const register = useCallback((index: number, element: HTMLElement | null) => {
    sectionRefs.current[index] = element;
  }, []);
  const section = (index: number, className = ''): SectionProps => ({ index, className, isIn: seen.has(index) && isIntroDone, register });
  const accent = SECTION_LOOKS[active]?.color ?? SECTION_LOOKS[0].color;

  return (
    <div ref={rootRef} className="landing" style={{ ['--a' as string]: accent }}>
      <div className="l-loader" data-out={isIntroDone || undefined} aria-hidden="true">
        <div className="l-loader-num">{String(loaded).padStart(3, '0')}</div>
        <div className="mono l-loader-text">Oath / calibrating<br />Proven, not claimed.</div>
      </div>

      {hasField ? (
        <ParticleField getProgress={getProgress} isIntroDone={isIntroDone} onUnavailable={() => setHasField(false)} />
      ) : (
        <div className="l-fallback" aria-hidden="true"><div className="aura" /><IrisGlyph mood="watching" size={220} /></div>
      )}
      <div className="veil" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <div ref={cursorRef} className="l-cur" aria-hidden="true" />
      <div ref={haloRef} className="l-cur2" aria-hidden="true" />

      <nav className="l-nav mono" aria-label="OATH">
        <a href="#hero" className="l-logo" onClick={handleAnchor}><Logo />OATH</a>
        <div className="l-navr">
          <a href="#vow" data-hover onClick={handleAnchor}>Vows</a>
          <a href="#proof" data-hover onClick={handleAnchor}>Proof</a>
          <a href="#ascend" data-hover onClick={handleAnchor}>Ranks</a>
          <a href="#const" data-hover onClick={handleAnchor}>Constellations</a>
          <Link href="/calibrate" className="l-go" data-hover>Take the Oath ↗</Link>
        </div>
      </nav>
      <div className="l-progress" aria-hidden="true">
        {SECTION_IDS.map((id, index) => <i key={id} data-on={index === active || undefined} />)}
      </div>

      <main className="l-scroll">
        <Section {...section(0)}>
          <div className="l-col">
            <div className="kick mono">The Arbiter is watching</div>
            <h1 className="l-h1"><span className="l-line"><span>Take the</span></span><span className="l-line"><span className="serif">Oath.</span></span></h1>
            <p className="lede l-fade l-d2">Make a vow. Keep it. Every rep, page and hour of focus is checked by sensors and AI before it counts. Proven, not claimed.</p>
            <Link href="/calibrate" className="btn mono l-fade l-d3 l-btn" data-hover data-mag><i className="dot" />Begin calibration</Link>
          </div>
          <div className="l-scrollhint mono"><i />Scroll</div>
          <div className="l-meta mono">Arbiter online<br />Watch · Phone · Home Base</div>
        </Section>

        <div className="l-marquee" aria-hidden="true">
          <div className="l-marquee-track">
            {[0, 1].map((copy) => (
              <span key={copy}>{MARQUEE.map((phrase) => <span key={phrase}>{phrase} <b>◆</b></span>)}</span>
            ))}
          </div>
        </div>

        <Section {...section(1, 'l-right')}>
          <div className="l-col">
            <div className="kick mono">01 — The vow</div>
            <h2 className="l-h2"><span className="l-line"><span>Say it.</span></span><span className="l-line"><span className="serif">Then prove it.</span></span></h2>
            <p className="lede l-fade l-d1">Each morning the Arbiter sets your vows: push-ups, a chapter, a focus block, lights out. Your effort is measured as it happens.</p>
            <VowDemo isActive={onScreen.has(1) && isIntroDone} />
          </div>
        </Section>

        <Section {...section(2)}>
          <div className="l-col l-col-wide">
            <div className="kick mono">02 — The proof</div>
            <h2 className="l-h2"><span className="l-line"><span>Nothing counts</span></span><span className="l-line"><span className="serif">on your word.</span></span></h2>
            <p className="lede l-fade l-d1">A pressure pad that knows a half rep. A watch that feels every movement. A lockbox that holds your phone while you read. AI that checks the rest.</p>
            <div className="l-grid">
              {SENSORS.map((sensor, index) => (
                <div key={sensor.name} className={`l-cell glass l-fade l-d${Math.floor(index / 2) + 1}`}>
                  <div className="l-cell-icon" aria-hidden="true">{sensor.glyph}</div>
                  <div><b>{sensor.name}</b><span>{sensor.note}</span></div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <Section {...section(3, 'l-right')}>
          <div className="l-col">
            <div className="kick mono">03 — Ascension</div>
            <h2 className="l-h2"><span className="l-line"><span>Five ranks.</span></span><span className="l-line"><span className="serif">Earned by growth.</span></span></h2>
            <p className="lede l-fade l-d1">Your calibration sets where you start. From there you climb by beating your own baselines, so a retiree who reads every night can outshine an athlete.</p>
            <div className="l-tiers mono l-fade l-d2">
              {RANKS.map((rank) => (
                <span key={rank} className="l-tier" data-state={rank === DEMO_RANK ? 'now' : RANKS.indexOf(rank) < RANKS.indexOf(DEMO_RANK) ? 'done' : undefined}>Rank {rank}</span>
              ))}
            </div>
            <div className="l-proof l-fade l-d3">
              <div className="l-proof-row mono"><span>Power 96</span><span>Rank B at 140</span></div>
              <div className="track"><i style={{ transform: `scaleX(${seen.has(3) && isIntroDone ? 0.62 : 0})` }} /></div>
            </div>
          </div>
        </Section>

        <Section {...section(4)}>
          <div className="l-col">
            <div className="kick mono">04 — Constellations</div>
            <h2 className="l-h2"><span className="l-line"><span>Thirty people.</span></span><span className="l-line"><span className="serif">One sky.</span></span></h2>
            <p className="lede l-fade l-d1">Each week you join a constellation of people at your level. Only proven work counts, so this is the first leaderboard nobody can cheat.</p>
            <BoardDemo isActive={seen.has(4) && isIntroDone} />
          </div>
        </Section>

        <Section {...section(5, 'l-right l-reckon')}>
          <div className="l-col">
            <div className="kick mono">05 — The Reckoning</div>
            <h2 className="l-h2"><span className="l-line"><span>Break a vow,</span></span><span className="l-line"><span className="serif l-red">face it.</span></span></h2>
            <p className="lede l-fade l-d1">Miss a day and the Reckoning begins: an alarm that won&rsquo;t stop until you finish thirty squats. Your streak is on the line.</p>
            <Countdown isActive={onScreen.has(5)} />
          </div>
        </Section>

        <Section {...section(6, 'l-center l-cta')}>
          <div className="l-col l-col-cta">
            <div className="kick mono">Calibration · 5 minutes</div>
            <h1 className="l-h1"><span className="l-line"><span>Become</span></span><span className="l-line"><span className="serif">proven.</span></span></h1>
            <p className="lede l-fade l-d2">Four short tests across body, vitality, mind and focus. The Arbiter sets your starting rank. Everything after that is up to you.</p>
            <Link href="/calibrate" className="btn mono l-fade l-d3 l-btn" data-hover data-mag><i className="dot" />Take the Oath</Link>
          </div>
        </Section>
        <footer className="l-footer mono"><span>OATH — Proven, not claimed.</span><span><Link href="/today">Today</Link> · <Link href="/rank">Rank</Link> · <Link href="/band">Band</Link></span></footer>
      </main>
    </div>
  );
}
