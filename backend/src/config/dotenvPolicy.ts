type DotenvLoader = () => unknown;

export function loadRuntimeDotenv(
  env: Record<string, string | undefined>,
  load: DotenvLoader,
): void {
  // The live local UAT launcher injects every value explicitly. Do not call
  // dotenv at all: vault mode can still load .env.vault with an empty path list.
  if (env.LIVE_PROVIDER_LOCAL_UAT === 'true') return;

  load();
}
