/* ==========================================================
   SECRET HITLER — multiplayer server
   Node 18+, ws package
   Rooms identified by 4-letter codes. Each player has a token
   stored client-side for reconnection.
   ========================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { pickBotName, decideBotAction } = require('./bots');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const BOT_TICK_MS = 1100;     // delay between bot actions (feels human)
const BOT_TICK_JITTER = 600;  // random extra delay

// ==========================================================
// GAME RULES TABLES
// ==========================================================
const ROLE_DISTRIBUTION = {
  5:  { liberals: 3, fascists: 1, hitlerKnowsFascists: true  },
  6:  { liberals: 4, fascists: 1, hitlerKnowsFascists: true  },
  7:  { liberals: 4, fascists: 2, hitlerKnowsFascists: false },
  8:  { liberals: 5, fascists: 2, hitlerKnowsFascists: false },
  9:  { liberals: 5, fascists: 3, hitlerKnowsFascists: false },
  10: { liberals: 6, fascists: 3, hitlerKnowsFascists: false },
};

// powers indexed by fascist policies enacted (1..5)
const FASCIST_POWERS = {
  5:  [null, null, 'peek', 'execution', 'execution'],
  6:  [null, null, 'peek', 'execution', 'execution'],
  7:  [null, 'investigate', 'specialElection', 'execution', 'execution'],
  8:  [null, 'investigate', 'specialElection', 'execution', 'execution'],
  9:  ['investigate', 'investigate', 'specialElection', 'execution', 'execution'],
  10: ['investigate', 'investigate', 'specialElection', 'execution', 'execution'],
};

// ==========================================================
// UTILITIES
// ==========================================================
function uid()  { return crypto.randomBytes(16).toString('hex'); }
function code() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // skip I,L,O for clarity
  let s = '';
  for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ==========================================================
// ROOMS
// ==========================================================
const rooms = new Map(); // code -> Room

function newRoomCode() {
  let c;
  do { c = code(); } while (rooms.has(c));
  return c;
}

function makeRoom(hostToken) {
  const c = newRoomCode();
  const room = {
    code: c,
    hostToken,
    createdAt: Date.now(),
    players: [],         // { token, name, role, alive, investigated, connected, idx }
    sockets: new Map(),  // token -> ws
    phase: 'lobby',
    state: null,
  };
  rooms.set(c, room);
  return room;
}

function freshGameState() {
  return {
    presidentIdx: 0,
    chancellorIdx: null,
    prevPresident: null,
    prevChancellor: null,
    nominee: null,
    specialElectionReturn: null,
    deck: [],
    discard: [],
    handPresident: [],
    handChancellor: [],
    liberalPolicies: 0,
    fascistPolicies: 0,
    electionTracker: 0,
    votes: {},
    voteOrder: [],
    voteRevealed: false,
    round: 1,
    log: [],
    history: [],          // structured per-round event timeline
    pendingVeto: null,
    lastInvestigation: null,  // { byToken, targetIdx, party }
    lastPeek: null,           // { byToken, cards }
    enactedPolicy: null,      // for reveal
    enactedChaos: false,
    pendingPower: null,       // 'investigate' | 'peek' | 'specialElection' | 'execution'
    pendingPowerForToken: null,
    ackForToken: null,        // who needs to acknowledge to advance
    winner: null,
    winReason: '',
  };
}

// ==========================================================
// MESSAGING
// ==========================================================
function send(ws, type, payload = {}) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}

function broadcastRoom(room) {
  for (const p of room.players) {
    if (p.isBot) continue;
    const ws = room.sockets.get(p.token);
    if (!ws) continue;
    send(ws, 'state', { state: viewFor(room, p.token) });
  }
  scheduleBotTick(room);
}

// ==========================================================
// BOT SCHEDULER
// ==========================================================
function scheduleBotTick(room) {
  if (!room.players.some(p => p.isBot)) return;
  if (room.phase === 'lobby' || room.phase === 'roleReveal' || room.phase === 'end') return;
  if (room._botTimer) return; // already scheduled
  const delay = BOT_TICK_MS + Math.floor(Math.random() * BOT_TICK_JITTER);
  room._botTimer = setTimeout(() => {
    room._botTimer = null;
    runBotTick(room);
  }, delay);
}

function runBotTick(room) {
  if (!room.state) return;
  // Pick the first bot that has something to do.
  // Order: in voting phase, randomize so bots don't always vote in same order.
  const order = [...room.players];
  if (room.phase === 'voting') {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  for (const bot of order) {
    if (!bot.isBot) continue;
    if (!bot.alive && room.phase !== 'end') continue;
    const action = decideBotAction(room, bot);
    if (!action) continue;
    applyBotAction(room, bot, action);
    return; // broadcastRoom inside the apply will reschedule
  }
}

function applyBotAction(room, bot, action) {
  switch (action.type) {
    case 'advance':       return handleAdvance(room, bot.token);
    case 'vote':          return handleVote(room, bot.token, action.vote);
    case 'nominate':      return handleNominate(room, bot.token, action.targetIdx);
    case 'discard':       return handleDiscard(room, bot.token, action.idx);
    case 'enact':         return handleEnact(room, bot.token, action.idx);
    case 'vetoDecision':  return handleVetoDecision(room, bot.token, !!action.accept);
    case 'choosePower':   return handleChoosePower(room, bot.token, action.targetIdx);
  }
}

function logEvent(room, text, cls = '') {
  room.state.log.push({ text, cls, round: room.state.round, ts: Date.now() });
  if (room.state.log.length > 200) room.state.log.shift();
}

function pushHistory(room, entry) {
  room.state.history.push({ round: room.state.round, ts: Date.now(), ...entry });
  if (room.state.history.length > 100) room.state.history.shift();
}

// ==========================================================
// PER-PLAYER VIEW
// ==========================================================
function viewFor(room, token) {
  const me = room.players.find(p => p.token === token);
  if (!me) return null;

  const dist = room.players.length >= 5 ? ROLE_DISTRIBUTION[room.players.length] : null;
  const isOver = room.phase === 'end';

  // Players list — strip role unless game is over or visibility allowed
  const players = room.players.map(p => {
    const showRole = isOver
      || (me.token === p.token)
      || (me.role === 'fascist' && (p.role === 'fascist' || p.role === 'hitler'))
      || (me.role === 'hitler' && p.role === 'fascist' && dist && dist.hitlerKnowsFascists);
    return {
      idx: p.idx,
      token: p.token,
      name: p.name,
      alive: p.alive,
      investigated: p.investigated,
      confirmedNotHitler: !!p.confirmedNotHitler,
      connected: p.connected,
      isHost: p.token === room.hostToken,
      isBot: !!p.isBot,
      role: showRole ? p.role : null,
    };
  });

  const baseView = {
    code: room.code,
    phase: room.phase,
    youIdx: me.idx,
    youToken: me.token,
    youName: me.name,
    youRole: me.role,
    isHost: me.token === room.hostToken,
    players,
    dist,
  };

  if (room.phase === 'lobby' || room.phase === 'end') {
    return {
      ...baseView,
      winner: room.state ? room.state.winner : null,
      winReason: room.state ? room.state.winReason : '',
      history: room.state ? room.state.history.slice(-50) : [],
      log: room.state ? room.state.log.slice(-60) : [],
      round: room.state ? room.state.round : 0,
    };
  }

  // In-game view
  const s = room.state;
  const view = {
    ...baseView,
    round: s.round,
    presidentIdx: s.presidentIdx,
    chancellorIdx: s.chancellorIdx,
    prevPresident: s.prevPresident,
    prevChancellor: s.prevChancellor,
    nominee: s.nominee,
    liberalPolicies: s.liberalPolicies,
    fascistPolicies: s.fascistPolicies,
    electionTracker: s.electionTracker,
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    log: s.log.slice(-60),
    history: s.history.slice(-50),
    enactedPolicy: s.enactedPolicy,
    enactedChaos: s.enactedChaos,
    pendingVeto: s.pendingVeto,
    pendingPower: s.pendingPower,
    pendingPowerForIdx: s.pendingPowerForToken
      ? room.players.find(p => p.token === s.pendingPowerForToken)?.idx ?? null
      : null,
    voteState: room.phase === 'voting' || room.phase === 'voteReveal' ? {
      revealed: s.voteRevealed,
      hasVoted: Object.keys(s.votes),     // tokens that have voted
      total: s.voteOrder.length,
      myVote: s.votes[token] || null,
      votes: s.voteRevealed ? s.votes : null,
    } : null,
    fascistPowers: FASCIST_POWERS[room.players.length] || [],
  };

  // Private hand views
  if (room.phase === 'legislative-president' && me.idx === s.presidentIdx) {
    view.myHand = s.handPresident;
    view.canVeto = false;
  }
  if (room.phase === 'legislative-chancellor' && me.idx === s.chancellorIdx) {
    view.myHand = s.handChancellor;
    view.canVeto = s.fascistPolicies >= 5;
  }

  // Power result reveals
  if (s.lastInvestigation && s.lastInvestigation.byToken === token) {
    view.investigationResult = {
      targetIdx: s.lastInvestigation.targetIdx,
      targetName: room.players[s.lastInvestigation.targetIdx].name,
      party: s.lastInvestigation.party,
    };
  }
  if (s.lastPeek && s.lastPeek.byToken === token) {
    view.peekResult = s.lastPeek.cards;
  }

  // Whose acknowledgement advances current step
  view.ackForIdx = s.ackForToken
    ? room.players.find(p => p.token === s.ackForToken)?.idx ?? null
    : null;
  view.ackForMe = s.ackForToken === token;
  return view;
}

// ==========================================================
// GAME FLOW
// ==========================================================
function startGame(room) {
  if (room.players.length < 5 || room.players.length > 10) {
    return { error: 'Need 5–10 players to start.' };
  }
  const dist = ROLE_DISTRIBUTION[room.players.length];

  const roles = [];
  for (let i = 0; i < dist.liberals; i++) roles.push('liberal');
  for (let i = 0; i < dist.fascists; i++) roles.push('fascist');
  roles.push('hitler');
  shuffle(roles);

  // Re-index players in shuffled seat order
  shuffle(room.players);
  room.players.forEach((p, i) => {
    p.idx = i;
    p.role = roles[i];
    p.alive = true;
    p.investigated = false;
  });

  room.state = freshGameState();
  room.state.deck = shuffle([...Array(6).fill('liberal'), ...Array(11).fill('fascist')]);
  room.state.presidentIdx = Math.floor(Math.random() * room.players.length);

  room.phase = 'roleReveal';
  logEvent(room, 'Game begins.');
  broadcastRoom(room);
  return { ok: true };
}

function beginNomination(room) {
  const s = room.state;
  s.chancellorIdx = null;
  s.nominee = null;
  s.votes = {};
  s.voteOrder = room.players.filter(p => p.alive).map(p => p.token);
  s.voteRevealed = false;
  s.enactedPolicy = null;
  s.enactedChaos = false;
  s.lastInvestigation = null;
  s.lastPeek = null;
  s.pendingPower = null;
  s.pendingPowerForToken = null;
  s.ackForToken = null;
  room.phase = 'nomination';
  broadcastRoom(room);
}

function advancePresident(room) {
  const s = room.state;
  if (s.specialElectionReturn != null) {
    s.presidentIdx = s.specialElectionReturn;
    s.specialElectionReturn = null;
  }
  do {
    s.presidentIdx = (s.presidentIdx + 1) % room.players.length;
  } while (!room.players[s.presidentIdx].alive);
}

function ensureDeck(room, n) {
  const s = room.state;
  if (s.deck.length < n) {
    s.deck = shuffle([...s.deck, ...s.discard]);
    s.discard = [];
    logEvent(room, 'Deck reshuffled.');
  }
}

function reshuffleIfLow(room) {
  const s = room.state;
  if (s.deck.length < 3) {
    s.deck = shuffle([...s.deck, ...s.discard]);
    s.discard = [];
  }
}

function nextRound(room) {
  const s = room.state;
  reshuffleIfLow(room);
  advancePresident(room);
  s.round++;
  beginNomination(room);
}

function eligibleChancellors(room) {
  const s = room.state;
  const alive = room.players.filter(p => p.alive).length;
  return room.players
    .filter(p => p.alive && p.idx !== s.presidentIdx
      && p.idx !== s.prevChancellor
      && !(alive > 5 && p.idx === s.prevPresident))
    .map(p => p.idx);
}

function handleNominate(room, token, targetIdx) {
  const s = room.state;
  if (room.phase !== 'nomination') return;
  const me = room.players.find(p => p.token === token);
  if (!me || me.idx !== s.presidentIdx) return;
  if (!eligibleChancellors(room).includes(targetIdx)) return;

  s.chancellorIdx = targetIdx;
  s.votes = {};
  s.voteRevealed = false;
  room.phase = 'voting';
  logEvent(room, `${room.players[s.presidentIdx].name} nominates ${room.players[targetIdx].name}.`);
  broadcastRoom(room);
}

function handleVote(room, token, vote) {
  const s = room.state;
  if (room.phase !== 'voting') return;
  const me = room.players.find(p => p.token === token);
  if (!me || !me.alive) return;
  if (vote !== 'ja' && vote !== 'nein') return;
  s.votes[token] = vote;

  // All votes in?
  if (Object.keys(s.votes).length >= s.voteOrder.length) {
    s.voteRevealed = true;
    room.phase = 'voteReveal';
    s.ackForToken = room.players[s.presidentIdx].token; // president advances
  }
  broadcastRoom(room);
}

function handleAdvance(room, token) {
  const s = room.state;

  // Advance from vote reveal → next phase
  if (room.phase === 'voteReveal') {
    if (s.ackForToken !== token) return;
    const ja = Object.values(s.votes).filter(v => v === 'ja').length;
    const nein = Object.values(s.votes).filter(v => v === 'nein').length;
    const passed = ja > nein;
    if (passed) {
      logEvent(room, `Government elected: ${room.players[s.presidentIdx].name} & ${room.players[s.chancellorIdx].name} (${ja}-${nein}).`);
      // Hitler-as-Chancellor instant win — checked at 3+ fascist policies
      if (s.fascistPolicies >= 3) {
        const chan = room.players[s.chancellorIdx];
        if (chan.role === 'hitler') {
          return endGame(room, 'fascist', 'Hitler was elected Chancellor with 3+ fascist policies.');
        }
        // Per official rules: "Otherwise, other players know for sure the Chancellor is not Hitler."
        if (!chan.confirmedNotHitler) {
          chan.confirmedNotHitler = true;
          logEvent(room, `${chan.name} confirmed: NOT Hitler.`);
          pushHistory(room, { kind: 'notHitler', chanIdx: s.chancellorIdx });
        }
      }
      s.electionTracker = 0;
      // Move to legislative session: president picks
      ensureDeck(room, 3);
      s.handPresident = s.deck.splice(0, 3);
      room.phase = 'legislative-president';
      s.ackForToken = null;
      broadcastRoom(room);
    } else {
      logEvent(room, `Election failed (${ja}-${nein}). Tracker ${s.electionTracker + 1}/3.`);
      pushHistory(room, {
        kind: 'failedElection',
        presIdx: s.presidentIdx,
        chanIdx: s.chancellorIdx,
        ja, nein,
      });
      s.electionTracker++;
      if (s.electionTracker >= 3) {
        room.phase = 'chaos';
        ensureDeck(room, 1);
        s.enactedPolicy = s.deck.shift();
        s.enactedChaos = true;
        s.ackForToken = room.players[s.presidentIdx].token;
        broadcastRoom(room);
      } else {
        advancePresident(room);
        s.round++;
        beginNomination(room);
      }
    }
    return;
  }

  // Advance from chaos reveal
  if (room.phase === 'chaos') {
    if (s.ackForToken !== token) return;
    const policy = s.enactedPolicy;
    if (policy === 'liberal') {
      s.liberalPolicies++;
      logEvent(room, 'Chaos: liberal policy enacted.', 'policy-lib');
    } else {
      s.fascistPolicies++;
      logEvent(room, 'Chaos: fascist policy enacted.', 'policy-fasc');
    }
    pushHistory(room, { kind: 'chaos', policy });
    s.electionTracker = 0;
    s.prevPresident = null;
    s.prevChancellor = null;
    s.enactedPolicy = null;
    s.enactedChaos = false;
    s.ackForToken = null;
    if (checkPolicyWin(room)) return;
    nextRound(room);
    return;
  }

  // Advance from policy enacted reveal
  if (room.phase === 'policyEnacted') {
    if (s.ackForToken !== token) return;
    if (checkPolicyWin(room)) return;

    // Determine if a power is unlocked
    const power = s.enactedPolicy === 'fascist'
      ? FASCIST_POWERS[room.players.length][s.fascistPolicies - 1]
      : null;

    s.prevPresident = s.presidentIdx;
    s.prevChancellor = s.chancellorIdx;
    s.enactedPolicy = null;

    if (power) {
      s.pendingPower = power;
      s.pendingPowerForToken = room.players[s.presidentIdx].token;
      s.ackForToken = null;

      if (power === 'peek') {
        ensureDeck(room, 3);
        s.lastPeek = { byToken: room.players[s.presidentIdx].token, cards: s.deck.slice(0, 3) };
        pushHistory(room, { kind: 'power', power: 'peek', byIdx: s.presidentIdx });
        room.phase = 'power-peek';
        s.ackForToken = room.players[s.presidentIdx].token;
        broadcastRoom(room);
        return;
      }
      room.phase = 'power-' + power;
      broadcastRoom(room);
      return;
    }
    nextRound(room);
    return;
  }

  // Advance from peek reveal (after pres saw cards)
  if (room.phase === 'power-peek') {
    if (s.ackForToken !== token) return;
    s.lastPeek = null;
    s.pendingPower = null;
    s.pendingPowerForToken = null;
    s.ackForToken = null;
    nextRound(room);
    return;
  }

  // Advance from investigation reveal (after pres saw party)
  if (room.phase === 'investigationReveal') {
    if (s.ackForToken !== token) return;
    s.lastInvestigation = null;
    s.pendingPower = null;
    s.pendingPowerForToken = null;
    s.ackForToken = null;
    nextRound(room);
    return;
  }

  // Advance from execution reveal
  if (room.phase === 'executionReveal') {
    if (s.ackForToken !== token) return;
    s.pendingPower = null;
    s.pendingPowerForToken = null;
    s.ackForToken = null;
    nextRound(room);
    return;
  }
}

function handleDiscard(room, token, idx) {
  const s = room.state;
  if (room.phase !== 'legislative-president') return;
  const me = room.players.find(p => p.token === token);
  if (!me || me.idx !== s.presidentIdx) return;
  if (idx < 0 || idx >= s.handPresident.length) return;

  const discarded = s.handPresident.splice(idx, 1)[0];
  s.discard.push(discarded);
  s.handChancellor = s.handPresident;
  s.handPresident = [];
  room.phase = 'legislative-chancellor';
  broadcastRoom(room);
}

function handleEnact(room, token, idx) {
  const s = room.state;
  if (room.phase !== 'legislative-chancellor') return;
  const me = room.players.find(p => p.token === token);
  if (!me || me.idx !== s.chancellorIdx) return;
  if (idx < 0 || idx >= s.handChancellor.length) return;

  const enacted = s.handChancellor.splice(idx, 1)[0];
  s.discard.push(...s.handChancellor);
  s.handChancellor = [];

  if (enacted === 'liberal') {
    s.liberalPolicies++;
    logEvent(room, `${me.name} enacted a liberal policy.`, 'policy-lib');
  } else {
    s.fascistPolicies++;
    logEvent(room, `${me.name} enacted a fascist policy.`, 'policy-fasc');
  }
  // Record the structured event with vote tally
  const ja = Object.values(s.votes).filter(v => v === 'ja').length;
  const nein = Object.values(s.votes).filter(v => v === 'nein').length;
  pushHistory(room, {
    kind: 'enactment',
    presIdx: s.presidentIdx,
    chanIdx: s.chancellorIdx,
    policy: enacted,
    ja, nein,
  });
  s.enactedPolicy = enacted;
  s.enactedChaos = false;
  room.phase = 'policyEnacted';
  s.ackForToken = room.players[s.presidentIdx].token;
  broadcastRoom(room);
}

function handleProposeVeto(room, token) {
  const s = room.state;
  if (room.phase !== 'legislative-chancellor') return;
  if (s.fascistPolicies < 5) return;
  const me = room.players.find(p => p.token === token);
  if (!me || me.idx !== s.chancellorIdx) return;
  s.pendingVeto = { proposedBy: me.idx };
  room.phase = 'vetoDecision';
  logEvent(room, `${me.name} proposed a veto.`);
  broadcastRoom(room);
}

function handleVetoDecision(room, token, accept) {
  const s = room.state;
  if (room.phase !== 'vetoDecision') return;
  const me = room.players.find(p => p.token === token);
  if (!me || me.idx !== s.presidentIdx) return;

  if (accept) {
    s.discard.push(...s.handChancellor);
    s.handChancellor = [];
    s.pendingVeto = null;
    logEvent(room, `Veto accepted. Both policies discarded.`);
    pushHistory(room, {
      kind: 'veto',
      presIdx: s.presidentIdx,
      chanIdx: s.chancellorIdx,
    });
    s.electionTracker++;
    if (s.electionTracker >= 3) {
      room.phase = 'chaos';
      ensureDeck(room, 1);
      s.enactedPolicy = s.deck.shift();
      s.enactedChaos = true;
      s.ackForToken = room.players[s.presidentIdx].token;
      broadcastRoom(room);
    } else {
      reshuffleIfLow(room);
      advancePresident(room);
      s.round++;
      beginNomination(room);
    }
  } else {
    s.pendingVeto = null;
    room.phase = 'legislative-chancellor';
    logEvent(room, `Veto rejected. Chancellor must enact a policy.`);
    broadcastRoom(room);
  }
}

function handleChoosePower(room, token, targetIdx) {
  const s = room.state;
  const me = room.players.find(p => p.token === token);
  if (!me || me.idx !== s.presidentIdx) return;
  const target = room.players[targetIdx];
  if (!target || !target.alive || target.idx === s.presidentIdx) return;

  if (room.phase === 'power-investigate') {
    if (target.investigated) return;
    target.investigated = true;
    const party = target.role === 'liberal' ? 'liberal' : 'fascist';
    s.lastInvestigation = { byToken: me.token, targetIdx, party };
    logEvent(room, `${me.name} investigated ${target.name}.`);
    pushHistory(room, { kind: 'power', power: 'investigate', byIdx: me.idx, targetIdx });
    room.phase = 'investigationReveal';
    s.ackForToken = me.token;
    broadcastRoom(room);
    return;
  }

  if (room.phase === 'power-specialElection') {
    s.specialElectionReturn = s.presidentIdx;
    s.presidentIdx = target.idx;
    s.pendingPower = null;
    s.pendingPowerForToken = null;
    logEvent(room, `${me.name} called special election: ${target.name} becomes President.`);
    pushHistory(room, { kind: 'power', power: 'specialElection', byIdx: me.idx, targetIdx });
    s.round++;
    beginNomination(room);
    return;
  }

  if (room.phase === 'power-execution') {
    target.alive = false;
    logEvent(room, `${me.name} executed ${target.name}.`, 'death');
    pushHistory(room, { kind: 'power', power: 'execution', byIdx: me.idx, targetIdx });
    if (target.role === 'hitler') {
      return endGame(room, 'liberal', `Hitler (${target.name}) was executed.`);
    }
    room.phase = 'executionReveal';
    s.ackForToken = me.token;
    broadcastRoom(room);
    return;
  }
}

function checkPolicyWin(room) {
  const s = room.state;
  if (s.liberalPolicies >= 5) { endGame(room, 'liberal', 'Five liberal policies enacted.'); return true; }
  if (s.fascistPolicies >= 6) { endGame(room, 'fascist', 'Six fascist policies enacted.'); return true; }
  return false;
}

function endGame(room, winner, reason) {
  room.phase = 'end';
  room.state.winner = winner;
  room.state.winReason = reason;
  logEvent(room, `${winner.toUpperCase()} WIN: ${reason}`);
  broadcastRoom(room);
}

// ==========================================================
// CONNECTION HANDLERS
// ==========================================================
function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  switch (msg.type) {
    case 'create': return onCreate(ws, msg);
    case 'join':   return onJoin(ws, msg);
    case 'rejoin': return onRejoin(ws, msg);
    case 'leave':  return onLeave(ws);
    case 'start':  return onStart(ws);
    case 'restart': return onRestart(ws);
    case 'addBot':    return onAddBot(ws);
    case 'removeBot': return onRemoveBot(ws);
    case 'action': return onAction(ws, msg);
  }
}

function onCreate(ws, msg) {
  const name = (msg.name || '').toString().trim().slice(0, 14);
  if (!name) return send(ws, 'error', { message: 'Name required.' });
  const token = uid();
  const room = makeRoom(token);
  const player = { token, name, role: null, alive: true, investigated: false, connected: true, idx: 0, isBot: false };
  room.players.push(player);
  room.sockets.set(token, ws);
  ws._roomCode = room.code;
  ws._token = token;
  send(ws, 'joined', { code: room.code, token, youName: name });
  broadcastRoom(room);
}

function onJoin(ws, msg) {
  const name = (msg.name || '').toString().trim().slice(0, 14);
  const code = (msg.code || '').toString().trim().toUpperCase();
  if (!name) return send(ws, 'error', { message: 'Name required.' });
  const room = rooms.get(code);
  if (!room) return send(ws, 'error', { message: 'Room not found.' });
  if (room.phase !== 'lobby') return send(ws, 'error', { message: 'Game already in progress. Ask the host to restart.' });
  if (room.players.length >= 10) return send(ws, 'error', { message: 'Room is full (max 10).' });
  if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase()))
    return send(ws, 'error', { message: 'Name already taken in this room.' });

  const token = uid();
  const player = { token, name, role: null, alive: true, investigated: false, connected: true, idx: room.players.length, isBot: false };
  room.players.push(player);
  room.sockets.set(token, ws);
  ws._roomCode = room.code;
  ws._token = token;
  send(ws, 'joined', { code: room.code, token, youName: name });
  broadcastRoom(room);
}

function onAddBot(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (ws._token !== room.hostToken) return send(ws, 'error', { message: 'Only the host can add bots.' });
  if (room.phase !== 'lobby') return send(ws, 'error', { message: 'Bots can only be added in the lobby.' });
  if (room.players.length >= 10) return send(ws, 'error', { message: 'Room is full (max 10).' });
  const taken = new Set(room.players.map(p => p.name.toLowerCase()));
  const name = pickBotName(taken);
  const token = uid();
  const player = {
    token, name, role: null, alive: true, investigated: false,
    connected: true, idx: room.players.length, isBot: true,
  };
  room.players.push(player);
  broadcastRoom(room);
}

function onRemoveBot(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (ws._token !== room.hostToken) return send(ws, 'error', { message: 'Only the host can remove bots.' });
  if (room.phase !== 'lobby') return send(ws, 'error', { message: 'Bots can only be removed in the lobby.' });
  // Remove the most recently added bot
  for (let i = room.players.length - 1; i >= 0; i--) {
    if (room.players[i].isBot) {
      room.players.splice(i, 1);
      break;
    }
  }
  room.players.forEach((p, i) => p.idx = i);
  broadcastRoom(room);
}

function onRejoin(ws, msg) {
  const code = (msg.code || '').toString().trim().toUpperCase();
  const token = (msg.token || '').toString();
  const room = rooms.get(code);
  if (!room) return send(ws, 'error', { message: 'Room no longer exists.' });
  const player = room.players.find(p => p.token === token);
  if (!player) return send(ws, 'error', { message: 'You are not in this room.' });
  // Replace any old socket
  const prev = room.sockets.get(token);
  if (prev && prev !== ws) try { prev.close(); } catch {}
  room.sockets.set(token, ws);
  player.connected = true;
  ws._roomCode = room.code;
  ws._token = token;
  send(ws, 'joined', { code: room.code, token, youName: player.name });
  broadcastRoom(room);
}

function onLeave(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  const token = ws._token;
  if (room.phase === 'lobby') {
    // Remove from players
    room.players = room.players.filter(p => p.token !== token);
    room.players.forEach((p, i) => p.idx = i);
    if (token === room.hostToken && room.players.length > 0) {
      room.hostToken = room.players[0].token;
    }
    if (room.players.length === 0) { rooms.delete(room.code); return; }
  } else {
    // Mid-game: keep their seat, mark disconnected
    const p = room.players.find(p => p.token === token);
    if (p) p.connected = false;
  }
  room.sockets.delete(token);
  broadcastRoom(room);
}

function onStart(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (ws._token !== room.hostToken) return send(ws, 'error', { message: 'Only the host can start.' });
  if (room.phase !== 'lobby') return;
  const r = startGame(room);
  if (r.error) return send(ws, 'error', { message: r.error });
}

function onRestart(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (ws._token !== room.hostToken) return send(ws, 'error', { message: 'Only the host can restart.' });
  // Reset roles, keep players
  room.players.forEach(p => { p.role = null; p.alive = true; p.investigated = false; });
  room.state = null;
  room.phase = 'lobby';
  broadcastRoom(room);
}

function onAction(ws, msg) {
  const room = rooms.get(ws._roomCode);
  if (!room || !room.state) return;
  const token = ws._token;

  switch (msg.action) {
    case 'roleAck':
      // Check if all alive players have ack'd via tracking on socket
      // Simpler: any host can advance from roleReveal
      if (room.phase === 'roleReveal' && token === room.hostToken) {
        beginNomination(room);
      }
      return;
    case 'nominate':       return handleNominate(room, token, msg.targetIdx);
    case 'vote':           return handleVote(room, token, msg.vote);
    case 'advance':        return handleAdvance(room, token);
    case 'discard':        return handleDiscard(room, token, msg.idx);
    case 'enact':          return handleEnact(room, token, msg.idx);
    case 'proposeVeto':    return handleProposeVeto(room, token);
    case 'vetoDecision':   return handleVetoDecision(room, token, !!msg.accept);
    case 'choosePower':    return handleChoosePower(room, token, msg.targetIdx);
  }
}

// ==========================================================
// HTTP STATIC SERVER
// ==========================================================
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
};

const httpServer = http.createServer((req, res) => {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', ws => {
  ws.on('message', raw => handleMessage(ws, raw));
  ws.on('close', () => onLeave(ws));
  ws.on('error', () => {});
});

// Periodically clean up empty rooms
setInterval(() => {
  for (const [code, room] of rooms.entries()) {
    if (room.players.length === 0 || room.players.every(p => !p.connected)) {
      if (Date.now() - (room.createdAt || 0) > 1000 * 60 * 30) rooms.delete(code);
    }
  }
}, 1000 * 60 * 5);

httpServer.listen(PORT, () => {
  console.log(`\n  ┌──────────────────────────────────────────────┐`);
  console.log(`  │  Secret Hitler — multiplayer server          │`);
  console.log(`  │  Running on http://localhost:${PORT}             │`);
  console.log(`  │                                              │`);
  console.log(`  │  Same network: share http://<your-ip>:${PORT}    │`);
  console.log(`  │  Internet:     use ngrok / cloud deploy      │`);
  console.log(`  └──────────────────────────────────────────────┘\n`);

  // Print local IPs
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        console.log(`  → http://${net.address}:${PORT}`);
      }
    }
  }
  console.log('');
});
