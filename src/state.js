// src/state.js

export const EMPTY_STATE = {
  bankroll: 1000,
  startingBankroll: 1000,
  myBankroll: 1000,
  myStartingBankroll: 1000,
  groqBankroll: 300,
  groqStartingBankroll: 300,
  bets: [],
  lessons: [],
  sessionLog: [],
  trackedPicks: [],
  // Self-learning parameters
  simTuning: {
    NHL: { lambdaMultiplier: 1.0, sampleSize: 0, lastUpdated: null },
    MLB: { lambdaMultiplier: 1.0, sampleSize: 0, lastUpdated: null },
    NBA: { lambdaMultiplier: 1.0, sampleSize: 0, lastUpdated: null },
    NFL: { lambdaMultiplier: 1.0, sampleSize: 0, lastUpdated: null },
  },
  betTypePerf: {
    Moneyline: { wins: 0, total: 0 },
    Spread: { wins: 0, total: 0 },
    Total: { wins: 0, total: 0 },
    Parlay: { wins: 0, total: 0 },
  },
  confTiers: {
    low: { wins: 0, total: 0 },    // 55-64%
    mid: { wins: 0, total: 0 },    // 65-74%
    high: { wins: 0, total: 0 },   // 75%+
  },
  mlPredictions: [],
};

const KEY = 'betlab_v3';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_STATE };
    const saved = JSON.parse(raw);
    return {
      ...EMPTY_STATE,
      ...saved,
      myBankroll: saved.myBankroll ?? saved.bankroll ?? 1000,
      myStartingBankroll: saved.myStartingBankroll ?? saved.startingBankroll ?? 1000,
      bets: Array.isArray(saved.bets) ? saved.bets : [],
      lessons: Array.isArray(saved.lessons) ? saved.lessons : [],
      sessionLog: Array.isArray(saved.sessionLog) ? saved.sessionLog : [],
      trackedPicks: Array.isArray(saved.trackedPicks) ? saved.trackedPicks : [],
      groqBankroll: saved.groqBankroll || 300,
      groqStartingBankroll: saved.groqStartingBankroll || 300,
      simTuning: saved.simTuning || {
        NHL: { lambdaMultiplier: 1.0, sampleSize: 0, lastUpdated: null },
        MLB: { lambdaMultiplier: 1.0, sampleSize: 0, lastUpdated: null },
        NBA: { lambdaMultiplier: 1.0, sampleSize: 0, lastUpdated: null },
        NFL: { lambdaMultiplier: 1.0, sampleSize: 0, lastUpdated: null },
      },
      betTypePerf: saved.betTypePerf || {
        Moneyline: { wins: 0, total: 0 },
        Spread: { wins: 0, total: 0 },
        Total: { wins: 0, total: 0 },
        Parlay: { wins: 0, total: 0 },
      },
      confTiers: saved.confTiers || {
        low: { wins: 0, total: 0 },
        mid: { wins: 0, total: 0 },
        high: { wins: 0, total: 0 },
      },
    };
  } catch (e) {
    console.warn('loadState error:', e);
    return { ...EMPTY_STATE };
  }
}

export function persist(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    console.warn('persist failed:', e);
  }
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
