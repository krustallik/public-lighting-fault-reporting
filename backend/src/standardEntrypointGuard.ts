export function assertStandardBackendEntrypoint(env: Record<string, string | undefined>): void {
  if (env.LOCAL_UAT_MODE === 'true') {
    throw new Error('LOCAL_UAT_MODE is reserved for the fake-provider local UAT server.');
  }
}

assertStandardBackendEntrypoint(process.env);
