import { readFile, stat } from 'node:fs/promises';
import { z } from 'zod';

const credentialsSchema = z.object({
  AccountTag: z.string().min(1),
  TunnelSecret: z.string().min(1),
  TunnelID: z.uuid()
});

export class CredentialsError extends Error {
  readonly code: 'credentials-invalid' | 'credentials-permissions';

  constructor(code: 'credentials-invalid' | 'credentials-permissions') {
    super(code);
    this.code = code;
  }
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
