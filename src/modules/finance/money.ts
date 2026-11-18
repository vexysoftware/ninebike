// Dinheiro em centavos com bigint; sem ponto flutuante. Sem SDK de provedor.
export const COMMISSION_BPS = 150n; // 1,5% do bruto (regra revisão 1)

/** Comissão-alvo do software para base bruta B ≥ 0: floor((B*15 + 500) / 1000). */
export function commissionTarget(base: bigint): bigint {
  if (base < 0n) throw new RangeError('base negativa');
  return (base * 15n + 500n) / 1000n;
}

/** Rateio cumulativo: fatia i = alvo(acumulado até i) − alvo(acumulado até i−1). Soma fecha o alvo total. */
export function allocateCommission(bases: bigint[]): bigint[] {
  let acc = 0n;
  let prev = 0n;
  return bases.map((b) => {
    if (b < 0n) throw new RangeError('base negativa');
    acc += b;
    const t = commissionTarget(acc);
    const slice = t - prev;
    prev = t;
    return slice;
  });
}

/** Divide total em N parcelas: primeiras N−1 iguais (floor), última leva o resto. */
export function splitEven(total: bigint, n: number): bigint[] {
  if (n < 1) throw new RangeError('n < 1');
  const q = total / BigInt(n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? total - q * BigInt(n - 1) : q));
}
