import { describe, expect, it } from 'vitest';
import { allocateCommission, commissionTarget, splitEven } from '../../src/modules/finance/money';

describe('comissão do software 1,5% do bruto (FIN-01)', () => {
  it('exemplos da spec', () => {
    expect(commissionTarget(400000n)).toBe(6000n);
    expect(commissionTarget(800000n)).toBe(12000n);
    expect(commissionTarget(1500000n)).toBe(22500n);
    expect(commissionTarget(0n)).toBe(0n);
  });
  it('rateio cumulativo fecha o alvo total (10.000 casos com semente fixa)', () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 10000; i++) {
      const bases = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => BigInt(Math.floor(rnd() * 2_000_000)));
      const slices = allocateCommission(bases);
      const total = bases.reduce((a, b) => a + b, 0n);
      expect(slices.reduce((a, b) => a + b, 0n)).toBe(commissionTarget(total));
      expect(slices.every((s) => s >= 0n)).toBe(true);
    }
  });
  it('parcelas: 12000 em 3 → 4000/4000/4000; 10001 em 3 → 3333/3333/3335', () => {
    expect(splitEven(12000n, 3)).toEqual([4000n, 4000n, 4000n]);
    expect(splitEven(10001n, 3)).toEqual([3333n, 3333n, 3335n]);
  });
});
