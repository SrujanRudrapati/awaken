import { describe, expect, it } from 'vitest';
import { DeviceCommandSchema } from './schemas';

describe('DeviceCommandSchema', () => {
  it.each(['SEG:RK-E', 'SEG:  42', 'LOCK', 'UNLOCK', 'BUZZ:chime', 'BUZZ:alarm', 'BUZZ:tick'])(
    'accepts %s',
    (cmd) => {
      expect(DeviceCommandSchema.safeParse(cmd).success).toBe(true);
    },
  );

  it.each(['SEG:LONGER', 'SEG:AB', 'SEG:A\nBC', 'BUZZ:honk', 'LCD:hi|there', 'COLOR:red', 'lock', ''])(
    'rejects %j',
    (cmd) => {
      expect(DeviceCommandSchema.safeParse(cmd).success).toBe(false);
    },
  );
});
