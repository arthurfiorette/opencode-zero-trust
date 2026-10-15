import { Rpc } from '@opencode/plugin/rpc';
import { z } from 'zod';

export const statusSchema = z.strictObject({
  state: z.literal('not-implemented'),
  hostname: z.string().optional()
});

export type Status = z.output<typeof statusSchema>;

export const ZeroTrust = Rpc.define({
  id: 'opencode-zero-trust',
  methods: {
    status: {
      input: z.strictObject({}),
      output: statusSchema
    }
  },
  events: {}
});
