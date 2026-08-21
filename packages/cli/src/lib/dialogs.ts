export function parseDialogAnswer(
  method: string,
  options: string[] | undefined,
  input: string
): { confirmed?: boolean; value?: string } {
  if (method === "confirm") return { confirmed: /^y/i.test(input.trim()) };
  if (method === "select") {
    const n = parseInt(input, 10);
    return {
      value:
        !Number.isNaN(n) && Array.isArray(options) && options[n - 1] ? options[n - 1] : input,
    };
  }
  return { value: input };
}

export function parseSelectAnswer(
  input: string,
  count: number,
  { multiple }: { multiple?: boolean } = {}
): number[] | null {
  const trimmed = input.trim();

  if (multiple && (trimmed === "" || /^0$/.test(trimmed) || /^none$/i.test(trimmed))) {
    return [];
  }

  const tokens = trimmed
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  if (tokens.length === 0) return null;
  if (!multiple && tokens.length !== 1) return null;

  const selected: number[] = [];
  for (const token of tokens) {
    const n = Number(token);
    if (!Number.isInteger(n) || n < 1 || n > count) return null;
    if (!selected.includes(n - 1)) selected.push(n - 1);
  }

  return selected;
}
