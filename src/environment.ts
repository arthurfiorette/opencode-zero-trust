export function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = new Set([
    'PATH',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'SYSTEMROOT',
    'WINDIR',
    'PATHEXT',
    'TEMP',
    'TMP',
    'TMPDIR',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR'
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => allowed.has(key.toUpperCase()) && value !== undefined
    )
  );
}
