import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';

const credentialsSchema = z.object({
  AccountTag: z.string().min(1),
  TunnelSecret: z.string().min(1),
  TunnelID: z.uuid()
});

export class CredentialsError extends Error {
  readonly code: 'credentials-invalid' | 'credentials-permissions' | 'credentials-ambiguous';

  constructor(code: CredentialsError['code']) {
    super(code);
    this.code = code;
  }
}

export async function findCredentialsFile(
  directory = path.join(homedir(), '.cloudflared')
): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const candidates = entries.filter(
    (entry) =>
      entry.isFile() &&
      entry.name.endsWith('.json') &&
      z.uuid().safeParse(entry.name.slice(0, -5)).success
  );
  if (candidates.length > 1) throw new CredentialsError('credentials-ambiguous');
  const candidate = candidates[0];
  if (!candidate) throw new CredentialsError('credentials-invalid');
  return path.join(directory, candidate.name);
}

export async function readTunnelID(file: string): Promise<string> {
  const info = await stat(file).catch(() => undefined);
  if (!info?.isFile()) throw new CredentialsError('credentials-invalid');
  // Windows mode bits do not describe NTFS ACLs. The user's credentials directory must protect those files.
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    throw new CredentialsError('credentials-permissions');
  }

  const credentials = await readFile(file, 'utf8')
    .then((text) => credentialsSchema.parse(JSON.parse(text)))
    .catch(() => undefined);
  if (!credentials) throw new CredentialsError('credentials-invalid');
  return credentials.TunnelID;
}
