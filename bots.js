/* ==========================================================
   SECRET HITLER — bot decision logic
   Runs server-side. Pure functions over room state.
   ========================================================== */

const BOT_NAMES = [
  'Iris', 'Olive', 'Felix', 'Hugo', 'Mira', 'Cleo',
  'Theo', 'Ruby', 'Sage', 'Knox', 'Nova', 'Otto',
  'Lyra', 'Pip', 'Wren', 'Zane',
];

function pickBotName(takenLowerSet) {
  const free = BOT_NAMES.filter(n => !takenLowerSet.has(n.toLowerCase()));
  if (free.length === 0) {
    let i = 2;
    while (takenLowerSet.has(`bot${i}`)) i++;
    return `Bot${i}`;
  }
  return free[Math.floor(Math.random() * free.length)];
}

// ----- Helpers -----
function teammates(room, bot) {
  // What this bot considers their team (from their information).
  const dist = ROLE_DISTRIBUTION_LOOKUP[room.players.length];
  if (bot.role === 'fascist') {
    return room.players.filter(p =>
      p.token !== bot.token && (p.role === 'fascist' || p.role === 'hitler'));
  }
  if (bot.role === 'hitler' && dist && dist.hitlerKnowsFascists) {
    return room.players.filter(p => p.role === 'fascist');
  }
  return [];
}

const ROLE_DISTRIBUTION_LOOKUP = {
  5:  { hitlerKnowsFascists: true  },
  6:  { hitlerKnowsFascists: true  },
  7:  { hitlerKnowsFascists: false },
  8:  { hitlerKnowsFascists: false },
  9:  { hitlerKnowsFascists: false },
  10: { hitlerKnowsFascists: false },
};

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function chance(p) { return Math.random() < p; }

// ----- Decision: nominate -----
function pickChancellor(room, bot) {
  const s = room.state;
  const aliveCount = room.players.filter(p => p.alive).length;
  const eligible = room.players.filter(p =>
    p.alive
    && p.idx !== s.presidentIdx
    && p.idx !== s.prevChancellor
    && !(aliveCount > 5 && p.idx === s.prevPresident)
  );
  if (eligible.length === 0) return null;

  const team = teammates(room, bot);
  const teamTokens = new Set(team.map(t => t.token));

  // Fascist team strategy:
  // - If 3+ fascist policies down, try to nominate Hitler if eligible
  // - Otherwise prefer fellow fascists/hitler (but not too obvious early)
  if (bot.role === 'fascist' || bot.role === 'hitler') {
    if (s.fascistPolicies >= 3) {
      const hitlerOnTeam = room.players.find(p => p.role === 'hitler' && p.token !== bot.token);
      if (hitlerOnTeam && eligible.includes(hitlerOnTeam)) return hitlerOnTeam.idx;
    }
    const teamEligible = eligible.filter(p => teamTokens.has(p.token));
    if (teamEligible.length && chance(0.7)) return rand(teamEligible).idx;
  }

  // Liberal default: random eligible, with a slight bias against
  // someone everyone voted nein on previously (we don't track that —
  // keep it simple).
  return rand(eligible).idx;
}

// ----- Decision: vote -----
function pickVote(room, bot) {
  const s = room.state;
  const chancellor = room.players[s.chancellorIdx];

  // Hitler-as-Chancellor with 3+ fascist policies = instant fascist win
  const hitlerWinSetup = s.fascistPolicies >= 3 && chancellor.role === 'hitler';
  if (hitlerWinSetup) {
    if (bot.role === 'fascist' || bot.role === 'hitler') return 'ja';
    return 'nein';
  }

  // First couple of rounds, mostly vote ja to get the game moving
  if (s.round <= 2) {
    if (bot.role === 'liberal') return chance(0.85) ? 'ja' : 'nein';
    return chance(0.9) ? 'ja' : 'nein';
  }

  // Later: liberals get pickier, fascists still mostly ja unless a known
  // liberal is in power
  if (bot.role === 'liberal') {
    return chance(0.65) ? 'ja' : 'nein';
  }
  // Fascist team — prefer ja when a teammate is in the government
  const team = new Set(teammates(room, bot).map(t => t.token));
  const president = room.players[s.presidentIdx];
  const govHasTeam = team.has(president.token) || team.has(chancellor.token);
  if (govHasTeam) return chance(0.9) ? 'ja' : 'nein';
  return chance(0.7) ? 'ja' : 'nein';
}

// ----- Decision: president discard -----
function pickDiscard(room, bot, hand) {
  // hand is array of 'liberal' | 'fascist' (length 3) — return index to discard
  const isLiberal = bot.role === 'liberal';
  if (isLiberal) {
    // Discard a fascist if there is one
    const fIdx = hand.indexOf('fascist');
    if (fIdx !== -1) return fIdx;
    return 0;
  }
  // Fascist/Hitler: discard a liberal if possible
  const lIdx = hand.indexOf('liberal');
  if (lIdx !== -1) return lIdx;
  return 0;
}

// ----- Decision: chancellor enact -----
function pickEnact(room, bot, hand) {
  // hand length 2 — return index to enact
  const isLiberal = bot.role === 'liberal';
  if (isLiberal) {
    const lIdx = hand.indexOf('liberal');
    if (lIdx !== -1) return lIdx;
    return 0;
  }
  // Fascist/Hitler: enact fascist if available, but with a bit of
  // restraint — Hitler in particular doesn't want to look obviously bad.
  // Keep it simple: enact whichever benefits the team.
  const fIdx = hand.indexOf('fascist');
  if (fIdx !== -1) {
    // Hitler with 0-2 fasc policies down might play a liberal occasionally
    // to seem trustworthy
    if (bot.role === 'hitler' && room.state.fascistPolicies < 3 && hand.includes('liberal') && chance(0.3)) {
      return hand.indexOf('liberal');
    }
    return fIdx;
  }
  return 0;
}

// ----- Decision: power target -----
function pickPowerTarget(room, bot, kind) {
  const s = room.state;
  const others = room.players.filter(p =>
    p.alive && p.idx !== s.presidentIdx);

  if (kind === 'investigate') {
    const uninvestigated = others.filter(p => !p.investigated);
    if (uninvestigated.length === 0) return rand(others).idx;
    // Fascist bot: investigate a liberal (looks productive but reveals nothing useful to liberals)
    // Liberal bot: random — they don't know roles
    return rand(uninvestigated).idx;
  }

  if (kind === 'specialElection') {
    const team = new Set(teammates(room, bot).map(t => t.token));
    if (team.size > 0) {
      const teamMembers = others.filter(p => team.has(p.token));
      if (teamMembers.length && chance(0.8)) return rand(teamMembers).idx;
    }
    return rand(others).idx;
  }

  if (kind === 'execution') {
    const team = new Set(teammates(room, bot).map(t => t.token));
    if (bot.role === 'fascist' || bot.role === 'hitler') {
      // Avoid killing teammates
      const nonTeam = others.filter(p => !team.has(p.token));
      if (nonTeam.length) return rand(nonTeam).idx;
    }
    // Liberal: random — they don't know who's who
    return rand(others).idx;
  }

  return rand(others).idx;
}

// ----- Master decision -----
function decideBotAction(room, bot) {
  const s = room.state;
  if (!s) return null;

  // Acknowledge if I'm the one to advance
  if (s.ackForToken === bot.token) {
    return { type: 'advance' };
  }

  if (room.phase === 'voting') {
    if (!s.votes[bot.token] && bot.alive) {
      return { type: 'vote', vote: pickVote(room, bot) };
    }
    return null;
  }

  if (room.phase === 'nomination' && bot.idx === s.presidentIdx) {
    const targetIdx = pickChancellor(room, bot);
    if (targetIdx == null) return null;
    return { type: 'nominate', targetIdx };
  }

  if (room.phase === 'legislative-president' && bot.idx === s.presidentIdx) {
    return { type: 'discard', idx: pickDiscard(room, bot, s.handPresident) };
  }

  if (room.phase === 'legislative-chancellor' && bot.idx === s.chancellorIdx) {
    return { type: 'enact', idx: pickEnact(room, bot, s.handChancellor) };
  }

  if (room.phase === 'vetoDecision' && bot.idx === s.presidentIdx) {
    // Bots reject veto for simplicity — chancellor must enact a policy
    return { type: 'vetoDecision', accept: false };
  }

  if (room.phase === 'power-investigate' && bot.idx === s.presidentIdx) {
    return { type: 'choosePower', targetIdx: pickPowerTarget(room, bot, 'investigate') };
  }
  if (room.phase === 'power-specialElection' && bot.idx === s.presidentIdx) {
    return { type: 'choosePower', targetIdx: pickPowerTarget(room, bot, 'specialElection') };
  }
  if (room.phase === 'power-execution' && bot.idx === s.presidentIdx) {
    return { type: 'choosePower', targetIdx: pickPowerTarget(room, bot, 'execution') };
  }

  return null;
}

module.exports = { pickBotName, decideBotAction };
