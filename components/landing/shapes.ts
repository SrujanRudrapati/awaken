/**
 * Point clouds the landing field morphs between (port of design/oath.html): crystal → figure → globe →
 * star → constellation → shattered figure → crystal. Each returns `count` xyz triples.
 */
type Draw = (context: CanvasRenderingContext2D, size: number) => void;

const TAU = Math.PI * 2;
const rand = Math.random;

/** Samples filled pixels of a 2D drawing into a thin 3D slab. */
function fromCanvas(count: number, draw: Draw, scale: number, depth: number): Float32Array {
  const size = 360;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  const out = new Float32Array(count * 3);
  if (!context) return out;
  context.fillStyle = context.strokeStyle = '#fff';
  draw(context, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const filled: [number, number][] = [];
  for (let y = 0; y < size; y += 2) for (let x = 0; x < size; x += 2) if (pixels[(y * size + x) * 4 + 3] > 128) filled.push([x, y]);
  if (filled.length === 0) return out;
  for (let i = 0; i < count; i++) {
    const [px, py] = filled[(rand() * filled.length) | 0];
    const x = ((px + rand() * 2 - size / 2) / size) * scale;
    const y = (-(py + rand() * 2 - size / 2) / size) * scale;
    const bulge = Math.sqrt(Math.max(0, 1 - (x / (scale * 0.3)) ** 2));
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = (rand() - 0.5) * depth * (0.35 + bulge);
  }
  return out;
}

function crystal(count: number): Float32Array {
  const vertices = [[0, 1.9, 0], [0, -1.9, 0], [1.1, 0, 0], [-1.1, 0, 0], [0, 0, 1.1], [0, 0, -1.1]];
  const faces = [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 4, 2], [1, 3, 4], [1, 5, 3], [1, 2, 5]];
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (i < count * 0.12) {
      // the eye: a dense core
      const theta = rand() * TAU;
      const phi = Math.acos(2 * rand() - 1);
      const radius = 0.34 * Math.cbrt(rand());
      out[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      out[i * 3 + 1] = radius * Math.cos(phi);
      out[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
      continue;
    }
    const [a, b, c] = faces[i % 8].map((index) => vertices[index]);
    let u = rand();
    let v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    if (rand() < 0.4) {
      // bias toward edges so the facets read
      const edge = rand();
      if (rand() < 0.5) {
        u = edge;
        v = 0;
      } else {
        u = 0;
        v = edge;
      }
    }
    const w = 1 - u - v;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = a[k] * w + b[k] * u + c[k] * v;
  }
  return out;
}

const figure: Draw = (x, size) => {
  const cx = size / 2;
  const cy = size * 0.56;
  const s = size * 0.22;
  x.beginPath();
  x.arc(cx, cy - 1.18 * s, 0.27 * s, 0, 7);
  x.fill();
  x.beginPath();
  x.moveTo(cx - 0.11 * s, cy - 0.92 * s);
  x.lineTo(cx + 0.11 * s, cy - 0.92 * s);
  x.lineTo(cx + 0.13 * s, cy - 0.78 * s);
  x.bezierCurveTo(cx + 0.55 * s, cy - 0.74 * s, cx + 0.86 * s, cy - 0.66 * s, cx + 0.92 * s, cy - 0.36 * s);
  x.lineTo(cx + 1.02 * s, cy + 0.6 * s);
  x.lineTo(cx + 0.8 * s, cy + 0.63 * s);
  x.lineTo(cx + 0.66 * s, cy - 0.08 * s);
  x.lineTo(cx + 0.6 * s, cy + 1.55 * s);
  x.lineTo(cx + 0.08 * s, cy + 1.55 * s);
  x.lineTo(cx, cy + 0.7 * s);
  x.lineTo(cx - 0.08 * s, cy + 1.55 * s);
  x.lineTo(cx - 0.6 * s, cy + 1.55 * s);
  x.lineTo(cx - 0.66 * s, cy - 0.08 * s);
  x.lineTo(cx - 0.8 * s, cy + 0.63 * s);
  x.lineTo(cx - 1.02 * s, cy + 0.6 * s);
  x.lineTo(cx - 0.92 * s, cy - 0.36 * s);
  x.bezierCurveTo(cx - 0.86 * s, cy - 0.66 * s, cx - 0.55 * s, cy - 0.74 * s, cx - 0.13 * s, cy - 0.78 * s);
  x.closePath();
  x.fill();
};

function globe(count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const radius = 1.75;
  for (let i = 0; i < count; i++) {
    let latitude: number;
    let longitude: number;
    if (rand() < 0.5) {
      latitude = ((Math.floor(rand() * 9) - 4) / 4.6) * 1.45;
      longitude = rand() * TAU;
    } else {
      longitude = (Math.floor(rand() * 14) / 14) * TAU;
      latitude = (rand() - 0.5) * 3.1;
    }
    const jitter = 1 + (rand() - 0.5) * 0.012;
    out[i * 3] = Math.cos(latitude) * Math.cos(longitude) * radius * jitter;
    out[i * 3 + 1] = Math.sin(latitude) * radius * jitter;
    out[i * 3 + 2] = Math.cos(latitude) * Math.sin(longitude) * radius * jitter;
  }
  return out;
}

const star: Draw = (x, size) => {
  const c = size / 2;
  x.lineWidth = 5;
  x.beginPath();
  x.arc(c, c, size * 0.42, 0, 7);
  x.stroke();
  x.lineWidth = 2;
  x.beginPath();
  x.arc(c, c, size * 0.34, 0, 7);
  x.stroke();
  x.beginPath();
  for (let k = 0; k < 8; k++) {
    const angle = (k * Math.PI) / 4 - Math.PI / 2;
    const reach = k % 2 ? size * 0.08 : size * 0.3;
    x.lineTo(c + Math.cos(angle) * reach, c + Math.sin(angle) * reach);
  }
  x.closePath();
  x.fill();
};

function constellation(count: number): Float32Array {
  const nodes = Array.from({ length: 16 }, () => [(rand() - 0.5) * 5.6, (rand() - 0.5) * 3.4, (rand() - 0.5) * 1.6]);
  const edges: [number, number][] = [];
  for (let i = 1; i < nodes.length; i++) {
    let nearest = 0;
    let best = Infinity;
    for (let j = 0; j < i; j++) {
      const distance = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
      if (distance < best) {
        best = distance;
        nearest = j;
      }
    }
    edges.push([i, nearest]);
  }
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    if (rand() < 0.38) {
      const node = nodes[(rand() * nodes.length) | 0];
      const radius = rand() ** 3 * 0.22;
      const theta = rand() * TAU;
      const phi = Math.acos(2 * rand() - 1);
      out[i * 3] = node[0] + radius * Math.sin(phi) * Math.cos(theta);
      out[i * 3 + 1] = node[1] + radius * Math.cos(phi);
      out[i * 3 + 2] = node[2] + radius * Math.sin(phi) * Math.sin(theta);
    } else {
      const [from, to] = edges[(rand() * edges.length) | 0];
      const along = rand();
      for (let k = 0; k < 3; k++) out[i * 3 + k] = nodes[from][k] + (nodes[to][k] - nodes[from][k]) * along + (rand() - 0.5) * 0.02;
    }
  }
  return out;
}

function shatter(source: Float32Array, count: number): Float32Array {
  const out = new Float32Array(count * 3);
  const directions = Array.from({ length: 60 }, () => [(rand() - 0.5) * 2.4, (rand() - 0.5) * 1.6, (rand() - 0.5) * 2]);
  for (let i = 0; i < count; i++) {
    const band = ((Math.floor((source[i * 3 + 1] + 3) * 4) % 60) + 60) % 60;
    const direction = directions[band];
    const force = rand() < 0.55 ? 0.15 : 1;
    out[i * 3] = source[i * 3] + direction[0] * force;
    out[i * 3 + 1] = source[i * 3 + 1] + direction[1] * force * 0.4;
    out[i * 3 + 2] = source[i * 3 + 2] + direction[2] * force;
  }
  return out;
}

/** One cloud per landing section, in scroll order. */
export function buildShapes(count: number): Float32Array[] {
  const person = fromCanvas(count, figure, 5.4, 0.9);
  return [crystal(count), person, globe(count), fromCanvas(count, star, 4.6, 0.4), constellation(count), shatter(person, count), crystal(count)];
}

export interface SectionLook {
  x: number;
  y: number;
  scale: number;
  color: string;
  spin: number;
}

export const SECTION_LOOKS: readonly SectionLook[] = [
  { x: 2.6, y: 0, scale: 1, color: '#7DD3FC', spin: 0.18 },
  { x: -2.6, y: -0.1, scale: 1, color: '#7DD3FC', spin: 0 },
  { x: 2.8, y: 0, scale: 0.95, color: '#7DD3FC', spin: 0.25 },
  { x: -2.6, y: 0, scale: 1, color: '#F5C46B', spin: 0.1 },
  { x: 2.4, y: 0, scale: 0.9, color: '#B69CFF', spin: 0.05 },
  { x: -2.4, y: -0.1, scale: 1, color: '#F0524F', spin: 0 },
  { x: 0, y: -0.1, scale: 1.25, color: '#5B8DB8', spin: 0.12 },
];
