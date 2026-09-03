import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route.js';

afterEach(() => vi.unstubAllEnvs());

describe('the Lab-mode declaration route', () => {
  it('is true only when both bases name one origin, read at request time', async () => {
    vi.stubEnv('OTC_LAB_BASE', 'http://127.0.0.1:7300');
    vi.stubEnv('OTC_API_BASE', 'http://127.0.0.1:7300/');
    expect(await GET().json()).toEqual({ active: true });
    vi.stubEnv('OTC_LAB_BASE', 'http://127.0.0.1:7302');
    expect(await GET().json()).toEqual({ active: false });
    expect(GET().headers.get('cache-control')).toBe('no-store');
  });
});
