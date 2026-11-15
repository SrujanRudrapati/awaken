'use client';
/**
 * Iris in 3D: a glass shard with a living eye (port of design/iris.html to plain WebGL — no 3D library).
 * Renders at DPR ≤ 1.75, pauses when off screen or the tab is hidden, and calls `onUnavailable` when WebGL
 * cannot start or the context is lost so the caller can fall back to the 2D glyph.
 */
import { useEffect, useRef } from 'react';
import type { IrisMood } from '../../lib/irisMood';
import { chain, lookAt, multiply, perspective, rotationX, rotationY, rotationZ, scaling, translation, type Mat4 } from './gl/mat4';
import { bindAttribute, canvasDpr, compileProgram, runWhileVisible, staticBuffer } from './gl/program';
import { MOOD_LOOK, hexToRgb } from './moods';

const GLASS_VS = `
attribute vec3 aPos; attribute vec3 aNor;
uniform mat4 uModel, uView, uProj;
varying vec3 vP; varying vec3 vW; varying vec3 vN;
void main(){
  vec4 w = uModel * vec4(aPos, 1.);
  vW = w.xyz;
  vec4 v = uView * w;
  vP = v.xyz;
  vN = (uView * uModel * vec4(aNor, 0.)).xyz;
  gl_Position = uProj * v;
}`;

const GLASS_FS = `
precision highp float;
uniform vec3 uCol; uniform float uTime, uFlick, uBack;
varying vec3 vP; varying vec3 vW; varying vec3 vN;
void main(){
  vec3 n = normalize(vN); if (uBack > .5) n = -n;
  vec3 v = normalize(-vP);
  float fr = pow(1. - abs(dot(n, v)), 2.2);
  vec3 L1 = normalize(vec3(-.5, .8, .6)), L2 = normalize(vec3(.7, -.2, .5));
  float d1 = max(dot(n, L1), 0.), d2 = max(dot(n, L2), 0.);
  float spec = pow(max(dot(reflect(-L1, n), v), 0.), 40.) * .9 + pow(max(dot(reflect(-L2, n), v), 0.), 24.) * .5;
  float streak = smoothstep(.985, 1., sin(vW.x * 2. + vW.y * 3. - uTime * .6)) * .35;
  vec3 base = mix(vec3(.04, .06, .1), uCol, .18 + d1 * .25 + d2 * .12);
  vec3 c = base + uCol * fr * (1.1 + uFlick) + vec3(spec + streak);
  float a = uBack > .5 ? .22 + fr * .25 : .16 + fr * .55 + spec * .6;
  a = clamp(a, 0., 1.);
  gl_FragColor = vec4(c * a, a);
}`;

const EYE_VS = `
attribute vec2 aPos;
uniform mat4 uMvp;
varying vec2 vUv;
void main(){ vUv = aPos * .5 + .5; gl_Position = uMvp * vec4(aPos * .875, 0., 1.); }`;

const EYE_FS = `
precision highp float;
uniform vec3 uCol; uniform float uLid, uPupil, uSpeak; uniform vec2 uLook;
varying vec2 vUv;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 p = vUv - .5;
  float hh = uLid * .30 * (1. - pow(abs(p.x) / .44, 2.));
  float almond = smoothstep(.006, -.006, abs(p.y) - hh) * step(abs(p.x), .44);
  vec2 q = p - uLook * .11; float d = length(q), a = atan(q.y, q.x);
  float ir = .17;
  float fib = .55 + .45 * sin(a * 48. + h(vec2(floor(a * 48. / 6.283))) * 6.) * smoothstep(ir, .03, d);
  vec3 iris = mix(uCol * 1.6, uCol * .35, smoothstep(.02, ir, d)) * fib;
  iris += uCol * smoothstep(ir, ir - .012, d) * smoothstep(ir - .03, ir, d) * 1.6;
  float pr = uPupil * (1. + uSpeak * .25);
  float pupil = smoothstep(pr, pr - .008, d);
  vec3 col = mix(vec3(.02, .03, .06) + uCol * .08, iris, smoothstep(ir + .004, ir - .004, d));
  col = mix(col, vec3(0.), pupil);
  col += smoothstep(.03, .0, length(q - vec2(-.05, .05))) * .95;
  float lidline = smoothstep(.012, 0., abs(abs(p.y) - hh)) * step(abs(p.x), .44) * (uLid < .02 ? 1.6 : .9);
  vec3 rim = uCol * lidline * (1.3 + uSpeak);
  float halo = exp(-length(p * vec2(1., 2.2)) * 7.) * .35 * (.4 + uLid);
  vec3 o = col * almond + rim + uCol * halo;
  float al = clamp(max(almond, max(lidline, halo)), 0., 1.);
  gl_FragColor = vec4(o * al, al);
}`;

const FLAT_VS = `
attribute vec3 aPos;
uniform mat4 uMvp; uniform float uSize;
void main(){ gl_Position = uMvp * vec4(aPos, 1.); gl_PointSize = uSize; }`;

/** Additive, premultiplied: alpha 0 so it only brightens what is behind it. */
const FLAT_FS = `
precision mediump float;
uniform vec3 uCol; uniform float uAlpha, uRound;
void main(){
  float a = uAlpha;
  if (uRound > .5) { float d = length(gl_PointCoord - .5); a *= smoothstep(.5, .1, d); }
  gl_FragColor = vec4(uCol * a, 0.);
}`;

type Vec3 = [number, number, number];

const CRYSTAL_VERTICES: Vec3[] = [[0, 2, 0], [0, -2, 0], [1.25, 0, 0], [-1.25, 0, 0], [0, 0, 1.25], [0, 0, -1.25]];
const CRYSTAL_FACES: Vec3[] = [[0, 4, 2], [0, 3, 4], [0, 5, 3], [0, 2, 5], [1, 2, 4], [1, 4, 3], [1, 3, 5], [1, 5, 2]];
const CRYSTAL_EDGES: [number, number][] = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5], [2, 4], [4, 3], [3, 5], [5, 2]];
const RINGS = [{ radius: 1.9, tiltX: 1.35, tiltZ: 0.2, alpha: 0.45, speed: 0.35 }, { radius: 2.25, tiltX: 1.5, tiltZ: -0.35, alpha: 0.25, speed: -0.55 }];
const RING_SEGMENTS = 160;
const SPARK_COUNT = 240;
const CAMERA_DISTANCE = 9.4;

/** Interleaved position + outward flat normal, 3 vertices per face. */
function crystalTriangles(): Float32Array {
  const out: number[] = [];
  for (const [ia, ib, ic] of CRYSTAL_FACES) {
    const a = CRYSTAL_VERTICES[ia];
    let b = CRYSTAL_VERTICES[ib];
    let c = CRYSTAL_VERTICES[ic];
    const normalOf = (p: Vec3, q: Vec3): Vec3 => {
      const u: Vec3 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const w: Vec3 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    };
    let n = normalOf(b, c);
    const centroid: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (n[0] * centroid[0] + n[1] * centroid[1] + n[2] * centroid[2] < 0) {
      [b, c] = [c, b];
      n = normalOf(b, c);
    }
    const length = Math.hypot(n[0], n[1], n[2]);
    for (const vertex of [a, b, c]) out.push(...vertex, n[0] / length, n[1] / length, n[2] / length);
  }
  return new Float32Array(out);
}

function ringStrip(radius: number): Float32Array {
  const out = new Float32Array((RING_SEGMENTS + 1) * 3);
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const angle = (i / RING_SEGMENTS) * Math.PI * 2;
    out[i * 3] = Math.cos(angle) * radius;
    out[i * 3 + 1] = Math.sin(angle) * radius;
  }
  return out;
}

function sparkDirections(): Vec3[] {
  return Array.from({ length: SPARK_COUNT }, () => {
    const v: Vec3 = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
    const length = Math.hypot(...v) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  });
}

interface IrisCanvasProps {
  mood: IrisMood;
  isSpeaking?: boolean;
  onUnavailable: () => void;
}

export function IrisCanvas({ mood, isSpeaking = false, onUnavailable }: IrisCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ mood, isSpeaking, sparkAge: 9 });
  const unavailable = useRef(onUnavailable);

  useEffect(() => {
    if (mood === 'proud' && live.current.mood !== 'proud') live.current.sparkAge = 0;
    live.current.mood = mood;
    live.current.isSpeaking = isSpeaking;
    unavailable.current = onUnavailable;
  }, [mood, isSpeaking, onUnavailable]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, powerPreference: 'high-performance' });
    if (!gl) {
      unavailable.current();
      return;
    }

    let glass: WebGLProgram;
    let eye: WebGLProgram;
    let flat: WebGLProgram;
    try {
      glass = compileProgram(gl, GLASS_VS, GLASS_FS);
      eye = compileProgram(gl, EYE_VS, EYE_FS);
      flat = compileProgram(gl, FLAT_VS, FLAT_FS);
    } catch {
      unavailable.current();
      return;
    }

    const crystalBuffer = staticBuffer(gl, crystalTriangles());
    const edgeBuffer = staticBuffer(gl, new Float32Array(CRYSTAL_EDGES.flatMap(([a, b]) => [...CRYSTAL_VERTICES[a], ...CRYSTAL_VERTICES[b]])));
    const quadBuffer = staticBuffer(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]));
    const ringBuffers = RINGS.map((ring) => staticBuffer(gl, ringStrip(ring.radius)));
    const dotBuffer = staticBuffer(gl, new Float32Array([0, 0, 0]));
    const sparks = sparkDirections();
    const sparkData = new Float32Array(SPARK_COUNT * 3);
    const sparkBuffer = gl.createBuffer();

    const uniform = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, name);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    let projection: Mat4 = perspective(35, 1, 0.1, 100);
    const resize = (): void => {
      const dpr = canvasDpr();
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
      projection = perspective(35, width / height, 0.1, 100);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    resize();

    const pointer = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent): void => {
      const box = canvas.getBoundingClientRect();
      pointer.x = Math.max(-1, Math.min(1, (event.clientX - (box.left + box.width / 2)) / (window.innerWidth / 2)));
      pointer.y = Math.max(-1, Math.min(1, -(event.clientY - (box.top + box.height / 2)) / (window.innerHeight / 2)));
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    const state = { color: hexToRgb(MOOD_LOOK[live.current.mood].color), lid: MOOD_LOOK[live.current.mood].lid, pupil: 0.08, lookX: 0, lookY: 0, speak: 0, blink: 0, blinkIn: 2.5, camX: 0, camY: 0, shakeX: 0 };

    const drawFlat = (buffer: WebGLBuffer, mvp: Mat4, mode: number, count: number, alpha: number, size = 1, isRound = false, color = state.color): void => {
      gl.useProgram(flat);
      bindAttribute(gl, flat, 'aPos', buffer, 3);
      gl.uniformMatrix4fv(uniform(flat, 'uMvp'), false, mvp);
      gl.uniform3fv(uniform(flat, 'uCol'), color);
      gl.uniform1f(uniform(flat, 'uAlpha'), alpha);
      gl.uniform1f(uniform(flat, 'uSize'), size);
      gl.uniform1f(uniform(flat, 'uRound'), isRound ? 1 : 0);
      gl.drawArrays(mode, 0, count);
    };

    const frame = (dt: number, t: number): void => {
      const { mood: currentMood, isSpeaking: speaking } = live.current;
      const look = MOOD_LOOK[currentMood];
      const target = hexToRgb(look.color);
      state.color = [0, 1, 2].map((i) => state.color[i] + (target[i] - state.color[i]) * 0.06) as [number, number, number];

      state.blinkIn -= dt;
      if (state.blinkIn < 0 && currentMood !== 'sleepy' && currentMood !== 'proud') {
        state.blink = 1;
        state.blinkIn = 2.6 + Math.random() * 3;
      }
      state.blink = Math.max(0, state.blink - dt * 7);
      const lidTarget = look.lid * (1 - Math.sin(Math.min(1, state.blink) * Math.PI) * 0.95);
      state.lid += (lidTarget - state.lid) * 0.2;
      const speakTarget = speaking ? 0.5 + 0.5 * Math.abs(Math.sin(t * 10) * Math.sin(t * 4.3)) : 0;
      state.speak += (speakTarget - state.speak) * 0.25;
      state.pupil += (look.pupil - state.pupil) * 0.08;
      const isAsleep = currentMood === 'sleepy';
      state.lookX += ((isAsleep ? 0 : pointer.x) - state.lookX) * 0.12;
      state.lookY += ((isAsleep ? 0 : pointer.y) - state.lookY) * 0.12;
      state.shakeX = currentMood === 'furious' ? (Math.random() - 0.5) * 0.03 : state.shakeX * 0.8;
      state.camX += (pointer.x * 0.5 - state.camX) * 0.04;
      state.camY += (pointer.y * 0.3 - state.camY) * 0.04;
      const flicker = currentMood === 'furious' && Math.random() < 0.12 ? 0.8 : 0;
      const bob = Math.sin(t * 0.9 * (isAsleep ? 0.6 : 1)) * 0.12;

      const view = lookAt([state.camX, 0.15 + state.camY, CAMERA_DISTANCE], [0, 0, 0]);
      const viewProjection = multiply(projection, view);
      const model = chain(translation(state.shakeX, bob, 0), rotationX(-pointer.y * 0.12), rotationY(t * 0.22 + pointer.x * 0.35), scaling(1 + state.speak * 0.025));

      gl.clear(gl.COLOR_BUFFER_BIT);

      // rings + orbit dots (additive)
      RINGS.forEach((ring, index) => {
        const ringModel = chain(rotationY(t * 0.18), rotationX(ring.tiltX), rotationZ(ring.tiltZ));
        const mvp = multiply(viewProjection, ringModel);
        drawFlat(ringBuffers[index], mvp, gl.LINE_STRIP, RING_SEGMENTS + 1, ring.alpha);
        const angle = t * ring.speed;
        const dotMvp = multiply(mvp, translation(Math.cos(angle) * ring.radius, Math.sin(angle) * ring.radius, 0));
        drawFlat(dotBuffer, dotMvp, gl.POINTS, 1, 1, 7 * canvasDpr(), true, [1, 1, 1]);
      });

      // crystal: back faces, eye, front faces, edges
      gl.enable(gl.CULL_FACE);
      const drawGlass = (isBack: boolean): void => {
        gl.useProgram(glass);
        bindAttribute(gl, glass, 'aPos', crystalBuffer, 3, 24, 0);
        bindAttribute(gl, glass, 'aNor', crystalBuffer, 3, 24, 12);
        gl.uniformMatrix4fv(uniform(glass, 'uModel'), false, model);
        gl.uniformMatrix4fv(uniform(glass, 'uView'), false, view);
        gl.uniformMatrix4fv(uniform(glass, 'uProj'), false, projection);
        gl.uniform3fv(uniform(glass, 'uCol'), state.color);
        gl.uniform1f(uniform(glass, 'uTime'), t);
        gl.uniform1f(uniform(glass, 'uFlick'), flicker);
        gl.uniform1f(uniform(glass, 'uBack'), isBack ? 1 : 0);
        gl.cullFace(isBack ? gl.FRONT : gl.BACK);
        gl.drawArrays(gl.TRIANGLES, 0, CRYSTAL_FACES.length * 3);
      };
      drawGlass(true);

      gl.disable(gl.CULL_FACE);
      gl.useProgram(eye);
      bindAttribute(gl, eye, 'aPos', quadBuffer, 2);
      gl.uniformMatrix4fv(uniform(eye, 'uMvp'), false, multiply(viewProjection, translation(state.shakeX, bob, 0.05)));
      gl.uniform3fv(uniform(eye, 'uCol'), state.color);
      gl.uniform1f(uniform(eye, 'uLid'), state.lid);
      gl.uniform1f(uniform(eye, 'uPupil'), state.pupil);
      gl.uniform1f(uniform(eye, 'uSpeak'), state.speak);
      gl.uniform2f(uniform(eye, 'uLook'), state.lookX, state.lookY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.enable(gl.CULL_FACE);
      drawGlass(false);
      gl.disable(gl.CULL_FACE);
      drawFlat(edgeBuffer, multiply(viewProjection, model), gl.LINES, CRYSTAL_EDGES.length * 2, 0.55);

      // sparks on "proud"
      live.current.sparkAge += dt;
      const sparkAlpha = Math.max(0, 1 - live.current.sparkAge / 1.6);
      if (sparkAlpha > 0 && sparkBuffer) {
        sparks.forEach((direction, i) => {
          const radius = 0.4 + live.current.sparkAge * (1.6 + (i % 7) * 0.25);
          sparkData[i * 3] = direction[0] * radius;
          sparkData[i * 3 + 1] = direction[1] * radius * 1.3 + bob;
          sparkData[i * 3 + 2] = direction[2] * radius;
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, sparkData, gl.DYNAMIC_DRAW);
        drawFlat(sparkBuffer, viewProjection, gl.POINTS, SPARK_COUNT, sparkAlpha, 5 * canvasDpr(), true, hexToRgb(MOOD_LOOK.proud.color));
      }
    };

    const stop = runWhileVisible(canvas, frame);
    const onContextLost = (event: Event): void => {
      event.preventDefault();
      unavailable.current();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      stop();
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('webglcontextlost', onContextLost);
    };
  }, []);

  return <canvas ref={canvasRef} className="iris-canvas" aria-hidden="true" />;
}
