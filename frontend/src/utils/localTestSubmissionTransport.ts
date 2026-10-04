export class LocalTestTransportConfigurationError extends Error {
  readonly code = 'LOCAL_TEST_TRANSPORT_CONFIG';

  constructor(message = 'Local test submission requires a development/test runtime and a loopback API origin.') {
    super(message);
    this.name = 'LocalTestTransportConfigurationError';
  }
}

export interface LocalTestRuntime {
  mode: string;
  productionBuild: boolean;
}

export function resolveLocalTestSubmitUrl(apiBase: string, runtime: LocalTestRuntime): string {
  if (
    runtime.productionBuild ||
    (runtime.mode !== 'development' && runtime.mode !== 'test')
  ) {
    throw new LocalTestTransportConfigurationError('Local test submission is disabled outside development/test mode.');
  }

  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    throw new LocalTestTransportConfigurationError('The local test API base URL is malformed.');
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !loopback ||
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new LocalTestTransportConfigurationError('Local test submission requires an HTTP(S) loopback API origin.');
  }

  const apiPath = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${apiPath}/dev/ausemio-test-submit`;
}

export async function postLocalTestSubmission(
  formData: FormData,
  apiBase: string,
  runtime: LocalTestRuntime,
  fetcher: typeof fetch = fetch
): Promise<Response> {
  const url = resolveLocalTestSubmitUrl(apiBase, runtime);
  return fetcher(url, { method: 'POST', body: formData });
}
