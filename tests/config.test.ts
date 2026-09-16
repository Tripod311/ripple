import { describe, expect, it } from 'vitest';
import { Ripple, validateConfig } from '../src/index.js';
import type { RippleConfiguration } from '../src/index.js';
import { report, setup } from './helpers.js';

describe('configuration', () => {
  it('defaults the warning threshold without mutating input', () => {
    const { config } = setup();
    const result = validateConfig(config);
    expect(result.execution.passRate_warning_threshold).toBe(0.05);
    expect(result).not.toBe(config);
    expect(result.execution).not.toBe(config.execution);
    expect(config.execution).toEqual({});
  });

  it('preserves configured values and an in-memory baseline', () => {
    const { config } = setup({ baseline: report({}), timeout: 25, retries: 0, verbose: true, passRate_warning_threshold: 0 });
    const input = { ...config, fingerprint: 'v1' };
    expect(validateConfig(input)).toEqual(input);
  });

  it.each([
    [undefined, 'Ripple configuration is not defined'],
    [null, 'Ripple configuration is not defined'],
    [{}, 'targetFactory is not defined'],
    [{ targetFactory: () => {} }, 'judgeFactory is not defined'],
    [{ targetFactory: () => {}, judgeFactory: () => {} }, 'execution configuration is not defined'],
  ])('rejects missing configuration: %j', (input, message) => {
    expect(() => validateConfig(input as RippleConfiguration)).toThrow(message);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects timeout %s in the constructor', timeout => {
    expect(() => setup({ timeout })).toThrow('execution.timeout must be greater than 0');
  });
  it.each([-1, 0.5, NaN, Infinity])('rejects retries %s in the constructor', retries => {
    expect(() => setup({ retries })).toThrow('execution.retries must be a non-negative integer');
  });

  it('applies the default threshold without a separate validateConfig call', () => {
    const { config } = setup();
    const ripple = new Ripple(config);
    expect(ripple.compareBaseline(report({ test: { status: 'pass', passRate: 1 } }), report({ test: { status: 'pass', passRate: 0.8 } })).warnings).toHaveLength(1);
  });
});
