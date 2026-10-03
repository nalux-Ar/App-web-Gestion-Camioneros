import { describe, expect, it } from 'vitest';

import { formatDateShort, formatDateWithYear } from '@/lib/dates';

describe('formatDateWithYear', () => {
  it('es la fecha corta + el año: "15 jun 2025"', () => {
    expect(formatDateWithYear('2025-06-15')).toBe('15 jun 2025');
    expect(formatDateWithYear('2026-10-02')).toBe('2 oct 2026');
    expect(formatDateWithYear('2000-01-01')).toBe('1 ene 2000');
  });

  it('usa la misma abreviatura que formatDateShort (sin "sept")', () => {
    expect(formatDateWithYear('2026-09-30')).toBe(`${formatDateShort('2026-09-30')} 2026`);
    expect(formatDateWithYear('2026-09-30')).toBe('30 sep 2026');
  });

  it('una fecha que no existe en el calendario o no es una fecha se devuelve tal cual (no rompe el render)', () => {
    for (const rara of ['2026-02-30', 'rara', '', '2026-13-01', '15/06/2025']) {
      expect(formatDateWithYear(rara), rara).toBe(rara);
    }
  });
});
