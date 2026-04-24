// Tennis Model — Monte Carlo point-by-point simulation
// Data: Jeff Sackmann ATP CSV + tennis-data.co.uk odds + ESPN scoreboard

const ATP_CSV = 'https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_matches_2024.csv';
const WTA_CSV = 'https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_matches_2024.csv';
const TENNIS_DATA_BASE = 'http://www.tennis-data.co.uk';

// Monte Carlo tennis simulation
// Key insight: tennis is point-by-point, each point has fixed probability
function simulateMatch(p1ServeWin, p2ServeWin, bestOf=3, simulations=10000) {
  let p1Wins = 0;

  for (let s = 0; s < simulations; s++) {
    // p1 serves first
    let p1Sets = 0, p2Sets = 0;
    const setsToWin = Math.ceil(bestOf / 2);

    while (p1Sets < setsToWin && p2Sets < setsToWin) {
      // Simulate a set
      let p1Games = 0, p2Games = 0;
      let inTiebreak = false;

      while (true) {
        // Check for set win
        if (p1Games >= 6 && p1Games - p2Games >= 2) { p1Sets++; break; }
        if (p2Games >= 6 && p2Games - p2Games >= 2) { p2Sets++; break; }
        if (p1Games === 6 && p2Games === 6) {
          // Tiebreak - simulate 7 points (simplified)
          let tbP1 = 0, tbP2 = 0;
          while (true) {
            if (tbP1 >= 7 && tbP1 - tbP2 >= 2) { p1Games++; break; }
            if (tbP2 >= 7 && tbP2 - tbP1 >= 2) { p2Games++; break; }
            // Alternate serve in tiebreak
            if (Math.random() < p1ServeWin) tbP1++; else tbP2++;
          }
          if (p1Games > p2Games) p1Sets++; else p2Sets++;
          break;
        }

        // Simulate a game
        let gP1 = 0, gP2 = 0;
        const p1Serving = (p1Games + p2Games) % 2 === 0;
        const serveWin = p1Serving ? p1ServeWin : p2ServeWin;
        const returnWin = 1 - serveWin;

        while (true) {
          if (gP1 >= 4 && gP1 - gP2 >= 2) { if (p1Serving) p1Games++; else p2Games++; break; }
          if (gP2 >= 4 && gP2 - gP1 >= 2) { if (p1Serving) p2Games++; else p1Games++; break; }
          if (Math.random() < (p1Serving ? serveWin : returnWin)) gP1++; else gP2++;
        }
      }
    }
    if (p1Sets > p2Sets) p1Wins++;
  }

  return {
    p1WinProb: Math.round(p1Wins / simulations * 1000) / 10,
    p2WinProb: Math.round((simulations - p1Wins) / simulations * 1000) / 10,
  };
}

// Calculate surface-specific serve win % from Sackmann CSV
function parseServeStats(csvText, playerName, surface) {
  const lines = csvText.split('\n').slice(1);
  let svptTotal = 0, firstWonTotal = 0, secondWonTotal = 0, matches = 0;

  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length < 30) continue;
    const surf = cols[2]?.trim();
    if (surface && surf !== surface) continue;

    const winner = cols[10]?.trim();
    const loser = cols[18]?.trim();

    if (winner === playerName) {
      const svpt = parseFloat(cols[26])||0;
      const first = parseFloat(cols[28])||0;
      const second = parseFloat(cols[29])||0;
      if (svpt > 0) { svptTotal += svpt; firstWonTotal += first; secondWonTotal += second; matches++; }
    }
    if (loser === playerName) {
      const svpt = parseFloat(cols[36])||0;
      const first = parseFloat(cols[38])||0;
      const second = parseFloat(cols[39])||0;
      if (svpt > 0) { svptTotal += svpt; firstWonTotal += first; secondWonTotal += second; matches++; }
    }
  }

  if (svptTotal === 0) return null;
  return {
    serveWinPct: (firstWonTotal + secondWonTotal) / svptTotal,
    matches,
  };
}

// Calculate surface Elo from match history
function calcSurfaceElo(csvText, surface, kFactor=32) {
  const elos = {};
  const lines = csvText.split('\n').slice(1);

  for (const line of lines) {
    const cols = line.split(',');
    if (cols.length < 20) continue;
    const surf = cols[2]?.trim();
    if (surface && surf !== surface) continue;

    const winner = cols[10]?.trim();
    const loser = cols[18]?.trim();
    if (!winner || !loser) continue;

    if (!elos[winner]) elos[winner] = 1500;
    if (!elos[loser]) elos[loser] = 1500;

    const expW = 1 / (1 + Math.pow(10, (elos[loser] - elos[winner]) / 400));
    const expL = 1 - expW;
    elos[winner] += kFactor * (1 - expW);
    elos[loser] += kFactor * (0 - expL);
  }
  return elos;
}

function americanToImplied(odds) {
  const n = parseInt(odds);
  if (isNaN(n)) return 0.5;
  return n > 0 ? 100/(n+100) : Math.abs(n)/(Math.abs(n)+100);
}

function calcKelly(winProb, americanOdds) {
  const prob = winProb / 100;
  const odds = parseInt(americanOdds);
  const b = odds > 0 ? odds/100 : 100/Math.abs(odds);
  const kelly = Math.max(0, (b*prob - (1-prob)) / b);
  return Math.round(kelly/2 * 1000) / 10; // half Kelly
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const tour = req.query.tour || 'atp'; // atp or wta

  try {
    // Step 1: Fetch today's matches from ESPN
    const espnLeague = tour === 'wta' ? 'wta' : 'atp';
    const scoreboardRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/tennis/${espnLeague}/scoreboard`);
    const scoreboardData = await scoreboardRes.json();

    const events = scoreboardData.events || [];
    const allMatches = [];
    for (const event of events) {
      const surface = event.groupings?.[0]?.competitions?.[0]?.venue?.court?.includes('Clay') ? 'Clay' :
                      event.groupings?.[0]?.competitions?.[0]?.venue?.court?.includes('Grass') ? 'Grass' : 'Hard';
      const tournamentName = event.name || 'Unknown';
      const bestOf = event.groupings?.[0]?.competitions?.[0]?.format?.regulation?.periods || 3;

      for (const grouping of event.groupings || []) {
        for (const comp of grouping.competitions || []) {
          if (comp.status?.type?.state !== 'pre') continue;
          const players = comp.competitors || [];
          if (players.length < 2) continue;

          allMatches.push({
            id: comp.id,
            tournament: tournamentName,
            surface,
            bestOf,
            date: comp.date,
            court: comp.venue?.court || '',
            p1: {
              id: players[0]?.id,
              name: players[0]?.athlete?.displayName || 'Unknown',
              shortName: players[0]?.athlete?.shortName || '',
              seed: players[0]?.seeding || null,
            },
            p2: {
              id: players[1]?.id,
              name: players[1]?.athlete?.displayName || 'Unknown',
              shortName: players[1]?.athlete?.shortName || '',
              seed: players[1]?.seeding || null,
            },
          });
        }
      }
    }

    if (!allMatches.length) {
      return res.status(200).json({ success: true, tour, matches: [], message: 'No upcoming matches found' });
    }

    // Step 2: Fetch historical data for Elo and serve stats
    const csvUrl = tour === 'wta' ? WTA_CSV : ATP_CSV;
    const csvRes = await fetch(csvUrl);
    const csvText = await csvRes.text();

    // Step 3: Calculate surface Elo ratings
    const surfaceElos = {};
    for (const surf of ['Hard', 'Clay', 'Grass']) {
      surfaceElos[surf] = calcSurfaceElo(csvText, surf);
    }

    // Step 4: Process each match
    const results = [];
    for (const match of allMatches.slice(0, 20)) { // limit to 20 matches
      const surf = match.surface;
      const elos = surfaceElos[surf] || surfaceElos['Hard'];

      // Get surface Elo for each player
      const p1Elo = elos[match.p1.name] || 1500;
      const p2Elo = elos[match.p2.name] || 1500;

      // Get serve stats
      const p1Serve = parseServeStats(csvText, match.p1.name, surf);
      const p2Serve = parseServeStats(csvText, match.p2.name, surf);

      // Default serve win % if no data (ATP avg ~64%, WTA avg ~58%)
      const defaultServe = tour === 'wta' ? 0.58 : 0.64;
      const p1ServeWin = p1Serve?.serveWinPct || defaultServe;
      const p2ServeWin = p2Serve?.serveWinPct || defaultServe;

      // Adjust serve win % using Elo differential
      const eloDiff = (p1Elo - p2Elo) / 400;
      const eloAdj = eloDiff * 0.02; // small adjustment
      const p1AdjServe = Math.min(0.80, Math.max(0.45, p1ServeWin + eloAdj));
      const p2AdjServe = Math.min(0.80, Math.max(0.45, p2ServeWin - eloAdj));

      // Run Monte Carlo simulation
      const sim = simulateMatch(p1AdjServe, p2AdjServe, match.bestOf);

      // Get odds from ESPN core API
      let p1Odds = null, p2Odds = null;
      try {
        const oddsRes = await fetch(`https://sports.core.api.espn.com/v2/sports/tennis/leagues/${espnLeague}/events/${match.id}/competitions/${match.id}/odds`);
        const oddsData = await oddsRes.json();
        const item = oddsData.items?.[0];
        if (item) {
          p1Odds = item.homeTeamOdds?.moneyLine || null;
          p2Odds = item.awayTeamOdds?.moneyLine || null;
        }
      } catch {}

      // Calculate edge
      const p1Implied = p1Odds ? americanToImplied(p1Odds) * 100 : 50;
      const p2Implied = p2Odds ? americanToImplied(p2Odds) * 100 : 50;
      const p1Edge = sim.p1WinProb - p1Implied;
      const p2Edge = sim.p2WinProb - p2Implied;

      // Determine recommendation
      let recommendation = 'PASS';
      let recPlayer = null;
      let recOdds = null;
      let recEdge = 0;
      let rating = 'SKIP';

      if (p1Edge > p2Edge && p1Edge >= 5 && p1Odds) {
        recommendation = 'BET';
        recPlayer = match.p1.name;
        recOdds = p1Odds;
        recEdge = p1Edge;
        rating = p1Edge >= 10 ? 'STRONG BET' : 'VALUE BET';
      } else if (p2Edge >= 5 && p2Odds) {
        recommendation = 'BET';
        recPlayer = match.p2.name;
        recOdds = p2Odds;
        recEdge = p2Edge;
        rating = p2Edge >= 10 ? 'STRONG BET' : 'VALUE BET';
      }

      const kelly = recOdds ? calcKelly(recPlayer === match.p1.name ? sim.p1WinProb : sim.p2WinProb, recOdds) : 0;

      results.push({
        tournament: match.tournament,
        surface: match.surface,
        court: match.court,
        date: match.date,
        p1: match.p1.name,
        p2: match.p2.name,
        p1Seed: match.p1.seed,
        p2Seed: match.p2.seed,
        p1Elo: Math.round(p1Elo),
        p2Elo: Math.round(p2Elo),
        p1ServeWin: Math.round(p1AdjServe * 100),
        p2ServeWin: Math.round(p2AdjServe * 100),
        p1WinProb: sim.p1WinProb,
        p2WinProb: sim.p2WinProb,
        p1Odds,
        p2Odds,
        p1Implied: Math.round(p1Implied * 10) / 10,
        p2Implied: Math.round(p2Implied * 10) / 10,
        p1Edge: Math.round(p1Edge * 10) / 10,
        p2Edge: Math.round(p2Edge * 10) / 10,
        recommendation,
        recPlayer,
        recOdds,
        recEdge: Math.round(recEdge * 10) / 10,
        rating,
        kelly,
        bestOf: match.bestOf,
        p1DataMatches: p1Serve?.matches || 0,
        p2DataMatches: p2Serve?.matches || 0,
      });
    }

    // Sort by edge
    results.sort((a, b) => Math.abs(b.recEdge) - Math.abs(a.recEdge));

    return res.status(200).json({
      success: true,
      tour: tour.toUpperCase(),
      date: new Date().toISOString().split('T')[0],
      totalMatches: allMatches.length,
      analyzed: results.length,
      bets: results.filter(r => r.recommendation === 'BET'),
      allMatches: results,
    });

  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
