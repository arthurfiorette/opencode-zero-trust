import { isIP } from 'node:net';
import { homedir, hostname, platform, userInfo } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const executable = z
  .string()
  .min(1)
  .refine((value) => path.isAbsolute(value) || /^[\w.-]+$/.test(value), {
    message: 'Use an absolute executable path or a command name on PATH, without shell arguments.'
  });

const variables = new Map<string, () => string>([
  ['username', () => userInfo().username],
  ['hostname', hostname],
  [
    'os',
    () => {
      const os = platform();
      return os === 'darwin' ? 'macos' : os === 'win32' ? 'windows' : os;
    }
  ]
]);

export const tunnelOptionsSchema = z.strictObject({
  hostname: z
    .string()
    .transform((template, context) =>
      template
        .replace(/\{([^{}]+)\}/g, (token, expression: string) => {
          const [name, length, ...extra] = expression.split(',');
          if (extra.length || (length !== undefined && !/^-?[1-9]\d*$/.test(length))) {
            context.addIssue({
              code: 'custom',
              message: `Invalid hostname variable length: ${token}`
            });
            return token;
          }
          const count = length === undefined ? undefined : Number(length);
          if (count !== undefined && (!Number.isSafeInteger(count) || Math.abs(count) > 63)) {
            context.addIssue({
              code: 'custom',
              message: `Hostname variable length must be between 1 and 63: ${token}`
            });
            return token;
          }
          const variable = variables.get(name ?? '');
          if (!variable) {
            context.addIssue({ code: 'custom', message: `Unknown hostname variable: ${token}` });
            return token;
          }
          try {
            const normalized = variable()
              .normalize('NFKD')
              .toLowerCase()
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^a-z0-9-]+/g, '-')
              .replace(/^-+|-+$/g, '');
            const value = (
              count === undefined
                ? normalized
                : count > 0
                  ? normalized.slice(0, count)
                  : normalized.slice(count)
            ).replace(/^-+|-+$/g, '');
            if (!value)
              context.addIssue({
                code: 'custom',
                message: `Hostname variable ${token} has no DNS-safe characters.`
              });
            return value;
          } catch {
            context.addIssue({
              code: 'custom',
              message: `Cannot resolve hostname variable: ${token}`
            });
            return token;
          }
        })
        .toLowerCase()
    )
    .pipe(z.hostname())
    .refine((value) => value.includes('.') && isIP(value) === 0, {
      message: 'Use a DNS hostname, such as opencode-mac.example.com, without a URL scheme or path.'
    }),
  credentialsFile: z
    .string()
    .transform((value) => {
      if (value === '~') return homedir();
      if (value.startsWith('~/') || (path.sep === '\\' && value.startsWith('~\\'))) {
        return path.join(homedir(), value.slice(2));
      }
      return value;
    })
    .refine(path.isAbsolute, {
      message: 'Use an absolute credentials file path or a path starting with ~/.'
    })
    .optional(),
  access: z
    .strictObject({
      teamName: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/),
      audience: z
        .string()
        .regex(/^[a-f0-9]{64}$/i)
        .transform((value) => value.toLowerCase())
    })
    .optional(),
  serviceFile: z.string().refine(path.isAbsolute).optional(),
  autoDns: z.boolean().default(true),
  autoStart: z.boolean().default(true),
  preventTransform: z.boolean().default(false),
  cloudflaredPath: executable.default('cloudflared'),
  nodePath: executable.default('node')
});

export const optionsSchema = z.preprocess(
  (input) =>
    input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0
      ? undefined
      : input,
  tunnelOptionsSchema.optional()
);

export type Options = z.output<typeof optionsSchema>;
export type TunnelOptions = z.output<typeof tunnelOptionsSchema>;

export function parseOptions(input: unknown): Options {
  return optionsSchema.parse(input);
}
