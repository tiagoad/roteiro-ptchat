export function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter((v) => !!v).join(' ');
}
