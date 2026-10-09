/** Relay process termination into the active operation so it can journal and clean up. */
export async function runWithTerminationSignal<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('termination_requested'));
  // Keep the handlers installed until the operation has observed cancellation
  // and completed its cleanup. A once-handler is removed as the signal is
  // dispatched, which can restore Node's default termination before the
  // asynchronous operation settles.
  process.on('SIGTERM', abort);
  process.on('SIGINT', abort);
  try { return await operation(controller.signal); }
  finally {
    process.removeListener('SIGTERM', abort);
    process.removeListener('SIGINT', abort);
  }
}
