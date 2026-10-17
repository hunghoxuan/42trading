export const VND_DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];
export type CashNote = { denomination: number; quantity: number };

export function cashReceivedForCheckout(cash: string, total: number): number {
  const entered = cash.trim();
  const received = entered ? Number(entered) : total;
  if (!Number.isSafeInteger(received) || received < total) throw new Error("Enter enough cash received");
  return received;
}

// Lazy enumeration: every unique combination is reachable without calculating
// or retaining the potentially enormous full result set.
export function* changeCombinations(amount: number, denominations: number[]): Generator<CashNote[]> {
  if (!Number.isSafeInteger(amount) || amount < 0) return;
  const values = [...new Set(denominations)].filter(value => VND_DENOMINATIONS.includes(value) && value <= amount)
    .sort((a, b) => b - a);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisors = values.map((_, index) => values.slice(index).reduce(gcd));
  const notes: CashNote[] = [];
  function* visit(index: number, remaining: number): Generator<CashNote[]> {
    if (!remaining) { yield notes.map(note => ({ ...note })); return; }
    if (index >= values.length || remaining % divisors[index]) return;
    const denomination = values[index];
    if (index === values.length - 1) {
      yield [...notes.map(note => ({ ...note })), { denomination, quantity: remaining / denomination }];
      return;
    }
    for (let quantity = Math.floor(remaining / denomination); quantity >= 0; quantity--) {
      if (quantity) notes.push({ denomination, quantity });
      yield* visit(index + 1, remaining - quantity * denomination);
      if (quantity) notes.pop();
    }
  }
  yield* visit(0, amount);
}

export function changePage(amount: number, denominations: number[], page: number, size = 5) {
  const iterator = changeCombinations(amount, denominations);
  const offset = Math.max(0, page) * size;
  const items: CashNote[][] = [];
  let index = 0;
  for (const notes of iterator) {
    if (index++ < offset) continue;
    if (items.length === size) return { items, hasMore: true };
    items.push(notes);
  }
  return { items, hasMore: false };
}
