export const SPORT_CONFIG = {
  NHL: {
    oddsKey: 'icehockey_nhl',
    markets: 'h2h,spreads,totals',
    label: 'NHL',
  },
  MLB: {
    oddsKey: 'baseball_mlb',
    markets: 'h2h,spreads,totals',
    label: 'MLB',
  },
  NBA: {
    oddsKey: 'basketball_nba',
    markets: 'h2h,spreads,totals',
    label: 'NBA',
  },
  NFL: {
    oddsKey: 'americanfootball_nfl',
    markets: 'h2h,spreads,totals',
    label: 'NFL',
  },
  NCAAB: {
    oddsKey: 'basketball_ncaab',
    markets: 'h2h,spreads,totals',
    label: 'NCAAB',
  },
  NCAAF: {
    oddsKey: 'americanfootball_ncaaf',
    markets: 'h2h,spreads,totals',
    label: 'NCAAF',
  },
  Soccer: {
    oddsKey: 'soccer_epl',
    markets: 'h2h,totals',
    label: 'Soccer (EPL)',
  },
  MLS: {
    oddsKey: 'soccer_usa_mls',
    markets: 'h2h,totals',
    label: 'MLS',
  },
};

export const SPORTS = Object.keys(SPORT_CONFIG);

export function formatOddsForClaude(games) {
  if (!games || games.length === 0) return 'No games found.';
  return games.slice(0, 20).map(g => {
    const commence = new Date(g.commence_time).toLocaleString();
    const book = g.bookmakers?.[0];
    if (!book) return `${g.home_team} vs ${g.away_team} @ ${commence} — no lines available`;
    const lines = book.markets.map(m => {
      if (m.key === 'h2h') {
        const home = m.outcomes.find(o => o.name === g.home_team);
        const away = m.outcomes.find(o => o.name === g.away_team);
        return `ML: ${g.home_team} ${fmtOdds(home?.price)} / ${g.away_team} ${fmtOdds(away?.price)}`;
      }
      if (m.key === 'spreads') {
        const home = m.outcomes.find(o => o.name === g.home_team);
        const away = m.outcomes.find(o => o.name === g.away_team);
        return `Spread: ${g.home_team} ${home?.point > 0 ? '+' : ''}${home?.point} (${fmtOdds(home?.price)}) / ${g.away_team} ${away?.point > 0 ? '+' : ''}${away?.point} (${fmtOdds(away?.price)})`;
      }
      if (m.key === 'totals') {
        const over = m.outcomes.find(o => o.name === 'Over');
        const under = m.outcomes.find(o => o.name === 'Under');
        return `Total: O${over?.point} (${fmtOdds(over?.price)}) / U${under?.point} (${fmtOdds(under?.price)})`;
      }
      return '';
    }).filter(Boolean).join(' | ');
    return `${g.home_team} vs ${g.away_team} @ ${commence}\n  ${lines}`;
  }).join('\n\n');
}

function fmtOdds(n) {
  if (n == null) return '?';
  return n > 0 ? `+${n}` : `${n}`;
}
