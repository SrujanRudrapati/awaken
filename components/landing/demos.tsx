'use client';
/** The small live demos inside the landing sections. Each runs only while its section is on screen. */
import { useEffect, useState } from 'react';

const VOW_TARGET = 20;
const VOW_TICK_MS = 850;
const VOW_REJECT_EVERY = 6;
const VOW_REST_TICKS = 5;

/** A vow being kept: the counter climbs, and every sixth rep is thrown out. */
export function VowDemo({ isActive }: { isActive: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setTick((value) => value + 1), VOW_TICK_MS);
    return () => clearInterval(timer);
  }, [isActive]);

  const ticksToFinish = Math.ceil((VOW_TARGET * VOW_REJECT_EVERY) / (VOW_REJECT_EVERY - 1));
  const cycle = tick % (ticksToFinish + VOW_REST_TICKS);
  const step = Math.min(cycle, ticksToFinish);
  const count = Math.min(VOW_TARGET, step - Math.floor(step / VOW_REJECT_EVERY));
  const isRejected = step > 0 && step % VOW_REJECT_EVERY === 0 && cycle <= ticksToFinish && count < VOW_TARGET;
  const secondsLeft = Math.max(0, 30 - step);

  return (
    <div className="l-vow glass l-fade l-d2">
      <div className="l-vow-top mono"><span>Vow · Body</span><span>0:{String(secondsLeft).padStart(2, '0')}</span></div>
      <div className="l-ctr"><div className="l-ctr-n">{String(count).padStart(2, '0')}</div><div className="mono l-ctr-of">/ {VOW_TARGET} push-ups</div></div>
      <div className="track"><i style={{ transform: `scaleX(${count / VOW_TARGET})` }} /></div>
      <div className="l-rej mono" data-on={isRejected || undefined}>✕ Not counted — go deeper</div>
    </div>
  );
}

const BOARD = [
  { name: 'A. Okafor', note: 'Reader · 9 chapters', proof: 2410 },
  { name: 'L. Mendes', note: 'Runner · 31 km', proof: 2290 },
  { name: 'R. Iyer', note: 'Student · 14 h focus', proof: 2105 },
  { name: 'You', note: 'Push-ups · chapters', proof: 1860 },
  { name: 'J. Park', note: 'Retiree · daily walks', proof: 1990 },
  { name: 'S. Haddad', note: 'Night shift · sleep', proof: 1720 },
] as const;
const ME = 3;
const ORDER_BEFORE = [0, 1, 2, 4, 3, 5];
const ORDER_AFTER = [0, 1, 3, 2, 4, 5];
const ROW_PX = 58;
const CLIMB_DELAY_MS = 1_400;

/** The Constellation board: you prove more, you pass someone. */
export function BoardDemo({ isActive }: { isActive: boolean }) {
  const [hasClimbed, setHasClimbed] = useState(false);
  useEffect(() => {
    if (!isActive || hasClimbed) return;
    const timer = setTimeout(() => setHasClimbed(true), CLIMB_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isActive, hasClimbed]);

  const order = hasClimbed ? ORDER_AFTER : ORDER_BEFORE;
  return (
    <div className="l-board glass l-fade l-d2">
      <div className="l-board-list" style={{ height: BOARD.length * ROW_PX }}>
        {BOARD.map((row, index) => {
          const position = order.indexOf(index);
          const proof = index === ME && hasClimbed ? 2140 : row.proof;
          return (
            <div key={row.name} className="l-board-row" data-me={index === ME || undefined} style={{ transform: `translateY(${position * ROW_PX}px)` }}>
              <span className="mono l-board-pos">{String(position + 1).padStart(2, '0')}</span>
              <div><div className="l-board-name">{row.name}</div><small>{row.note}</small></div>
              <span className="mono">{proof.toLocaleString('en-US')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const RECKONING_START_S = 7_182;

/** The Reckoning clock, always running down. */
export function Countdown({ isActive }: { isActive: boolean }) {
  const [seconds, setSeconds] = useState(RECKONING_START_S);
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setSeconds((value) => Math.max(0, value - 1)), 1_000);
    return () => clearInterval(timer);
  }, [isActive]);
  const text = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, '0')).join(':');
  return <div className="l-cd mono l-fade l-d2">{text}</div>;
}
