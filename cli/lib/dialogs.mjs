export function parseDialogAnswer(method, options, input) {
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
