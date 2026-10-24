export type HistoryOrder = {
  text: string;
  parsed: boolean;
  outOfOrder: boolean;
};

const entryPattern = /^- (\d{4}-\d{2}-\d{2}) · /;

// The file stays append-only; only the rendered work trail is ordered by date.
export function orderHistory(text: string): HistoryOrder {
  const lines = text.split(/\r?\n/);
  const entries = lines
    .map((line, index) => {
      const match = line.match(entryPattern);
      return match ? { line, date: match[1], index } : null;
    })
    .filter((entry): entry is { line: string; date: string; index: number } => entry !== null);

  if (entries.length < 2 || entries.length !== lines.filter(line => line.trim()).length) {
    return { text, parsed: false, outOfOrder: false };
  }

  const ascending = entries.every((entry, index) => index === 0 || entry.date >= entries[index - 1].date);
  const descending = entries.every((entry, index) => index === 0 || entry.date <= entries[index - 1].date);
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || a.index - b.index);
  return { text: sorted.map(entry => entry.line).join('\n'), parsed: true, outOfOrder: !ascending && !descending };
}
