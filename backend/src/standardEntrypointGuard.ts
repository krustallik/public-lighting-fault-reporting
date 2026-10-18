export function assertStandardBackendEntrypoint(env: Record<string, string | undefined>): void {
  if (env.LOCAL_UAT_MODE === 'true') {
    throw new Error('LOCAL_UAT_MODE is reserved for an explicitly guarded local UAT entrypoint.');
  }
}

assertStandardBackendEntrypoint(process.env);
