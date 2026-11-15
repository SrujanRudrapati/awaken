'use client';
/**
 * The landing's living background: ≤ 22k particles morphing shape per section (plain WebGL port of
 * design/oath.html). DPR ≤ 1.75, paused when the tab is hidden, time frozen under prefers-reduced-motion,
 * and `onUnavailable` fires when WebGL cannot start so the page can show its static backdrop.
 */
import { useEffect, useRef } from 'react';
import { chain, lookAt, multiply, perspective, rotationX, rotationY, rotationZ, scaling, translation } from '../oath/gl/mat4';
import { bindAttribute, canvasDpr, compileProgram, runWhileVisible, staticBuffer } from '../oath/gl/program';
import { hexToRgb } from '../oath/moods';
import { SECTION_LOOKS, buildShapes } from './shapes';

export const MAX_PARTICLES = 22_000;
const PHONE_PARTICLES = 12_000;
const RING_POINTS = 3_000;
const DUST_POINTS = 2_600;
const PHONE_WIDTH = 860;
const CAMERA_Z = 8.5;
const FOV = 40;
/** On phones the field sits behind the copy, so it is drawn fainter. */
const PHONE_DIM = 0.5;

const FIELD_VS = `
uniform float uTime, uMix, uSize, uIntro, uGlitch, uDim;
uniform vec3 uMouse;
uniform mat4 uModel, uView, uProj;
attribute vec3 posA, posB, scat;
attribute float rnd;
varying float vA;
void main(){
  float m = smoothstep(0., 1., clamp((uMix - rnd * .25) / .75, 0., 1.));
  vec3 p = mix(posA, posB, m);
  p += scat * .12 * sin(m * 3.14159);
  p += vec3(sin(uTime * .8 + rnd * 40.), cos(uTime * .6 + rnd * 30.), sin(uTime * .5 + rnd * 20.)) * .02;
  float ii = smoothstep(0., 1., clamp((uIntro - rnd * .4) / .6, 0., 1.));
  p = mix(scat, p, ii);
  if (uGlitch > 0.) { float b = step(.88, fract(sin(floor(p.y * 9.) + floor(uTime * 8.)) * 43758.5)); p.x += b * uGlitch * (rnd - .5) * 1.4; }
  vec4 wp = uModel * vec4(p, 1.);
  vec2 d = wp.xy - uMouse.xy; float dist = length(d);
  if (dist < .6) { float f = (.6 - dist) / .6; wp.xy += normalize(d + .0001) * f * f * .4; wp.z += f * .5; }
  vec4 mv = uView * wp;
  gl_Position = uProj * mv;
  gl_PointSize = uSize * (.4 + rnd * .9) / -mv.z;
  float fog = exp(-pow(.055 * -mv.z, 2.));
  vA = (.25 + .55 * abs(sin(uTime * 1.3 + rnd * 60.))) * (.5 + .5 * rnd) * fog * uDim;
}`;

const FIELD_FS = `
precision mediump float;
uniform vec3 uColor;
varying float vA;
void main(){ float d = length(gl_PointCoord - .5); float a = smoothstep(.5, 0., d); a *= a; gl_FragColor = vec4(uColor * (1. + a * .7), a * vA); }`;

const DOT_VS = `
uniform mat4 uMvp; uniform float uSize;
attribute vec3 aPos;
void main(){ gl_Position = uMvp * vec4(aPos, 1.); gl_PointSize = max(1., uSize / gl_Position.w); }`;

const DOT_FS = `
precision mediump float;
uniform vec3 uColor; uniform float uAlpha;
void main(){ gl_FragColor = vec4(uColor, uAlpha); }`;

function randomArray(length: number, make: () => number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = make();
  return out;
}

function ringPoints(): Float32Array {
  const out = new Float32Array(RING_POINTS * 3);
  for (let i = 0; i < RING_POINTS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.6 + (Math.random() - 0.5) * 0.06;
    out[i * 3] = Math.cos(angle) * radius;
    out[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
    out[i * 3 + 2] = Math.sin(angle) * radius;
  }
  return out;
}

function dustPoints(): Float32Array {
  const out = new Float32Array(DUST_POINTS * 3);
  for (let i = 0; i < DUST_POINTS; i++) {
    out[i * 3] = (Math.random() - 0.5) * 40;
    out[i * 3 + 1] = (Math.random() - 0.5) * 26;
    out[i * 3 + 2] = -Math.random() * 30 + 4;
  }
  return out;
}

export interface FieldProgress {
  /** Index of the section under the middle of the viewport. */
  section: number;
  /** 0–1 morph toward the next section's shape. */
  mix: number;
}

interface ParticleFieldProps {
  /** Read every frame; keep it cheap. */
  getProgress: () => FieldProgress;
  isIntroDone: boolean;
  onUnavailable: () => void;
}

export function ParticleField({ getProgress, isIntroDone, onUnavailable }: ParticleFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ getProgress, isIntroDone, onUnavailable });

  useEffect(() => {
    live.current = { getProgress, isIntroDone, onUnavailable };
  }, [getProgress, isIntroDone, onUnavailable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'high-performance' });
    if (!gl) {
      live.current.onUnavailable();
      return;
    }
    let field: WebGLProgram;
    let dots: WebGLProgram;
    try {
      field = compileProgram(gl, FIELD_VS, FIELD_FS);
      dots = compileProgram(gl, DOT_VS, DOT_FS);
    } catch {
      live.current.onUnavailable();
      return;
    }

    const isReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const count = window.innerWidth < PHONE_WIDTH ? PHONE_PARTICLES : MAX_PARTICLES;
    const shapes = buildShapes(count);
    const bufferA = gl.createBuffer();
    const bufferB = gl.createBuffer();
    const scatter = staticBuffer(gl, randomArray(count * 3, () => (Math.random() - 0.5) * 16));
    const randoms = staticBuffer(gl, randomArray(count, Math.random));
    const ring = staticBuffer(gl, ringPoints());
    const dust = staticBuffer(gl, dustPoints());
    if (!bufferA || !bufferB) {
      live.current.onUnavailable();
      return;
    }

    let pair = -1;
    const setPair = (index: number): void => {
      if (index === pair) return;
      pair = index;
      gl.bindBuffer(gl.ARRAY_BUFFER, bufferA);
      gl.bufferData(gl.ARRAY_BUFFER, shapes[index], gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufferB);
      gl.bufferData(gl.ARRAY_BUFFER, shapes[Math.min(index + 1, shapes.length - 1)], gl.DYNAMIC_DRAW);
    };

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.clearColor(5 / 255, 6 / 255, 10 / 255, 1);

    const view = { projection: perspective(FOV, 1, 0.1, 100), aspect: 1, isPhone: false, pointScale: 38 };
    const resize = (): void => {
      const dpr = canvasDpr();
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      view.aspect = width / height;
      view.projection = perspective(FOV, view.aspect, 0.1, 100);
      view.isPhone = canvas.clientWidth < PHONE_WIDTH;
      view.pointScale = 38 * dpr * (canvas.clientHeight / 900);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const pointer = { x: 0, y: 0, isActive: false };
    const onPointerMove = (event: PointerEvent): void => {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
      pointer.isActive = event.pointerType === 'mouse';
    };
    const onPointerLeave = (): void => {
      pointer.isActive = false;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerleave', onPointerLeave);

    const locations = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
    const uniform = (program: WebGLProgram, name: string): WebGLUniformLocation | null => {
      const cache = locations.get(program) ?? new Map<string, WebGLUniformLocation | null>();
      locations.set(program, cache);
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name) ?? null;
    };
    const state = { x: 2.6, y: 0, scale: 1, color: hexToRgb(SECTION_LOOKS[0].color), glitch: 0, intro: isReduced ? 1 : 0, camX: 0, camY: 0, spin: 0 };

    const frame = (dt: number, elapsed: number): void => {
      const t = isReduced ? 0 : elapsed;
      const { section, mix } = live.current.getProgress();
      const index = Math.max(0, Math.min(SECTION_LOOKS.length - 1, section));
      const isLast = index >= SECTION_LOOKS.length - 1;
      const morph = isLast ? 0 : mix;
      setPair(index);

      const from = SECTION_LOOKS[index];
      const to = SECTION_LOOKS[Math.min(index + 1, SECTION_LOOKS.length - 1)];
      const eased = morph * morph * (3 - 2 * morph);
      const lerp = (a: number, b: number): number => a + (b - a) * eased;
      const follow = isReduced ? 1 : 0.08;
      state.x += ((view.isPhone ? 0 : lerp(from.x, to.x)) - state.x) * follow;
      state.y += ((view.isPhone ? 1.2 : 0) + lerp(from.y, to.y) - state.y) * follow;
      state.scale += ((view.isPhone ? 0.7 : 1) * lerp(from.scale, to.scale) - state.scale) * follow;
      const fromColor = hexToRgb(from.color);
      const toColor = hexToRgb(to.color);
      state.color = [0, 1, 2].map((i) => state.color[i] + (lerp(fromColor[i], toColor[i]) - state.color[i]) * follow) as [number, number, number];
      const glitchTarget = !isReduced && ((index === 5 && morph < 0.5) || (index === 4 && morph > 0.6)) ? 0.6 : 0;
      state.glitch += (glitchTarget - state.glitch) * 0.06;
      if (live.current.isIntroDone) state.intro = Math.min(1, state.intro + dt * 0.45);
      state.spin += dt * lerp(from.spin, to.spin) * (isReduced ? 0 : 1);
      state.camX += (pointer.x * 0.5 - state.camX) * 0.04;
      state.camY += (pointer.y * 0.3 - state.camY) * 0.04;

      const viewMatrix = lookAt([state.camX, state.camY, CAMERA_Z], [0, 0, 0]);
      const model = chain(translation(state.x, state.y, 0), rotationX(pointer.y * 0.08), rotationY(state.spin + pointer.x * 0.2), scaling(state.scale));
      const viewProjection = multiply(view.projection, viewMatrix);
      const halfHeight = Math.tan((FOV * Math.PI) / 360) * CAMERA_Z;

      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(dots);
      gl.uniformMatrix4fv(uniform(dots, 'uMvp'), false, multiply(viewProjection, translation(0, window.scrollY * 0.0015, 0)));
      gl.uniform3f(uniform(dots, 'uColor'), 0x4a / 255, 0x54 / 255, 0x70 / 255);
      gl.uniform1f(uniform(dots, 'uAlpha'), 0.6);
      gl.uniform1f(uniform(dots, 'uSize'), 0.018 * canvas.height);
      bindAttribute(gl, dots, 'aPos', dust, 3);
      gl.drawArrays(gl.POINTS, 0, DUST_POINTS);

      gl.uniformMatrix4fv(uniform(dots, 'uMvp'), false, chain(viewProjection, model, rotationX(1.3), rotationZ(t * 0.15)));
      gl.uniform3fv(uniform(dots, 'uColor'), state.color);
      gl.uniform1f(uniform(dots, 'uAlpha'), 0.55 * state.intro * (view.isPhone ? PHONE_DIM : 1));
      gl.uniform1f(uniform(dots, 'uSize'), 0.022 * canvas.height);
      bindAttribute(gl, dots, 'aPos', ring, 3);
      gl.drawArrays(gl.POINTS, 0, RING_POINTS);

      gl.useProgram(field);
      bindAttribute(gl, field, 'posA', bufferA, 3);
      bindAttribute(gl, field, 'posB', bufferB, 3);
      bindAttribute(gl, field, 'scat', scatter, 3);
      bindAttribute(gl, field, 'rnd', randoms, 1);
      gl.uniformMatrix4fv(uniform(field, 'uModel'), false, model);
      gl.uniformMatrix4fv(uniform(field, 'uView'), false, viewMatrix);
      gl.uniformMatrix4fv(uniform(field, 'uProj'), false, view.projection);
      gl.uniform1f(uniform(field, 'uTime'), t);
      gl.uniform1f(uniform(field, 'uMix'), morph);
      gl.uniform1f(uniform(field, 'uSize'), view.pointScale);
      gl.uniform1f(uniform(field, 'uIntro'), state.intro);
      gl.uniform1f(uniform(field, 'uGlitch'), state.glitch);
      gl.uniform1f(uniform(field, 'uDim'), view.isPhone ? PHONE_DIM : 1);
      gl.uniform3fv(uniform(field, 'uColor'), state.color);
      if (pointer.isActive) gl.uniform3f(uniform(field, 'uMouse'), pointer.x * halfHeight * view.aspect, pointer.y * halfHeight, 0);
      else gl.uniform3f(uniform(field, 'uMouse'), 99, 99, 0);
      gl.drawArrays(gl.POINTS, 0, count);
    };

    const stop = runWhileVisible(canvas, frame);
    const onContextLost = (event: Event): void => {
      event.preventDefault();
      live.current.onUnavailable();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      stop();
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('webglcontextlost', onContextLost);
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-field" aria-hidden="true" />;
}
