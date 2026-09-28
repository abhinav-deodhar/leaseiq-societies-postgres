export function escapeSearchLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function searchWordPatterns(value: string): string[] {
  return [...new Set(
    value.trim().toLowerCase().split(/\s+/).filter(Boolean),
  )].map((word) => `%${escapeSearchLike(word)}%`);
}
