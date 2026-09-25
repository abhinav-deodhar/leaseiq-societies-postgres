export function displayFloor(
  wingName: string,
  floor: string | null,
  standalone: boolean,
): string {
  const label = floor?.trim();

  if (!label) return "—";

  const prefix = wingName.trim();

  if (standalone || !prefix) {
    return `Floor ${label}`;
  }

  if (label.toUpperCase().startsWith(prefix.toUpperCase())) {
    const suffix = label.slice(prefix.length);

    if (/^(?:\d+|G|B\d+)$/i.test(suffix)) {
      return `${prefix}${suffix}`;
    }
  }

  return `${prefix}${label}`;
}
