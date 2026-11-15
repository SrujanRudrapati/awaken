import { describe, expect, test } from 'vitest';
import { chain, identity, lookAt, multiply, perspective, rotationY, transformPoint, translation } from './mat4';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));

describe('mat4', () => {
  test('identity leaves a matrix unchanged', () => {
    const m = translation(1, 2, 3);
    close([...multiply(identity(), m)], [...m]);
  });

  test('chain applies the right-most matrix first', () => {
    const m = chain(translation(10, 0, 0), rotationY(Math.PI / 2));
    close(transformPoint(m, [1, 0, 0]), [10, 0, -1]);
  });

  test('lookAt puts the target straight ahead on −z', () => {
    const view = lookAt([0, 0, 9], [0, 0, 0]);
    close(transformPoint(view, [0, 0, 0]), [0, 0, -9]);
    close(transformPoint(view, [1, 2, 0]), [1, 2, -9]);
  });

  test('perspective maps the near plane to clip z = −w', () => {
    const p = perspective(90, 1, 1, 100);
    const z = p[10] * -1 + p[14];
    const w = p[11] * -1;
    expect(z / w).toBeCloseTo(-1, 5);
  });
});
