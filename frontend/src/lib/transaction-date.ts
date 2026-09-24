function isValidTransactionDate(year: string, month: string, day: string): boolean {
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime())
    && date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() + 1 === Number(month)
    && date.getUTCDate() === Number(day);
}

export function formatTransactionDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match || !isValidTransactionDate(match[1], match[2], match[3])) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function parseTransactionDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match || !isValidTransactionDate(match[3], match[2], match[1])) return "";
  return `${match[3]}-${match[2]}-${match[1]}`;
}
