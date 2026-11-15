/** WebGL boilerplate shared by the Iris crystal and the particle field. */
export function compileProgram(gl: WebGLRenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('WebGL program unavailable');
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('WebGL shader unavailable');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader failed to compile');
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Program failed to link');
  return program;
}

export function staticBuffer(gl: WebGLRenderingContext, data: Float32Array): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('WebGL buffer unavailable');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  return buffer;
}

export function bindAttribute(gl: WebGLRenderingContext, program: WebGLProgram, name: string, buffer: WebGLBuffer, size: number, stride = 0, offset = 0): void {
  const location = gl.getAttribLocation(program, name);
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
}

/** Max device-pixel ratio any OATH canvas renders at (60 fps budget). */
export const MAX_DPR = 1.75;

export function canvasDpr(): number {
  return Math.min(MAX_DPR, window.devicePixelRatio || 1);
}

/**
 * Runs `frame(dtSeconds, tSeconds)` on requestAnimationFrame only while the canvas is on screen and the tab is
 * visible. Returns a stop function.
 */
export function runWhileVisible(canvas: HTMLCanvasElement, frame: (dt: number, t: number) => void): () => void {
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let isOnScreen = true;
  const tick = (now: number): void => {
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
    last = now;
    elapsed += dt;
    frame(dt, elapsed);
    raf = requestAnimationFrame(tick);
  };
  const sync = (): void => {
    const shouldRun = isOnScreen && document.visibilityState === 'visible';
    if (shouldRun && !raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    } else if (!shouldRun && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const observer = new IntersectionObserver(([entry]) => {
    isOnScreen = entry.isIntersecting;
    sync();
  });
  observer.observe(canvas);
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => {
    observer.disconnect();
    document.removeEventListener('visibilitychange', sync);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  };
}
