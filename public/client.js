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
    const initial = p.name.charAt(0).toUpperCase();
    const tags = [];
    if (p.isHost) tags.push(['host', 'HOST']);
    if (p.token === view.youToken) tags.push(['you', 'YOU']);
    if (!p.connected) tags.push(['off', 'OFFLINE']);
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
  if (view.isHost) {
    startBtn.classList.remove('hidden');
    if (view.players.length >= 5 && view.players.length <= 10) {
      startBtn.disabled = false;
      need.textContent = `Ready to begin with ${view.players.length} players.`;
    } else if (view.players.length < 5) {
      startBtn.disabled = true;
      need.textContent = `Need ${5 - view.players.length} more player${5 - view.players.length === 1 ? '' : 's'}…`;
    } else {
      startBtn.disabled = true;
      need.textContent = `Maximum 10 players.`;
    }
  } else {
    startBtn.classList.add('hidden');
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

  // Liberal board
  const libTrack = $('liberal-track');
  libTrack.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const filled = i < view.liberalPolicies;
    const isWin = i === 4;
    libTrack.appendChild(el('div', { class: 'policy-cell' + (filled ? ' filled liberal' : '') },
      el('span', { class: 'cell-num' }, String(i + 1)),
      isWin ? el('span', { class: 'power-icon' }, '🏆') : null,
    ));
  }

  // Fascist board
  const fasTrack = $('fascist-track');
  fasTrack.innerHTML = '';
  const powers = view.fascistPowers || [];
  for (let i = 0; i < 6; i++) {
    const filled = i < view.fascistPolicies;
    const power = powers[i];
    const icon = i === 5 ? '🏆' : (
      power === 'investigate' ? '🔍' :
      power === 'peek' ? '👁️' :
      power === 'specialElection' ? '🗳️' :
      power === 'execution' ? '☠️' : ''
    );
    fasTrack.appendChild(el('div', { class: 'policy-cell' + (filled ? ' filled fascist' : '') },
      el('span', { class: 'cell-num' }, String(i + 1)),
      icon ? el('span', { class: 'power-icon' }, icon) : null,
    ));
  }

  // Players ring
  renderPlayersRing(view);

  // Deck info
  $('draw-count').textContent = view.deckCount ?? 17;
  $('discard-count').textContent = view.discardCount ?? 0;
  const dots = $('tracker-dots');
  dots.innerHTML = '';
  for (let i = 0; i < 3; i++) {
    dots.appendChild(el('div', { class: 'dot' + (i < (view.electionTracker || 0) ? ' active' : '') }));
  }

  // Center stage
  renderStage(view);

  // Header buttons
  $('btn-menu').onclick = () => showMenu(view);
  $('btn-log').onclick = () => showLog(view);
  $('btn-myrole').onclick = () => showMyRole(view);
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
    if (!p.connected) cls.push('disconnected');
    if (p.token === view.youToken) cls.push('you');
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
  const html = `
    <div class="log-list">
      ${(!view.log || view.log.length === 0) ? '<p style="color:var(--text-faint)">No events yet.</p>' :
        view.log.slice().reverse().map(e =>
          `<div class="log-entry ${e.cls || ''}">${e.text}</div>`
        ).join('')
      }
    </div>
  `;
  openModal('Game Log', html);
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
