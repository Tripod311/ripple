import { describe, expect, it } from 'vitest';
import { deferred, setupContext } from './helpers.js';
import type { EvalTestResult } from '../src/index.js';

describe('EvalContext', () => {
  it('records interactions and passes the same signal to target and judge', async () => {
    const { context, target, judge } = await setupContext();
    target.send.mockResolvedValueOnce({ answer: 42 });
    await context.send('question');
    expect(context.interactions).toEqual([{ input: 'question', output: { answer: 42 } }]);
    expect(await context.snapshot()).toEqual({ state: 'ready' });
    expect(await context.evaluate('correct', { language: 'en' })).toEqual({ status: 'pass' });
    const signal = target.send.mock.calls[0]![1];
    expect(signal.aborted).toBe(false);
    expect(target.snapshot).toHaveBeenCalledWith(signal);
    expect(judge.evaluate).toHaveBeenCalledWith({ criteria: 'correct', interactions: context.interactions, metadata: { language: 'en' } }, signal);
    await context.evaluate('concise');
    expect(judge.evaluate).toHaveBeenLastCalledWith({ criteria: 'concise', interactions: context.interactions, metadata: undefined }, signal);
    await context.dispose();
    expect(signal.aborted).toBe(true);
    expect(target.dispose).toHaveBeenCalledOnce();
    expect(judge.dispose).toHaveBeenCalledOnce();
  });

  it('propagates send failures without recording them', async () => {
    const { context, target } = await setupContext();
    target.send.mockRejectedValueOnce(new Error('offline'));
    await expect(context.send('hello')).rejects.toThrow('offline');
    expect(context.interactions).toEqual([]);
    await context.dispose();
  });

  it.each(['abort', 'dispose'] as const)('blocks all new operations after %s', async close => {
    const { context, target, judge } = await setupContext();
    await context[close]();
    await expect(context.send('late')).rejects.toThrow('Aborted');
    await expect(context.snapshot()).rejects.toThrow('Aborted');
    await expect(context.evaluate('late')).rejects.toThrow('Aborted');
    expect(target.send).not.toHaveBeenCalled();
    expect(target.snapshot).not.toHaveBeenCalled();
    expect(judge.evaluate).not.toHaveBeenCalled();
    if (close === 'abort') await context.dispose();
  });

  it.each(['send', 'snapshot', 'evaluate'] as const)('rejects a late %s result even if the adapter ignores cancellation', async operation => {
    const { context, target, judge } = await setupContext();
    const late = deferred<EvalTestResult>();
    target.send.mockReturnValue(late.promise);
    target.snapshot.mockReturnValue(late.promise);
    judge.evaluate.mockReturnValue(late.promise);
    const pending = operation === 'snapshot' ? context.snapshot() : context[operation]('input');
    const assertion = expect(pending).rejects.toThrow('Aborted');
    context.abort();
    late.resolve({ status: 'pass' });
    await assertion;
    expect(context.interactions).toEqual([]);
    await context.dispose();
  });
});
