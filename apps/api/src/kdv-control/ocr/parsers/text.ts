export function normalizeTaxText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/\u0130/g, 'I')
    .replace(/\u0131/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}
