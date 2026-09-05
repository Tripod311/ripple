import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

describe('EvalContext', () => {
  it('records successful interactions in order and forwards snapshots', async () => {
    const { context, target } = setup();
    target.send.mockResolvedValueOnce({ answer: 42 }).mockResolvedValueOnce('next');
    expect(await context.send({ question: 'meaning' })).toEqual({ answer: 42 });
    await context.send('continue');
    expect(context.interactions).toEqual([
      { input: { question: 'meaning' }, output: { answer: 42 } },
      { input: 'continue', output: 'next' },
    ]);
    expect(target.send).toHaveBeenNthCalledWith(1, { question: 'meaning' });
    expect(await context.snapshot()).toEqual({ state: 'ready' });
    expect(target.snapshot).toHaveBeenCalledOnce();
  });

  it('propagates send failures without recording an interaction', async () => {
    const { context, target } = setup();
    target.send.mockRejectedValueOnce(new Error('offline'));
    await expect(context.send('hello')).rejects.toThrow('offline');
    expect(context.interactions).toEqual([]);
  });

  it('clears conversation history and resets the target', async () => {
    const { context, target } = setup();
    await context.send('hello');
    await context.reset();
    expect(context.interactions).toEqual([]);
    expect(target.reset).toHaveBeenCalledOnce();
  });

  it('passes criteria, history, and optional metadata to the judge', async () => {
    const { context, judge } = setup();
    await context.send('hello');
    judge.evaluate.mockResolvedValue({ status: 'warning', details: 'uncertain' });
    expect(await context.evaluate('be polite', { language: 'en' })).toEqual({ status: 'warning', details: 'uncertain' });
    expect(judge.evaluate).toHaveBeenCalledWith({ criteria: 'be polite', interactions: [{ input: 'hello', output: 'hello' }], metadata: { language: 'en' } });
    await context.evaluate('be concise');
    expect(judge.evaluate).toHaveBeenLastCalledWith({ criteria: 'be concise', interactions: context.interactions, metadata: undefined });
  });
});
