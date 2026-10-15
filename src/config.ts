import { isIP } from 'node:net';
import path from 'node:path';
import { z } from 'zod';

const executable = z
  .string()
  .min(1)
  .refine((value) => path.isAbsolute(value) || /^[\w.-]+$/.test(value), {
    message: 'Use an absolute executable path or a command name on PATH, without shell arguments.'
  });

export const tunnelOptionsSchema = z.strictObject({
  hostname: z
    .hostname()
    .refine((value) => value.includes('.') && isIP(value) === 0, {
      message: 'Use a DNS hostname, such as opencode-mac.example.com, without a URL scheme or path.'
    })
    .transform((value) => value.toLowerCase()),
  credentialsFile: z
    .string()
    .refine(path.isAbsolute, { message: 'Use an absolute credentials file path.' }),
  access: z.strictObject({
    teamName: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
    audience: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .transform((value) => value.toLowerCase())
  }),
  serviceFile: z.string().refine(path.isAbsolute).optional(),
  cloudflaredPath: executable.default('cloudflared'),
  nodePath: executable.default('node')
});

export const optionsSchema = z.union([
  z.strictObject({}).transform(() => undefined),
  tunnelOptionsSchema
]);

export type Options = z.output<typeof optionsSchema>;
export type TunnelOptions = z.output<typeof tunnelOptionsSchema>;

export function parseOptions(input: unknown): Options {
  return optionsSchema.parse(input);
}
