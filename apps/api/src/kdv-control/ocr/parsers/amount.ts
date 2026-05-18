export function parseOcrAmount(value: string | number | null | undefined): number {
  let c = String(value ?? '')
    .replace(/\s/g, '')
    .replace(/(?:TL|TRY|₺)/gi, '')
    .replace(/[\*¥]/g, '')
    .replace(/[^\d,.\-]/g, '');

  if (/^-?\d{1,3}(?:\.\d{3})+\.\d{1,2}$/.test(c)) {
    const lastDot = c.lastIndexOf('.');
    c = c.slice(0, lastDot).replace(/\./g, '') + '.' + c.slice(lastDot + 1);
  }

  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(c)) {
    return parseFloat(c.replace(/\./g, '').replace(',', '.'));
  }

  return parseFloat(c.replace(',', '.')) || 0;
}

export function formatOcrAmount(value: number): string {
  return value.toFixed(2).replace('.', ',');
}
