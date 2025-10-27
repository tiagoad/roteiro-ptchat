const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function indexToSheetsColumn(index: number): string {
  if (index < 0) {
    throw new Error('Index must be non-negative');
  }

  let column = '';
  while (index >= 0) {
    const remainder = index % 26;
    column = String.fromCharCode(65 + remainder) + column;
    index = Math.floor(index / 26) - 1;
    if (index < 0) break;
  }
  return column;
}
