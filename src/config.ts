import { isIP } from 'node:net';
import { z } from 'zod';

export const optionsSchema = z.strictObject({
  hostname: z
    .hostname()
    .refine((value) => value.includes('.') && isIP(value) === 0, {
      message: 'Use a DNS hostname, such as opencode-mac.example.com, without a URL scheme or path.'
    })
    .transform((value) => value.toLowerCase())
    .optional()
});

export type Options = z.output<typeof optionsSchema>;

export function parseOptions(input: unknown): Options {
  return optionsSchema.parse(input);
}
