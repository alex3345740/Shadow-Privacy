export type CsvRecipient = { address: string; amount: string; delaySeconds?: string };

export function parseRecipientsCsv(raw: string): CsvRecipient[] {
  const rows = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return rows
    .map((line) => {
      const [address, amount, delaySeconds] = line.split(",").map((part) => part.trim());
      if (!address) return null;
      return { address, amount: amount ?? "", delaySeconds };
    })
    .filter(Boolean) as CsvRecipient[];
}

export function exportRecipientsCsv(recipients: CsvRecipient[]): string {
  return recipients
    .map((row) => [row.address, row.amount, row.delaySeconds ?? ""].join(","))
    .join("\n");
}
