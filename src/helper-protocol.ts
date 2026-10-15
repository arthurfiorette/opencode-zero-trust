import { isIP } from 'node:net';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

const loopbackService = z.url().refine((value) => {
  const url = new URL(value);
  return (
    ['http:', 'https:'].includes(url.protocol) &&
    (url.hostname === '[::1]' || (isIP(url.hostname) === 4 && url.hostname.startsWith('127.'))) &&
    !url.username &&
    !url.password &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash
  );
});

export const startMessageSchema = z.strictObject({
  type: z.literal('start'),
  executable: z.string().min(1),
  prefixArgs: z.array(z.string()),
  config: z.strictObject({
    tunnel: z.uuid(),
    'credentials-file': z.string().refine(isAbsolute),
    ingress: z.tuple([
      z.strictObject({
        hostname: z.hostname(),
        service: loopbackService,
        originRequest: z.strictObject({
          access: z.strictObject({
            required: z.literal(true),
            teamName: z.string().min(1),
            audTag: z.array(z.string().min(1)).min(1)
          })
        })
      }),
      z.strictObject({ service: z.literal('http_status:404') })
    ])
  })
});

export type StartMessage = z.output<typeof startMessageSchema>;

export const helperStatusSchema = z.strictObject({
  state: z.enum(['connecting', 'ready', 'restarting', 'error']),
  pid: z.number().int().positive().optional(),
  error: z
    .enum([
      'helper-protocol-error',
      'helper-unavailable',
      'cloudflared-unavailable',
      'cloudflared-exited'
    ])
    .optional()
});

export type HelperStatus = z.output<typeof helperStatusSchema>;
