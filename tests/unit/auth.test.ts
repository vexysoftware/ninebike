import { describe, expect, it } from 'vitest';
import { hasRecentTotp } from '../../src/adapters/http/auth';

describe('MFA recente (TOTP em até 300 s)', () => {
  const now = 1_800_000_000;
  it('aceita aal2 + totp recente', () => expect(hasRecentTotp({ aal: 'aal2', amr: [{ method: 'totp', timestamp: now - 299 }] }, now)).toBe(true));
  it('nega antigo, futuro, aal1, método password ou ausência de amr', () => {
    expect(hasRecentTotp({ aal: 'aal2', amr: [{ method: 'totp', timestamp: now - 301 }] }, now)).toBe(false);
    expect(hasRecentTotp({ aal: 'aal2', amr: [{ method: 'totp', timestamp: now + 5 }] }, now)).toBe(false);
    expect(hasRecentTotp({ aal: 'aal1', amr: [{ method: 'totp', timestamp: now }] }, now)).toBe(false);
    expect(hasRecentTotp({ aal: 'aal2', amr: [{ method: 'password', timestamp: now }] }, now)).toBe(false);
    expect(hasRecentTotp({ aal: 'aal2' }, now)).toBe(false);
  });
});
