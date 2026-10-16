import { describe, expect, it } from 'vitest';
import { runWithTerminationSignal } from '../../src/operations/processSignal.js';

describe('operation termination signal lifecycle', () => {
  it('resolves normally and removes both process listeners', async () => {
    const baselineTerm = process.listenerCount('SIGTERM');
    const baselineInt = process.listenerCount('SIGINT');

    await expect(runWithTerminationSignal(async (signal) => {
      expect(signal.aborted).toBe(false);
      return 'completed';
    })).resolves.toBe('completed');

    expect(process.listenerCount('SIGTERM')).toBe(baselineTerm);
    expect(process.listenerCount('SIGINT')).toBe(baselineInt);
  });

  it('keeps cancellation handlers installed until the operation finishes cleanup', async () => {
    const baselineTerm = process.listenerCount('SIGTERM');
    const baselineInt = process.listenerCount('SIGINT');
    let finishCleanup!: () => void;
    let observedSignal!: AbortSignal;
    const operation = runWithTerminationSignal(async (signal) => {
      observedSignal = signal;
      await new Promise<void>((resolve) => { finishCleanup = resolve; });
      return signal.reason;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    const [terminationHandler] = process.listeners('SIGTERM').slice(baselineTerm) as Array<() => void>;
    const [interruptHandler] = process.listeners('SIGINT').slice(baselineInt) as Array<() => void>;
    expect(terminationHandler).toBeTypeOf('function');
    expect(interruptHandler).toBeTypeOf('function');
    terminationHandler();
    expect(observedSignal.aborted).toBe(true);
    expect(process.listenerCount('SIGTERM')).toBe(baselineTerm + 1);
    expect(process.listenerCount('SIGINT')).toBe(baselineInt + 1);

    finishCleanup();
    await expect(operation).resolves.toMatchObject({ message: 'termination_requested' });
    expect(process.listenerCount('SIGTERM')).toBe(baselineTerm);
    expect(process.listenerCount('SIGINT')).toBe(baselineInt);
  });

  it('preserves operation errors while still unregistering listeners', async () => {
    const baseline = process.listenerCount('SIGTERM');
    await expect(runWithTerminationSignal(async () => { throw new Error('operation_failed'); }))
      .rejects.toThrow('operation_failed');
    expect(process.listenerCount('SIGTERM')).toBe(baseline);
  });
});
