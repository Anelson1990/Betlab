export const EMPTY_STATE = {
  bankroll: 1000,
  startingBankroll: 1000,
  bets: [],
  lessons: [],
  sessionLog: [],
};

const KEY = 'betlab_v3';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY_STATE, ...JSON.parse(raw) };
  } catch {}
  return { ...EMPTY_STATE };
}

export function persist(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}
export function americanToDecimal(odds) {
  const n = parseInt(odds);
  if (isNaN(n)) return 1;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}
export function impliedProb(odds) {
  const n = parseInt(odds);
  if (isNaN(n)) return 50;
  return n > 0 ? (100 / (n + 100)) * 100 : (Math.abs(n) / (Math.abs(n) + 100)) * 100;
}
export function formatMoney(n) {
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toFixed(2);
}
export function formatOdds(n) {
  return n > 0 ? `+${n}` : `${n}`;
}
