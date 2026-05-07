/* ==========================================================
   SECRET HITLER — client (online multiplayer)
   Receives state from server, renders, sends actions.
   ========================================================== */

const POWER_NAMES = {
  investigate: 'Investigate Loyalty',
  peek: 'Policy Peek',
  specialElection: 'Special Election',
  execution: 'Execution',
};
const POWER_DESC = {
  investigate: 'See a player\'s party affiliation (not Hitler vs Fascist).',
  peek: 'Secretly view the next 3 policies in the deck.',
  specialElection: 'Choose any player to be the next President.',
  execution: 'Execute a player. They cannot speak or vote.',
};
// Crisp inline SVG icons for each power slot
const POWER_ICONS = {
  investigate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/></svg>',
  peek: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  specialElection: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11h18v9H3z"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="m9 15 2 2 4-4"/></svg>',
  execution: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a8 8 0 0 0-8 8v5l2 2v3h3v-2h2v2h2v-2h2v2h3v-3l2-2v-5a8 8 0 0 0-8-8z"/><circle cx="9" cy="11" r="1.2" fill="currentColor"/><circle cx="15" cy="11" r="1.2" fill="currentColor"/><path d="M10 16h4"/></svg>',
  win: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12l-1 6a5 5 0 0 1-10 0z"/><path d="M6 4H4v3a3 3 0 0 0 3 3"/><path d="M18 4h2v3a3 3 0 0 1-3 3"/><path d="M9 18h6"/><path d="M12 14v4"/></svg>',
};

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
};

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');
}
function toast(msg, ms = 2400, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function openModal(title, bodyHtml) {
  $('modal-body').innerHTML = `<h2>${title}</h2>${bodyHtml}`;
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }

// ==========================================================
// CONNECTION + STATE
// ==========================================================
let ws = null;
let myToken = null;
let myCode = null;
let lastView = null;
let lastPhase = null;

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}`);
  ws.onopen = () => {
    $('conn-overlay').classList.add('hidden');
    // Auto-rejoin if we have stored credentials
    const stored = sessionStorage.getItem('sh.session');
    if (stored) {
      try {
        const { code, token } = JSON.parse(stored);
        send('rejoin', { code, token });
      } catch {}
    }
  };
  ws.onclose = () => {
    $('conn-overlay').classList.remove('hidden');
    $('conn-text').textContent = 'Reconnecting…';
    setTimeout(connect, 1500);
  };
  ws.onerror = () => {};
  ws.onmessage = ev => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };
}

function send(type, payload = {}) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type, ...payload }));
}
function action(name, payload = {}) {
  send('action', { action: name, ...payload });
}

function handleMessage(msg) {
  if (msg.type === 'joined') {
    myCode = msg.code;
    myToken = msg.token;
    sessionStorage.setItem('sh.session', JSON.stringify({ code: msg.code, token: msg.token }));
    return;
  }
  if (msg.type === 'error') {
    toast(msg.message || 'Error', 3000, true);
    return;
  }
  if (msg.type === 'state') {
    renderView(msg.state);
  }
}

// ==========================================================
// RENDER ROUTER
// ==========================================================
function renderView(view) {
  if (!view) return;
  lastView = view;

  const phaseChanged = lastPhase !== view.phase;
  lastPhase = view.phase;

  if (view.phase === 'lobby')             { renderLobby(view); showScreen('lobby'); return; }
  if (view.phase === 'roleReveal')        { renderRoleReveal(view); showScreen('role'); return; }
  if (view.phase === 'end')               { renderEnd(view); showScreen('end'); return; }

  // All in-game phases use the game screen
  renderGame(view);
  if (phaseChanged && document.querySelector('#screen-game.active') == null) {
    showScreen('game');
  } else if (!document.querySelector('#screen-game.active')) {
    showScreen('game');
  }
}

// ==========================================================
// LOBBY
// ==========================================================
function renderLobby(view) {
  $('lobby-code').textContent = view.code;
  $('lobby-count').textContent = view.players.length;

  const list = $('lobby-players');
  list.innerHTML = '';
  view.players.forEach(p => {
    const cls = ['lobby-player'];
    if (p.token === view.youToken) cls.push('me');
    if (!p.connected) cls.push('disconnected');
    if (p.isBot) cls.push('bot');
    const initial = p.name.charAt(0).toUpperCase();
    const tags = [];
    if (p.isHost) tags.push(['host', 'HOST']);
    if (p.token === view.youToken) tags.push(['you', 'YOU']);
    if (p.isBot) tags.push(['bot', 'AI']);
    if (!p.connected && !p.isBot) tags.push(['off', 'OFFLINE']);
    list.appendChild(el('div', { class: cls.join(' ') },
      el('div', { class: 'lp-avatar' }, initial),
      el('div', { class: 'lp-name' }, p.name),
      ...tags.map(([c, t]) => el('div', { class: 'lp-tag ' + c }, t)),
    ));
  });

  // Roles preview
  const dist = view.dist;
  const sum = $('lobby-roles');
  if (dist) {
    sum.innerHTML = `
      <div class="lib"><strong>${dist.liberals}</strong>Liberals</div>
      <div class="fasc"><strong>${dist.fascists}</strong>Fascists</div>
      <div class="hit"><strong>1</strong>Hitler</div>
    `;
  } else {
    sum.innerHTML = `
      <div class="lib"><strong>—</strong>Liberals</div>
      <div class="fasc"><strong>—</strong>Fascists</div>
      <div class="hit"><strong>1</strong>Hitler</div>
    `;
  }

  // Start button (host only, 5+ players)
  const startBtn = $('btn-start');
  const need = $('lobby-need');
  const botCtl = $('bot-controls');
  if (view.isHost) {
    startBtn.classList.remove('hidden');
    botCtl.classList.remove('hidden');
    if (view.players.length >= 5 && view.players.length <= 10) {
      startBtn.disabled = false;
      need.textContent = `Ready to begin with ${view.players.length} players.`;
    } else if (view.players.length < 5) {
      startBtn.disabled = true;
      need.textContent = `Need ${5 - view.players.length} more — invite friends or add AI players for testing.`;
    } else {
      startBtn.disabled = true;
      need.textContent = `Maximum 10 players.`;
    }
    // Wire bot buttons each render
    const botCount = view.players.filter(p => p.isBot).length;
    $('btn-add-bot').disabled = view.players.length >= 10;
    $('btn-remove-bot').disabled = botCount === 0;
    $('btn-fill-bots').disabled = view.players.length >= 5;
  } else {
    startBtn.classList.add('hidden');
    botCtl.classList.add('hidden');
    need.textContent = `Waiting for ${view.players.find(p => p.isHost)?.name || 'host'} to start the game…`;
  }
}

// ==========================================================
// ROLE REVEAL
// ==========================================================
function renderRoleReveal(view) {
  const card = $('role-card');
  const inner = card.querySelector('.role-card-inner');
  inner.className = 'role-card-inner ' + view.youRole;

  const me = view.players.find(p => p.token === view.youToken);
  let party, name, portrait, info, known = '';

  if (view.youRole === 'liberal') {
    party = 'Liberal Party';
    name = 'Liberal';
    portrait = '🕊️';
    info = 'You are loyal to democracy. Pass <b>5 liberal policies</b> or kill Hitler to win.';
  } else if (view.youRole === 'fascist') {
    party = 'Fascist Party';
    name = 'Fascist';
    portrait = '🦅';
    info = 'You and Hitler must seize power. Pass <b>6 fascist policies</b>, or get Hitler elected Chancellor after 3 fascist policies.';
    const teammates = view.players
      .filter(p => p.token !== view.youToken && p.role && (p.role === 'fascist' || p.role === 'hitler'))
      .map(p => `<div>${p.role === 'hitler' ? '⚜️ ' : '🦅 '}<b>${p.name}</b> — ${p.role === 'hitler' ? 'Hitler' : 'Fascist'}</div>`)
      .join('');
    known = `<b>Your team</b>${teammates}`;
  } else if (view.youRole === 'hitler') {
    party = 'Fascist Party';
    name = 'Hitler';
    portrait = '⚜️';
    info = 'You are the Fascist leader. Lay low and get yourself elected Chancellor after 3 fascist policies — or pass 6 fascist policies. <b>If executed, the Liberals win.</b>';
    if (view.dist && view.dist.hitlerKnowsFascists) {
      const fascists = view.players
        .filter(p => p.role === 'fascist')
        .map(p => `<div>🦅 <b>${p.name}</b> — Fascist</div>`)
        .join('');
      known = `<b>Your fascist allies</b>${fascists}`;
    } else {
      known = `<b>You don't know your fellow Fascists.</b><div style="opacity:.8;margin-top:4px">With ${view.players.length} players, Hitler plays alone.</div>`;
    }
  }

  $('role-party').textContent = party;
  $('role-name').textContent = name;
  $('role-portrait').textContent = portrait;
  $('role-info').innerHTML = info;
  $('role-known').innerHTML = known;
  $('role-known').style.display = known ? 'block' : 'none';

  // Host gets the "start" button
  const startBtn = $('btn-role-start');
  const wait = $('role-wait');
  if (view.isHost) {
    startBtn.classList.remove('hidden');
    startBtn.onclick = () => action('roleAck');
    wait.textContent = 'Make sure everyone has reviewed their role, then start the round.';
  } else {
    startBtn.classList.add('hidden');
    const host = view.players.find(p => p.isHost);
    wait.textContent = `Waiting for ${host?.name || 'host'} to start the round…`;
  }
}

// ==========================================================
// GAME RENDER
// ==========================================================
function renderGame(view) {
  $('round-num').textContent = view.round || 1;

  // Mini track
  const mini = $('track-mini');
  mini.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    mini.appendChild(el('div', { class: 'mini-cell' + (i < (view.liberalPolicies || 0) ? ' liberal' : '') }));
  }
  mini.appendChild(el('div', { class: 'divider' }));
  for (let i = 0; i < 6; i++) {
    mini.appendChild(el('div', { class: 'mini-cell' + (i < (view.fascistPolicies || 0) ? ' fascist' : '') }));
  }

  // Liberal board — only the 5th cell unlocks "win"
  const libTrack = $('liberal-track');
  libTrack.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const filled = i < view.liberalPolicies;
    const isWin = i === 4;
    const cls = 'policy-cell' + (filled ? ' filled liberal' : '');
    const attrs = { class: cls };
    if (isWin) {
      attrs['data-power'] = 'win';
      attrs['data-tooltip'] = '5 Liberal Policies — Liberal Victory';
      attrs.title = 'Liberal Victory';
    }
    const cell = el('div', attrs, el('span', { class: 'cell-num' }, String(i + 1)));
    if (isWin) {
      const icon = el('span', { class: 'power-icon win-icon liberal-win' });
      icon.innerHTML = POWER_ICONS.win;
      cell.appendChild(icon);
    }
    libTrack.appendChild(cell);
  }

  // Fascist board — most cells trigger an executive power
  const fasTrack = $('fascist-track');
  fasTrack.innerHTML = '';
  const powers = view.fascistPowers || [];
  for (let i = 0; i < 6; i++) {
    const filled = i < view.fascistPolicies;
    const isWin = i === 5;
    const power = powers[i];
    const cls = 'policy-cell' + (filled ? ' filled fascist' : '');
    const attrs = { class: cls };
    let svg = null, label = '';
    if (isWin) {
      svg = POWER_ICONS.win;
      label = '6 Fascist Policies — Fascist Victory';
      attrs['data-power'] = 'win';
      attrs['data-tooltip'] = label;
      attrs.title = 'Fascist Victory';
    } else if (power) {
      svg = POWER_ICONS[power];
      label = `${POWER_NAMES[power]} — ${POWER_DESC[power]}`;
      attrs['data-power'] = power;
      attrs['data-tooltip'] = label;
      attrs.title = POWER_NAMES[power];
    }
    const cell = el('div', attrs, el('span', { class: 'cell-num' }, String(i + 1)));
    if (svg) {
      const iconCls = 'power-icon' + (isWin ? ' win-icon fascist-win' : '');
      const icon = el('span', { class: iconCls });
      icon.innerHTML = svg;
      cell.appendChild(icon);
    }
    fasTrack.appendChild(cell);
  }

  // Hitler-as-Chancellor warning indicator: red glow on fascist track at 3F
  fasTrack.classList.toggle('threshold-active', (view.fascistPolicies || 0) >= 3);

  // Failed-elections tracker (under the Liberal/Fascist boards)
  const tracker = view.electionTracker || 0;
  const trackCells = document.querySelectorAll('#tracker-track .tracker-cell');
  trackCells.forEach((cell, i) => {
    cell.classList.toggle('active', i < tracker);
    // Pulse the next-up empty cell when at 2/3 (next failed = chaos)
    cell.classList.toggle('warning', tracker === 2 && i === 2);
  });
  const tcount = $('tracker-count');
  if (tcount) {
    tcount.textContent = `${tracker} / 3`;
    tcount.classList.toggle('warning', tracker >= 2);
  }

  // Players ring
  renderPlayersRing(view);

  // Deck info — pulse the stack when count changes
  const drawEl = $('draw-count');
  const discardEl = $('discard-count');
  const newDraw = String(view.deckCount ?? 17);
  const newDisc = String(view.discardCount ?? 0);
  if (drawEl.textContent !== newDraw) {
    drawEl.textContent = newDraw;
    const stack = drawEl.closest('.card-stack');
    if (stack) { stack.classList.remove('pulse'); void stack.offsetWidth; stack.classList.add('pulse'); }
  }
  if (discardEl.textContent !== newDisc) {
    discardEl.textContent = newDisc;
    const stack = discardEl.closest('.card-stack');
    if (stack) { stack.classList.remove('pulse'); void stack.offsetWidth; stack.classList.add('pulse'); }
  }

  // Center stage
  renderStage(view);

  // Side history panel (desktop only — element exists but hidden on mobile)
  renderSideHistory(view);

  // Header buttons
  $('btn-menu').onclick = () => showMenu(view);
  $('btn-log').onclick = () => showLog(view);
  $('btn-myrole').onclick = () => showMyRole(view);
}

let _lastHistoryLen = 0;
function renderSideHistory(view) {
  const list = $('side-history-list');
  if (!list) return;
  const history = view.history || [];
  if (history.length === 0) {
    list.innerHTML = '<div class="se-empty">No events yet</div>';
    _lastHistoryLen = 0;
    return;
  }
  const playerName = idx => view.players[idx]?.name ?? '?';
  const trunc = s => s && s.length > 10 ? s.slice(0, 9) + '…' : (s || '');

  // Newest first; mark the freshest entry with a brief gold ring
  const isNew = idx => idx === 0 && history.length > _lastHistoryLen;
  const reversed = history.slice().reverse();
  list.innerHTML = reversed.map((e, i) =>
    renderSideRow(e, playerName, trunc, isNew(i))
  ).join('');
  _lastHistoryLen = history.length;
}

function renderSideRow(e, playerName, trunc, fresh) {
  const pres = e.presIdx != null ? `<span class="he-pres">${escapeHtml(trunc(playerName(e.presIdx)))}</span>` : '';
  const chan = e.chanIdx != null ? `<span class="he-chan">${escapeHtml(trunc(playerName(e.chanIdx)))}</span>` : '';
  const tgt  = e.targetIdx != null ? `<span class="he-target">${escapeHtml(trunc(playerName(e.targetIdx)))}</span>` : '';
  const by   = e.byIdx != null ? `<span class="he-pres">${escapeHtml(trunc(playerName(e.byIdx)))}</span>` : '';
  const freshCls = fresh ? ' fresh' : '';

  const wrap = (cls, icon, line1, line2) =>
    `<div class="se-row ${cls}${freshCls}">
       <div class="se-round">R${e.round}</div>
       <div class="se-icon">${icon}</div>
       <div class="se-body">
         <div class="se-line1">${line1}</div>
         <div class="se-line2">${line2}</div>
       </div>
     </div>`;

  switch (e.kind) {
    case 'enactment':
      return wrap(
        `enactment-${e.policy}`,
        e.policy === 'liberal' ? '🕊' : '🔥',
        `${pres} → ${chan}`,
        `${e.policy === 'liberal' ? 'Liberal' : 'Fascist'} · ${e.ja}–${e.nein}`
      );
    case 'failedElection':
      return wrap('failed', '✕', `${pres} → ${chan}`, `Failed · ${e.ja}–${e.nein}`);
    case 'chaos':
      return wrap('chaos', '⚡',
        `Chaos · ${e.policy === 'liberal' ? 'Liberal' : 'Fascist'}`,
        '3 elections failed');
    case 'veto':
      return wrap('veto', '⊘', `${pres} & ${chan}`, 'Vetoed both');
    case 'power':
      if (e.power === 'investigate')     return wrap('power-investigate', '🔍', `${by} → ${tgt}`, 'Investigated');
      if (e.power === 'peek')            return wrap('power-peek', '👁', `${by} peeked`, 'Saw next 3');
      if (e.power === 'specialElection') return wrap('power-specialElection', '🗳', `${by} → ${tgt}`, 'Special Election');
      if (e.power === 'execution')       return wrap('power-execution', '☠', `${by} → ${tgt}`, 'Executed');
      return '';
    case 'notHitler':
      return wrap('notHitler', '✓', chan, 'NOT Hitler');
  }
  return '';
}

function renderPlayersRing(view) {
  const ring = $('players-ring');
  ring.innerHTML = '';

  const me = view.players.find(p => p.token === view.youToken);
  const isMyTurn = me && me.idx === view.presidentIdx;
  const isNomination = view.phase === 'nomination';
  const powerPhase = ['power-investigate', 'power-specialElection', 'power-execution'].includes(view.phase);

  view.players.forEach(p => {
    const cls = ['player-pill'];
    if (p.idx === view.presidentIdx) cls.push('president');
    if (p.idx === view.chancellorIdx) cls.push('chancellor');
    if (!p.alive) cls.push('dead');
    if (p.investigated) cls.push('investigated');
    if (!p.connected && !p.isBot) cls.push('disconnected');
    if (p.token === view.youToken) cls.push('you');
    if (p.isBot) cls.push('bot');
    if (p.confirmedNotHitler) cls.push('not-hitler');
    if (p.idx === view.prevPresident || p.idx === view.prevChancellor) cls.push('term-limited');

    // Fascist visibility tinting
    if (p.role === 'fascist') cls.push('fascist-known');

    // Voted indicator
    if (view.voteState && !view.voteState.revealed && view.voteState.hasVoted.includes(p.token) && p.alive) {
      cls.push('has-voted');
    }

    // Selectable for nomination/power
    let onClick = null;
    if (isMyTurn && isNomination) {
      const eligible = isEligibleChancellor(view, p);
      if (eligible) {
        cls.push('selectable');
        onClick = () => action('nominate', { targetIdx: p.idx });
      }
    }
    if (isMyTurn && powerPhase) {
      const validTarget = p.alive
        && p.idx !== view.presidentIdx
        && (view.phase !== 'power-investigate' || !p.investigated);
      if (validTarget) {
        cls.push('selectable');
        onClick = () => action('choosePower', { targetIdx: p.idx });
      }
    }

    const initial = p.name.charAt(0).toUpperCase();
    let tag = '';
    let tagCls = '';
    if (p.idx === view.presidentIdx) { tag = 'PRESIDENT'; }
    else if (p.idx === view.chancellorIdx) { tag = 'CHANCELLOR'; tagCls = 'chancellor'; }
    else if (p.role === 'fascist') { tag = 'FASCIST'; tagCls = 'fascist-known'; }
    else if (p.role === 'hitler')  { tag = 'HITLER'; }

    const pill = el('div', { class: cls.join(' '), 'data-id': p.idx },
      el('div', { class: 'player-avatar' }, initial),
      el('div', { class: 'player-name' }, p.name),
      tag ? el('div', { class: 'player-role-tag ' + tagCls }, tag) : null,
    );
    if (onClick) pill.onclick = onClick;
    ring.appendChild(pill);
  });
}

function isEligibleChancellor(view, target) {
  if (!target.alive) return false;
  if (target.idx === view.presidentIdx) return false;
  if (target.idx === view.prevChancellor) return false;
  const aliveCount = view.players.filter(p => p.alive).length;
  if (aliveCount > 5 && target.idx === view.prevPresident) return false;
  return true;
}

// ==========================================================
// CENTER STAGE — phase-driven
// ==========================================================
function renderStage(view) {
  const stage = $('center-stage');
  stage.innerHTML = '';
  const me = view.players.find(p => p.token === view.youToken);
  const myIdx = me?.idx;
  const pres = view.players[view.presidentIdx];
  const chan = view.chancellorIdx != null ? view.players[view.chancellorIdx] : null;

  switch (view.phase) {
    case 'nomination': return stageNomination(view, stage, pres, myIdx);
    case 'voting':     return stageVoting(view, stage, pres, chan);
    case 'voteReveal': return stageVoteReveal(view, stage, pres);
    case 'legislative-president':  return stageLegislativePres(view, stage, pres, myIdx);
    case 'legislative-chancellor': return stageLegislativeChan(view, stage, pres, chan, myIdx);
    case 'vetoDecision': return stageVetoDecision(view, stage, pres, chan, myIdx);
    case 'policyEnacted':  return stagePolicyEnacted(view, stage, pres, chan);
    case 'chaos':          return stageChaos(view, stage, pres);
    case 'power-investigate':     return stagePowerPick(view, stage, pres, myIdx, 'investigate');
    case 'power-specialElection': return stagePowerPick(view, stage, pres, myIdx, 'specialElection');
    case 'power-execution':       return stagePowerPick(view, stage, pres, myIdx, 'execution');
    case 'power-peek':            return stagePeek(view, stage, pres, myIdx);
    case 'investigationReveal':   return stageInvestigationReveal(view, stage, pres, myIdx);
    case 'executionReveal':       return stageExecutionReveal(view, stage, pres);
  }
}

function stageNomination(view, stage, pres, myIdx) {
  const myTurn = myIdx === view.presidentIdx;
  stage.appendChild(el('div', { class: 'stage-title' }, 'Nomination'));
  if (myTurn) {
    stage.appendChild(el('div', { class: 'stage-desc', html:
      `You are <span class="pres">President</span>. Choose a Chancellor candidate from the highlighted players.`
    }));
  } else {
    stage.appendChild(el('div', { class: 'stage-desc', html:
      `<span class="pres">${pres.name}</span> is choosing a Chancellor candidate…`
    }));
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name}`));
  }
}

function stageVoting(view, stage, pres, chan) {
  stage.appendChild(el('div', { class: 'stage-title' }, 'Vote Ja or Nein'));
  stage.appendChild(el('div', { class: 'stage-desc', html:
    `Government: President <span class="pres">${pres.name}</span> & Chancellor <span class="chan">${chan.name}</span>`
  }));

  const me = view.players.find(p => p.token === view.youToken);
  const v = view.voteState;

  if (!me || !me.alive) {
    stage.appendChild(waitingIndicator(`Spectating — vote in progress (${v.hasVoted.length}/${v.total})`));
    return;
  }

  if (v.myVote) {
    // Already voted — show what I picked
    const buttons = el('div', { class: 'vote-buttons' });
    buttons.appendChild(el('button', { class: 'vote-btn ja' + (v.myVote === 'ja' ? ' cast' : ' unselected') }, 'Ja!'));
    buttons.appendChild(el('button', { class: 'vote-btn nein' + (v.myVote === 'nein' ? ' cast' : ' unselected') }, 'Nein!'));
    stage.appendChild(buttons);
    stage.appendChild(el('div', { class: 'vote-progress', html:
      `Your vote is locked. <strong>${v.hasVoted.length}/${v.total}</strong> votes in.`
    }));
  } else {
    stage.appendChild(el('div', { class: 'vote-buttons' },
      el('button', { class: 'vote-btn ja',   onClick: () => action('vote', { vote: 'ja' }) }, 'Ja!'),
      el('button', { class: 'vote-btn nein', onClick: () => action('vote', { vote: 'nein' }) }, 'Nein!'),
    ));
    stage.appendChild(el('div', { class: 'vote-progress', html:
      `<strong>${v.hasVoted.length}/${v.total}</strong> votes cast`
    }));
  }
}

function stageVoteReveal(view, stage, pres) {
  const v = view.voteState;
  const ja = Object.values(v.votes).filter(x => x === 'ja').length;
  const nein = Object.values(v.votes).filter(x => x === 'nein').length;
  const passed = ja > nein;

  stage.appendChild(el('div', { class: 'stage-title' }, passed ? 'Election Passes' : 'Election Fails'));
  stage.appendChild(el('div', { class: 'stage-desc', html:
    `Ja: <b>${ja}</b> &nbsp;&nbsp; Nein: <b>${nein}</b>`
  }));

  const grid = el('div', { class: 'vote-grid' });
  view.players.filter(p => p.alive).forEach(p => {
    const vote = v.votes[p.token];
    if (!vote) return;
    grid.appendChild(el('div', { class: 'vote-cell ' + vote },
      el('div', { class: 'vname' }, p.name),
      el('div', { class: 'vresult' }, vote === 'ja' ? 'JA!' : 'NEIN!'),
    ));
  });
  stage.appendChild(grid);

  if (view.ackForMe) {
    stage.appendChild(el('button', { class: 'primary-btn', onClick: () => action('advance') }, 'Continue'));
  } else {
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name} to continue`));
  }
}

function stageLegislativePres(view, stage, pres, myIdx) {
  if (myIdx === view.presidentIdx) {
    stage.appendChild(el('div', { class: 'stage-title' }, 'Discard One Policy'));
    stage.appendChild(el('div', { class: 'stage-desc' }, 'Tap a policy to discard it. The remaining two go to the Chancellor.'));
    const hand = el('div', { class: 'policy-hand' });
    view.myHand.forEach((p, i) => {
      const card = el('div', { class: 'policy-card actionable ' + p, onClick: () => action('discard', { idx: i }) },
        el('span', { class: 'corner tl' }, p === 'liberal' ? '🕊️' : '🔥'),
        p === 'liberal' ? 'Liberal' : 'Fascist',
        el('span', { class: 'corner br' }, p === 'liberal' ? '🕊️' : '🔥'),
      );
      hand.appendChild(card);
    });
    stage.appendChild(hand);
  } else {
    stage.appendChild(el('div', { class: 'stage-title' }, "President's Discard"));
    stage.appendChild(el('div', { class: 'stage-desc', html:
      `<span class="pres">${pres.name}</span> draws 3 policies and discards 1.`
    }));
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name}`));
  }
}

function stageLegislativeChan(view, stage, pres, chan, myIdx) {
  if (myIdx === view.chancellorIdx) {
    stage.appendChild(el('div', { class: 'stage-title' }, 'Enact a Policy'));
    stage.appendChild(el('div', { class: 'stage-desc' }, 'Tap a policy to enact it. The other is discarded.'));
    const hand = el('div', { class: 'policy-hand' });
    view.myHand.forEach((p, i) => {
      const card = el('div', { class: 'policy-card actionable ' + p, onClick: () => action('enact', { idx: i }) },
        el('span', { class: 'corner tl' }, p === 'liberal' ? '🕊️' : '🔥'),
        p === 'liberal' ? 'Liberal' : 'Fascist',
        el('span', { class: 'corner br' }, p === 'liberal' ? '🕊️' : '🔥'),
      );
      hand.appendChild(card);
    });
    stage.appendChild(hand);

    if (view.canVeto) {
      stage.appendChild(el('button', {
        class: 'secondary-btn',
        onClick: () => action('proposeVeto'),
      }, 'Propose Veto'));
    }
  } else {
    stage.appendChild(el('div', { class: 'stage-title' }, "Chancellor's Choice"));
    stage.appendChild(el('div', { class: 'stage-desc', html:
      `<span class="chan">${chan.name}</span> is enacting a policy…`
    }));
    stage.appendChild(waitingIndicator(`Waiting for ${chan.name}`));
  }
}

function stageVetoDecision(view, stage, pres, chan, myIdx) {
  stage.appendChild(el('div', { class: 'stage-title' }, 'Veto Proposed'));
  stage.appendChild(el('div', { class: 'stage-desc', html:
    `<span class="chan">${chan.name}</span> proposes vetoing both policies. Both must agree to discard them.`
  }));
  if (myIdx === view.presidentIdx) {
    const actions = el('div', { class: 'stage-actions row' });
    actions.appendChild(el('button', { class: 'secondary-btn', onClick: () => action('vetoDecision', { accept: false }) }, 'Reject'));
    actions.appendChild(el('button', { class: 'primary-btn',   onClick: () => action('vetoDecision', { accept: true }) }, 'Accept Veto'));
    stage.appendChild(actions);
  } else {
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name} to decide`));
  }
}

function stagePolicyEnacted(view, stage, pres, chan) {
  const policy = view.enactedPolicy;
  stage.appendChild(el('div', { class: 'stage-title' }, 'Policy Enacted'));
  stage.appendChild(el('div', { class: 'reveal-info' },
    el('div', { class: 'big ' + policy }, policy === 'liberal' ? 'Liberal Policy' : 'Fascist Policy'),
    el('div', { style: 'color:var(--text-dim);font-size:13px' },
      `Liberal ${view.liberalPolicies}/5 · Fascist ${view.fascistPolicies}/6`),
  ));
  if (view.ackForMe) {
    stage.appendChild(el('button', { class: 'primary-btn', onClick: () => action('advance') }, 'Continue'));
  } else {
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name}`));
  }
}

function stageChaos(view, stage, pres) {
  const policy = view.enactedPolicy;
  stage.appendChild(el('div', { class: 'stage-title' }, 'Country in Chaos'));
  stage.appendChild(el('div', { class: 'stage-desc' },
    'Three failed elections. The top policy is enacted automatically. Term limits reset.'));
  stage.appendChild(el('div', { class: 'policy-hand' },
    el('div', { class: 'policy-card ' + policy },
      el('span', { class: 'corner tl' }, policy === 'liberal' ? '🕊️' : '🔥'),
      policy === 'liberal' ? 'Liberal' : 'Fascist',
      el('span', { class: 'corner br' }, policy === 'liberal' ? '🕊️' : '🔥'),
    ),
  ));
  if (view.ackForMe) {
    stage.appendChild(el('button', { class: 'primary-btn', onClick: () => action('advance') }, 'Enact Policy'));
  } else {
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name}`));
  }
}

function stagePowerPick(view, stage, pres, myIdx, kind) {
  stage.appendChild(el('div', { class: 'stage-title' }, POWER_NAMES[kind]));
  if (myIdx === view.presidentIdx) {
    let hint = '';
    if (kind === 'investigate') hint = 'Choose a player to investigate. You will see their party affiliation (not whether they\'re Hitler).';
    if (kind === 'specialElection') hint = 'Choose any player to be the next President. After their term, presidency returns to normal order.';
    if (kind === 'execution') hint = 'Choose a player to formally execute. They are removed from the game.';
    stage.appendChild(el('div', { class: 'stage-desc' }, hint));
  } else {
    stage.appendChild(el('div', { class: 'stage-desc', html:
      `<span class="pres">${pres.name}</span> is choosing a target…`
    }));
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name}`));
  }
}

function stagePeek(view, stage, pres, myIdx) {
  stage.appendChild(el('div', { class: 'stage-title' }, 'Policy Peek'));
  if (myIdx === view.presidentIdx && view.peekResult) {
    stage.appendChild(el('div', { class: 'stage-desc' }, 'Top 3 policies, in draw order:'));
    const hand = el('div', { class: 'policy-hand' });
    view.peekResult.forEach(p => hand.appendChild(el('div', { class: 'policy-card ' + p },
      el('span', { class: 'corner tl' }, p === 'liberal' ? '🕊️' : '🔥'),
      p === 'liberal' ? 'Liberal' : 'Fascist',
      el('span', { class: 'corner br' }, p === 'liberal' ? '🕊️' : '🔥'),
    )));
    stage.appendChild(hand);
    stage.appendChild(el('button', { class: 'primary-btn', onClick: () => action('advance') }, 'Hide & Continue'));
  } else {
    stage.appendChild(el('div', { class: 'stage-desc', html:
      `<span class="pres">${pres.name}</span> is peeking at the top of the deck…`
    }));
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name}`));
  }
}

function stageInvestigationReveal(view, stage, pres, myIdx) {
  stage.appendChild(el('div', { class: 'stage-title' }, 'Investigation'));
  if (myIdx === view.presidentIdx && view.investigationResult) {
    const r = view.investigationResult;
    stage.appendChild(el('div', { class: 'reveal-info' },
      el('div', { style: 'color:var(--text-dim)' }, `${r.targetName} is...`),
      el('div', { class: 'big ' + r.party }, r.party === 'liberal' ? 'Liberal' : 'Fascist'),
    ));
    stage.appendChild(el('button', { class: 'primary-btn', onClick: () => action('advance') }, 'Hide & Continue'));
  } else {
    stage.appendChild(el('div', { class: 'stage-desc', html:
      `<span class="pres">${pres.name}</span> investigated a player. Only they know the result.`
    }));
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name}`));
  }
}

function stageExecutionReveal(view, stage, pres) {
  stage.appendChild(el('div', { class: 'stage-title' }, 'Execution'));
  // Find most recently dead player from logs (best effort) — fall back to dead list
  const dead = view.players.filter(p => !p.alive);
  const recent = dead[dead.length - 1];
  stage.appendChild(el('div', { class: 'reveal-info' },
    el('div', { class: 'big fascist' }, recent ? `${recent.name} is dead` : 'A player was executed'),
    el('div', { style: 'color:var(--text-dim);font-size:13px' }, 'Their role remains hidden.'),
  ));
  if (view.ackForMe) {
    stage.appendChild(el('button', { class: 'primary-btn', onClick: () => action('advance') }, 'Continue'));
  } else {
    stage.appendChild(waitingIndicator(`Waiting for ${pres.name}`));
  }
}

function waitingIndicator(text) {
  return el('div', { class: 'waiting-indicator' }, text + '…');
}

// ==========================================================
// END SCREEN
// ==========================================================
function renderEnd(view) {
  $('end-banner').className = 'end-banner ' + view.winner;
  $('end-title').textContent = view.winner === 'liberal' ? 'LIBERALS WIN' : 'FASCISTS WIN';
  $('end-reason').textContent = view.winReason || '';

  const list = $('end-roles');
  list.innerHTML = '';
  view.players.forEach(p => {
    const cls = p.role === 'hitler' ? 'hitler' : p.role;
    const roleLabel = p.role === 'hitler' ? 'Hitler' : (p.role === 'liberal' ? 'Liberal' : 'Fascist');
    list.appendChild(el('div', { class: 'end-role-row ' + cls },
      el('div', { class: 'er-avatar' }, p.name.charAt(0).toUpperCase()),
      el('div', { class: 'er-name' }, p.name + (p.alive ? '' : ' ✕')),
      el('div', { class: 'er-role' }, roleLabel),
    ));
  });

  const btnRestart = $('btn-restart');
  if (view.isHost) {
    btnRestart.classList.remove('hidden');
    btnRestart.onclick = () => send('restart');
  } else {
    btnRestart.classList.add('hidden');
  }
  $('btn-leave-end').onclick = leaveRoom;
}

// ==========================================================
// MENU & MODALS
// ==========================================================
function showMenu(view) {
  openModal('Menu', `
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:8px">
      <button class="secondary-btn" id="m-rules">How to Play</button>
      <button class="secondary-btn" id="m-share">Share Room Code</button>
      ${view.isHost ? '<button class="secondary-btn" id="m-restart">Restart Match</button>' : ''}
      <button class="secondary-btn" id="m-leave">Leave Room</button>
    </div>
  `);
  $('m-rules').onclick = () => { closeModal(); showRules(); };
  $('m-share').onclick = () => { copyShareLink(); };
  if (view.isHost) {
    $('m-restart').onclick = () => {
      if (!confirm('Restart with the same players and new roles?')) return;
      closeModal();
      send('restart');
    };
  }
  $('m-leave').onclick = () => { closeModal(); leaveRoom(); };
}

function showLog(view) {
  const historyHtml = renderHistoryHtml(view);
  const logHtml = `
    <div class="log-list">
      ${(!view.log || view.log.length === 0) ? '<p class="history-empty">No events yet.</p>' :
        view.log.slice().reverse().map(e =>
          `<div class="log-entry ${e.cls || ''}">${escapeHtml(e.text)}</div>`
        ).join('')
      }
    </div>
  `;
  const html = `
    <div class="modal-tabs">
      <button class="modal-tab active" data-tab="history">Timeline</button>
      <button class="modal-tab" data-tab="log">Raw Log</button>
    </div>
    <div id="tab-history">${historyHtml}</div>
    <div id="tab-log" style="display:none">${logHtml}</div>
  `;
  openModal('Game History', html);
  // Tab switching
  document.querySelectorAll('.modal-tab').forEach(t => {
    t.onclick = () => {
      document.querySelectorAll('.modal-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      const tab = t.dataset.tab;
      $('tab-history').style.display = tab === 'history' ? '' : 'none';
      $('tab-log').style.display     = tab === 'log'     ? '' : 'none';
    };
  });
}

function renderHistoryHtml(view) {
  const history = view.history || [];
  if (history.length === 0) return '<p class="history-empty">No rounds played yet.</p>';

  // Group entries by round (preserve order within round)
  const byRound = new Map();
  for (const e of history) {
    if (!byRound.has(e.round)) byRound.set(e.round, []);
    byRound.get(e.round).push(e);
  }

  const rounds = Array.from(byRound.entries()).sort((a, b) => b[0] - a[0]); // newest first
  const playerName = idx => view.players[idx]?.name ?? '?';

  const blocks = rounds.map(([round, events]) => {
    const eventHtml = events.map(e => renderHistoryEvent(e, playerName)).join('');
    return `
      <div class="history-round">
        <div class="history-round-num">R${round}</div>
        <div class="history-events">${eventHtml}</div>
      </div>
    `;
  });
  return `<div class="history-list">${blocks.join('')}</div>`;
}

function renderHistoryEvent(e, playerName) {
  const pres = e.presIdx != null ? `<span class="he-pres">${escapeHtml(playerName(e.presIdx))}</span>` : '';
  const chan = e.chanIdx != null ? `<span class="he-chan">${escapeHtml(playerName(e.chanIdx))}</span>` : '';

  switch (e.kind) {
    case 'enactment': {
      const cls = `enactment-${e.policy}`;
      const icon = e.policy === 'liberal' ? '🕊️' : '🔥';
      const word = e.policy === 'liberal' ? 'Liberal' : 'Fascist';
      return `
        <div class="history-event ${cls}">
          <div class="he-icon">${icon}</div>
          <div class="he-body">
            <div class="he-line1">${pres} → ${chan}</div>
            <div class="he-line2">Enacted ${word} policy</div>
          </div>
          <div class="he-tally">${e.ja}–${e.nein}</div>
        </div>
      `;
    }
    case 'failedElection': {
      return `
        <div class="history-event failed">
          <div class="he-icon">✕</div>
          <div class="he-body">
            <div class="he-line1">${pres} → ${chan}</div>
            <div class="he-line2">Election failed</div>
          </div>
          <div class="he-tally">${e.ja}–${e.nein}</div>
        </div>
      `;
    }
    case 'chaos': {
      const icon = e.policy === 'liberal' ? '🕊️' : '🔥';
      const word = e.policy === 'liberal' ? 'Liberal' : 'Fascist';
      return `
        <div class="history-event chaos">
          <div class="he-icon">⚡</div>
          <div class="he-body">
            <div class="he-line1">Chaos: ${word} policy enacted</div>
            <div class="he-line2">3 elections failed — top card auto-played</div>
          </div>
        </div>
      `;
    }
    case 'veto': {
      return `
        <div class="history-event veto">
          <div class="he-icon">⊘</div>
          <div class="he-body">
            <div class="he-line1">${pres} & ${chan} vetoed both policies</div>
            <div class="he-line2">Tracker advanced</div>
          </div>
        </div>
      `;
    }
    case 'notHitler': {
      const c = e.chanIdx != null ? `<span class="he-chan">${escapeHtml(playerName(e.chanIdx))}</span>` : '';
      return `
        <div class="history-event power-investigate">
          <div class="he-icon">✓</div>
          <div class="he-body">
            <div class="he-line1">${c} confirmed: NOT Hitler</div>
            <div class="he-line2">Elected Chancellor with 3+ Fascist policies</div>
          </div>
        </div>
      `;
    }
    case 'power': {
      const by = e.byIdx != null ? `<span class="he-pres">${escapeHtml(playerName(e.byIdx))}</span>` : '';
      const target = e.targetIdx != null ? `<span class="he-target">${escapeHtml(playerName(e.targetIdx))}</span>` : '';
      const cls = 'power-' + e.power;
      if (e.power === 'investigate') return `
        <div class="history-event ${cls}">
          <div class="he-icon">🔍</div>
          <div class="he-body">
            <div class="he-line1">${by} investigated ${target}</div>
            <div class="he-line2">Result private to investigator</div>
          </div>
        </div>`;
      if (e.power === 'peek') return `
        <div class="history-event ${cls}">
          <div class="he-icon">👁️</div>
          <div class="he-body">
            <div class="he-line1">${by} peeked at the deck</div>
            <div class="he-line2">Saw next 3 policies</div>
          </div>
        </div>`;
      if (e.power === 'specialElection') return `
        <div class="history-event ${cls}">
          <div class="he-icon">🗳️</div>
          <div class="he-body">
            <div class="he-line1">${by} called special election: ${target}</div>
            <div class="he-line2">Becomes next President</div>
          </div>
        </div>`;
      if (e.power === 'execution') return `
        <div class="history-event ${cls}">
          <div class="he-icon">☠</div>
          <div class="he-body">
            <div class="he-line1">${by} executed ${target}</div>
            <div class="he-line2">Player removed from the game</div>
          </div>
        </div>`;
    }
  }
  return '';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function showMyRole(view) {
  const me = view.players.find(p => p.token === view.youToken);
  const role = view.youRole;
  const portrait = role === 'liberal' ? '🕊️' : (role === 'hitler' ? '⚜️' : '🦅');
  const name = role === 'hitler' ? 'Hitler' : (role === 'liberal' ? 'Liberal' : 'Fascist');
  let known = '';
  if (role === 'fascist' || (role === 'hitler' && view.dist?.hitlerKnowsFascists)) {
    const teammates = view.players
      .filter(p => p.token !== view.youToken && p.role && (p.role === 'fascist' || p.role === 'hitler'))
      .map(p => `<div style="margin:4px 0">${p.role === 'hitler' ? '⚜️ ' : '🦅 '}<b>${p.name}</b> — ${p.role === 'hitler' ? 'Hitler' : 'Fascist'}</div>`)
      .join('');
    if (teammates) known = `<h3>Your Team</h3>${teammates}`;
  }
  openModal('Your Role', `
    <div style="text-align:center;font-size:64px;margin:8px 0">${portrait}</div>
    <div style="text-align:center;font-family:'Cinzel',serif;font-size:24px;letter-spacing:3px;color:var(--gold)">${name.toUpperCase()}</div>
    ${known}
  `);
}

function showRules() {
  openModal('How to Play', `
    <p><strong>Secret Hitler</strong> is a hidden role game. Players are secretly Liberals, Fascists, or Hitler.</p>
    <h3>Liberal Win</h3>
    <ul>
      <li>Enact <b>5 liberal policies</b>, OR</li>
      <li><b>Assassinate Hitler</b> via executive power.</li>
    </ul>
    <h3>Fascist Win</h3>
    <ul>
      <li>Enact <b>6 fascist policies</b>, OR</li>
      <li>Get <b>Hitler elected Chancellor</b> after 3 fascist policies.</li>
    </ul>
    <h3>Each Round</h3>
    <ul>
      <li>The President nominates a Chancellor.</li>
      <li>All living players vote Ja or Nein.</li>
      <li>If passed: President draws 3, discards 1, Chancellor enacts 1.</li>
      <li>If failed 3 times: top policy is enacted automatically (chaos).</li>
    </ul>
    <h3>Executive Powers</h3>
    <p>Each fascist policy may unlock a power for the President: investigate loyalty, peek at the next 3 policies, call a special election, or execute a player.</p>
  `);
}

// ==========================================================
// SETUP / NAVIGATION
// ==========================================================
function leaveRoom() {
  send('leave');
  sessionStorage.removeItem('sh.session');
  myCode = null;
  myToken = null;
  lastView = null;
  lastPhase = null;
  showScreen('welcome');
}

function copyShareLink() {
  const url = `${location.origin}${location.pathname}?code=${myCode}`;
  navigator.clipboard?.writeText(url).then(
    () => toast('Share link copied!'),
    () => toast(url, 4000)
  );
}

// ==========================================================
// EVENT WIRING
// ==========================================================
document.addEventListener('DOMContentLoaded', () => {
  // Welcome
  $('btn-create').onclick = () => showScreen('create');
  $('btn-join-show').onclick = () => {
    showScreen('join');
    const params = new URLSearchParams(location.search);
    if (params.get('code')) {
      $('join-code').value = params.get('code').toUpperCase();
    }
  };
  $('btn-rules-welcome').onclick = showRules;

  // Back buttons
  document.querySelectorAll('.back-btn').forEach(b => {
    b.onclick = () => showScreen(b.dataset.back);
  });

  // Create
  $('btn-create-go').onclick = () => {
    const name = $('create-name').value.trim();
    if (!name) return toast('Please enter your name.', 2000, true);
    send('create', { name });
  };
  $('create-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-create-go').click();
  });

  // Join
  $('btn-join-go').onclick = () => {
    const code = $('join-code').value.trim().toUpperCase();
    const name = $('join-name').value.trim();
    if (!code) return toast('Enter the room code.', 2000, true);
    if (!name) return toast('Please enter your name.', 2000, true);
    send('join', { code, name });
  };
  $('join-code').addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  });
  $('join-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btn-join-go').click();
  });

  // Lobby
  $('btn-start').onclick = () => send('start');
  $('btn-leave').onclick = leaveRoom;
  $('btn-add-bot').onclick = () => send('addBot');
  $('btn-remove-bot').onclick = () => send('removeBot');
  $('btn-fill-bots').onclick = () => {
    const need = 5 - (lastView ? lastView.players.length : 0);
    for (let i = 0; i < need; i++) send('addBot');
  };
  $('btn-copy-code').onclick = () => {
    navigator.clipboard?.writeText(myCode).then(
      () => toast('Code copied!'),
      () => toast(myCode, 3000)
    );
  };
  $('btn-share').onclick = copyShareLink;

  // Modal
  $('modal-close').onclick = closeModal;
  $('modal').addEventListener('click', e => {
    if (e.target.id === 'modal' || e.target.classList.contains('modal-backdrop')) closeModal();
  });

  // Auto-fill code from URL on welcome
  const params = new URLSearchParams(location.search);
  if (params.get('code')) {
    showScreen('join');
    $('join-code').value = params.get('code').toUpperCase();
  } else {
    showScreen('welcome');
  }

  connect();
});
