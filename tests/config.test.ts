import { describe, expect, it } from 'vitest';
import { validateConfig } from '../src/index.js';
import type { RippleConfiguration } from '../src/index.js';
import { setup } from './helpers.js';

describe('validateConfig', () => {
  it('provides defaults and supports a target without a judge', () => {
    const { config } = setup();
    expect(config.execution).toMatchObject({ in: [], failOnRegression: false, passRate_warning_threshold: 0.05 });
    expect(config.judgeFactory).toBeUndefined();
  });

  it('preserves explicitly configured values without mutating input', () => {
    const { config, judge } = setup({ out: './results', baseline: './baseline.json', timeout: 25, retries: 0, failOnRegression: true, passRate_warning_threshold: 0 });
    const input = { ...config, fingerprint: 'v1', judgeFactory: async () => judge, hooks: { beforeAll: async () => {} } };
    const result = validateConfig(input);
    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(result.execution).not.toBe(input.execution);
  });

  it.each([
    [undefined, 'Ripple configuration is not defined'],
    [null, 'Ripple configuration is not defined'],
    [{}, 'targetFactory is not defined'],
    [{ targetFactory: () => {} }, 'execution configuration is not defined'],
  ])('rejects missing required configuration: %j', (input, message) => {
    expect(() => validateConfig(input as RippleConfiguration)).toThrow(message);
  });

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects timeout %s', timeout => {
    expect(() => setup({ timeout })).toThrow('execution.timeout must be greater than 0');
  });

  it.each([-1, 0.5, NaN, Infinity])('rejects retries %s', retries => {
    expect(() => setup({ retries })).toThrow('execution.retries must be a non-negative integer');
  });
});
