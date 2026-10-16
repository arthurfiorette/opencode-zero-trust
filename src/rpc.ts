import { Rpc } from '@opencode/plugin/rpc';
import { z } from 'zod';

export const stateSchema = z.enum([
  'unconfigured',
  'starting',
  'connecting',
  'ready',
  'restarting',
  'stopping',
  'stopped',
  'error'
]);

export const errorSchema = z.enum([
  'daemon-unavailable',
  'daemon-mismatch',
  'daemon-auth-required',
  'daemon-not-loopback',
  'dns-check-failed',
  'dns-route-failed',
  'credentials-invalid',
  'credentials-permissions',
  'credentials-ambiguous',
  'node-unavailable',
  'cloudflared-unavailable',
  'cloudflared-exited',
  'helper-unavailable',
  'helper-protocol-error',
  'configuration-conflict'
]);

export const statusSchema = z.strictObject({
  state: stateSchema,
  dns: z.enum(['unchecked', 'resolved', 'created']).optional(),
  hostname: z.string().optional(),
  url: z.url().optional(),
  helperPid: z.number().int().positive().optional(),
  connectorPid: z.number().int().positive().optional(),
  error: errorSchema.optional()
});

export const pairingSchema = z.strictObject({
  url: z.url(),
  expiresIn: z.number().int().positive()
});

export type Status = z.output<typeof statusSchema>;
export type Pairing = z.output<typeof pairingSchema>;

export const ZeroTrust = Rpc.define({
  id: 'opencode-zero-trust',
  methods: {
    status: {
      input: z.strictObject({}),
      output: statusSchema
    },
    connect: {
      input: z.strictObject({}),
      output: statusSchema,
      errors: {
        unavailable: z.strictObject({})
      }
    },
    disable: {
      input: z.strictObject({}),
      output: statusSchema,
      errors: {
        unavailable: z.strictObject({})
      }
    },
    pair: {
      input: z.strictObject({}),
      output: pairingSchema,
      errors: {
        not_ready: z.strictObject({ state: stateSchema }),
        unavailable: z.strictObject({})
      }
    }
  },
  events: {}
});
