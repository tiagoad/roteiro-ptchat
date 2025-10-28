export function average(values: number[]) {
  return values.reduce((m, x, i) => m + (x - m) / (i + 1), 0);
}
