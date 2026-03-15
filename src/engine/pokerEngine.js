const STREET_ORDER = ["preflop", "flop", "turn", "river", "showdown", "finished"];
export const MAX_SEATS = 10;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function makeBlindLevel(level, smallBlind, bigBlind, ante) {
  return {
    level,
    smallBlind: n(smallBlind, 0),
    bigBlind: n(bigBlind, 0),
    ante: n(ante, 0),
  };
}

function normalizeBlindLevels(levels) {
  const source = Array.isArray(levels) && levels.length
    ? levels
    : [
        makeBlindLevel(1, 50, 100, 100),
        makeBlindLevel(2, 100, 200, 200),
        makeBlindLevel(3, 200, 400, 400),
        makeBlindLevel(4, 300, 600, 600),
        makeBlindLevel(5, 500, 1000, 1000),
      ];

  return source.map((item, idx) =>
    makeBlindLevel(
      idx + 1,
      item?.smallBlind,
      item?.bigBlind,
      item?.ante
    )
  );
}

function clampBlindLevelIndex(levels, index) {
  const normalized = normalizeBlindLevels(levels);
  if (!normalized.length) return 0;
  return Math.max(0, Math.min(n(index, 0), normalized.length - 1));
}

function applyBlindLevelToState(state, index) {
  const levels = normalizeBlindLevels(state.blindLevels);
  const nextIndex = clampBlindLevelIndex(levels, index);
  const level = levels[nextIndex];

  state.blindLevels = levels;
  state.currentBlindLevelIndex = nextIndex;
  state.smallBlind = n(level.smallBlind, 0);
  state.bigBlind = n(level.bigBlind, 0);
  state.ante = n(level.ante, 0);

  return state;
}

function applyPendingBlindLevel(state) {
  const levels = normalizeBlindLevels(state.blindLevels);
  const pendingIndex =
    state.pendingBlindLevelIndex == null
      ? state.currentBlindLevelIndex ?? 0
      : state.pendingBlindLevelIndex;

  applyBlindLevelToState(state, pendingIndex);
  state.pendingBlindLevelIndex = state.currentBlindLevelIndex;
  return state;
}

function isAvailableForHand(player) {
  return !!player && !player.sitOut && player.stack > 0;
}

function isInCurrentHand(player) {
  return !!player && !!player.inHand && !player.sitOut;
}

function canAct(player) {
  return isInCurrentHand(player) && !player.folded && !player.allIn;
}

function canPostBlind(player) {
  return !!player && !player.sitOut && player.stack > 0;
}

function occupiedSeatIndices(seats) {
  return seats
    .map((seat, idx) => ({ seat, idx }))
    .filter(({ seat }) => !!seat)
    .map(({ idx }) => idx);
}

function activeSeatIndices(seats) {
  return seats
    .map((seat, idx) => ({ seat, idx }))
    .filter(({ seat }) => isAvailableForHand(seat))
    .map(({ idx }) => idx);
}

function activePlayers(seats) {
  return seats.filter((p) => isInCurrentHand(p) && !p.folded);
}

function actingPlayers(seats) {
  return seats.filter((p) => canAct(p));
}

function nextSeatIndex(seats, startIndex, predicate) {
  if (!seats.length) return -1;

  for (let i = 1; i <= seats.length; i++) {
    const idx = (startIndex + i) % seats.length;
    if (predicate(seats[idx], idx)) return idx;
  }

  return -1;
}

function getNextOccupiedSeat(seats, fromSeatIndex) {
  return nextSeatIndex(seats, fromSeatIndex, (seat) => !!seat);
}

function getNextOccupiedFromList(occupied, fromSeatIndex, step = 1) {
  if (!occupied.length) return -1;

  const pos = occupied.indexOf(fromSeatIndex);
  if (pos === -1) return occupied[0];

  return occupied[(pos + step) % occupied.length];
}

function getBlindAssignments(seats, dealerSeatIndex) {
  const occupied = occupiedSeatIndices(seats);

  if (occupied.length < 2) {
    return {
      buttonSeatIndex: dealerSeatIndex,
      sbPositionSeatIndex: -1,
      bbPositionSeatIndex: -1,
      sbSeatIndex: -1,
      bbSeatIndex: -1,
    };
  }

  if (occupied.length === 2) {
    const buttonSeatIndex = dealerSeatIndex;
    const otherSeatIndex = getNextOccupiedFromList(occupied, dealerSeatIndex, 1);

    return {
      buttonSeatIndex,
      sbPositionSeatIndex: buttonSeatIndex,
      bbPositionSeatIndex: otherSeatIndex,
      sbSeatIndex: canPostBlind(seats[buttonSeatIndex]) ? buttonSeatIndex : -1,
      bbSeatIndex: canPostBlind(seats[otherSeatIndex]) ? otherSeatIndex : -1,
    };
  }

  const buttonSeatIndex = dealerSeatIndex;
  const sbPositionSeatIndex = getNextOccupiedFromList(occupied, buttonSeatIndex, 1);
  const sbSeatIndex = canPostBlind(seats[sbPositionSeatIndex]) ? sbPositionSeatIndex : -1;

  let bbPositionSeatIndex = -1;
  let bbSeatIndex = -1;

  for (let step = 2; step <= occupied.length + 1; step++) {
    const candidate = getNextOccupiedFromList(occupied, buttonSeatIndex, step);
    if (candidate === -1) break;

    if (canPostBlind(seats[candidate])) {
      bbPositionSeatIndex = candidate;
      bbSeatIndex = candidate;
      break;
    }
  }

  return {
    buttonSeatIndex,
    sbPositionSeatIndex,
    bbPositionSeatIndex,
    sbSeatIndex,
    bbSeatIndex,
  };
}

function getFirstToActPreflop(seats, dealerSeatIndex) {
  const active = activeSeatIndices(seats);
  if (active.length < 2) return -1;

  const { bbSeatIndex } = getBlindAssignments(seats, dealerSeatIndex);
  if (bbSeatIndex === -1) return active[0];

  return nextSeatIndex(seats, bbSeatIndex, (p) => canAct(p));
}

function getFirstToActPostflop(seats, dealerSeatIndex) {
  const active = activeSeatIndices(seats);
  if (active.length < 2) return -1;

  return nextSeatIndex(seats, dealerSeatIndex, (p) => canAct(p));
}

function pay(player, amount, countAsStreet = true) {
  const invest = Math.max(0, Math.min(n(amount), player.stack));
  player.stack -= invest;
  player.totalInvested += invest;

  if (countAsStreet) {
    player.streetInvested += invest;
  }

  if (player.stack === 0) {
    player.allIn = true;
  }

  return invest;
}

function refund(player, amount, countAsStreet = true) {
  const value = Math.max(0, n(amount));
  player.stack += value;
  player.totalInvested = Math.max(0, player.totalInvested - value);

  if (countAsStreet) {
    player.streetInvested = Math.max(0, player.streetInvested - value);
  }

  if (player.stack > 0) {
    player.allIn = false;
  }

  return value;
}

function resetPendingPlayersActed(state, actorSeatIndex) {
  state.seats.forEach((p, idx) => {
    if (idx !== actorSeatIndex && canAct(p)) {
      p.acted = false;
    }
  });
}

function mergeSameEligiblePots(pots) {
  const merged = [];

  for (const pot of pots) {
    if (!pot || pot.amount <= 0) continue;

    const normalizedEligible = [...new Set(pot.eligibleSeatIndices)].sort((a, b) => a - b);
    const last = merged[merged.length - 1];

    const same =
      last &&
      last.eligibleSeatIndices.length === normalizedEligible.length &&
      last.eligibleSeatIndices.every((v, i) => v === normalizedEligible[i]);

    if (same) {
      last.amount += pot.amount;
    } else {
      merged.push({
        amount: pot.amount,
        eligibleSeatIndices: normalizedEligible,
      });
    }
  }

  return merged;
}

function mergePendingExcess(items) {
  const bySeat = new Map();

  for (const item of items) {
    if (!item || item.amount <= 0) continue;
    const prev = bySeat.get(item.seatIndex) || 0;
    bySeat.set(item.seatIndex, prev + item.amount);
  }

  return [...bySeat.entries()]
    .map(([seatIndex, amount]) => ({ seatIndex, amount }))
    .sort((a, b) => a.seatIndex - b.seatIndex);
}

function recomputePotState(seats) {
  const invested = seats
    .map((p, seatIndex) =>
      p && p.totalInvested > 0
        ? {
            seatIndex,
            invested: p.totalInvested,
            folded: p.folded,
            inHand: p.inHand,
            sitOut: p.sitOut,
            allIn: p.allIn,
          }
        : null
    )
    .filter(Boolean);

  if (!invested.length) {
    return {
      confirmedPots: [],
      pendingExcess: [],
    };
  }

  const isLiveEligible = (p) => p.inHand && !p.sitOut && !p.folded;

  const liveEligible = invested.filter(isLiveEligible).map((p) => p.seatIndex);
  if (liveEligible.length < 2) {
    return {
      confirmedPots: [],
      pendingExcess: [],
    };
  }

  const hasAllInPlayer = invested.some((p) => p.allIn);

  if (!hasAllInPlayer) {
    return {
      confirmedPots: [
        {
          amount: invested.reduce((sum, p) => sum + p.invested, 0),
          eligibleSeatIndices: liveEligible,
        },
      ],
      pendingExcess: [],
    };
  }

  const levels = [...new Set(invested.map((p) => p.invested))].sort((a, b) => a - b);

  const confirmedPots = [];
  const pendingExcess = [];
  let prev = 0;

  for (const level of levels) {
    const contributors = invested.filter((p) => p.invested >= level);
    const slice = level - prev;
    const amount = slice * contributors.length;

    if (amount <= 0) {
      prev = level;
      continue;
    }

    const eligibleSeatIndices = contributors.filter(isLiveEligible).map((p) => p.seatIndex);

    if (contributors.length >= 2) {
      confirmedPots.push({
        amount,
        eligibleSeatIndices,
      });
    } else if (contributors.length === 1) {
      pendingExcess.push({
        seatIndex: contributors[0].seatIndex,
        amount,
      });
    }

    prev = level;
  }

  return {
    confirmedPots: mergeSameEligiblePots(confirmedPots),
    pendingExcess: mergePendingExcess(pendingExcess),
  };
}

function updateDerived(state) {
  const { confirmedPots, pendingExcess } = recomputePotState(state.seats);

  state.confirmedPots = confirmedPots;
  state.pendingExcess = pendingExcess;
  state.pots = confirmedPots;
  state.totalCommitted = state.seats.reduce((sum, p) => sum + (p ? p.totalInvested : 0), 0);

  return state;
}

function roundComplete(state) {
  const alive = activePlayers(state.seats);
  if (alive.length <= 1) return true;

  const actors = actingPlayers(state.seats);
  if (actors.length === 0) return true;

  return actors.every((p) => p.acted && p.streetInvested === state.currentBet);
}

function shouldGoDirectToShowdown(state) {
  const alive = state.seats.filter((p) => isInCurrentHand(p) && !p.folded);
  if (alive.length <= 1) return true;

  const actors = alive.filter((p) => !p.allIn && !p.sitOut);

  if (actors.length === 0) return true;

  if (actors.length === 1) {
    const onlyActor = actors[0];
    return onlyActor.acted && onlyActor.streetInvested === state.currentBet;
  }

  return false;
}

function shouldForceImmediateShowdown(state) {
  const alive = state.seats.filter((p) => isInCurrentHand(p) && !p.folded);

  if (alive.length <= 1) return false;

  const actors = alive.filter((p) => !p.allIn && !p.sitOut);
  return actors.length === 0;
}

function getAggressiveLabel(street, currentStreetBetLevel) {
  const nextLevel = n(currentStreetBetLevel, 0) + 1;

  if (street === "preflop") {
    if (nextLevel === 1) return "RAISE";
    return `${nextLevel + 1}-BET`;
  }

  if (nextLevel === 1) return "BET";
  if (nextLevel === 2) return "RAISE";
  return `${nextLevel}-BET`;
}

function moveToShowdown(state) {
  state.street = "showdown";
  state.currentSeatIndex = -1;
  state.currentBet = 0;
  return updateDerived(state);
}

function moveToNextStreet(state) {
  if (state.street === "river") {
    return moveToShowdown(state);
  }

  const currentStreetIndex = STREET_ORDER.indexOf(state.street);
  state.street = STREET_ORDER[currentStreetIndex + 1];

  state.seats.forEach((p) => {
    if (!p) return;
    p.streetInvested = 0;
    p.acted = !canAct(p);
    p.streetActionLabel = "";
  });

  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.streetBetLevel = 0;

  const firstSeat = getFirstToActPostflop(state.seats, state.dealerSeatIndex);
  state.currentSeatIndex = firstSeat;

  updateDerived(state);

  if (shouldForceImmediateShowdown(state)) {
    return moveToShowdown(state);
  }

  return state;
}

function advanceTurn(state, actorSeatIndex) {
  state.currentSeatIndex = nextSeatIndex(state.seats, actorSeatIndex, (p) => canAct(p));
}

function snapshotForHistory(state) {
  const snap = clone(state);
  snap.history = [];
  return snap;
}

function returnUncalledExcess(state) {
  const invested = state.seats
    .map((p, seatIndex) =>
      p && p.totalInvested > 0
        ? {
            seatIndex,
            totalInvested: p.totalInvested,
            streetInvested: p.streetInvested,
          }
        : null
    )
    .filter(Boolean)
    .sort((a, b) => b.totalInvested - a.totalInvested);

  if (invested.length < 2) return 0;

  const top = invested[0];
  const second = invested[1];
  if (top.totalInvested <= second.totalInvested) return 0;

  const uncalled = top.totalInvested - second.totalInvested;
  const player = state.seats[top.seatIndex];
  if (!player || uncalled <= 0) return 0;

  const streetRefund = Math.min(player.streetInvested, uncalled);
  refund(player, uncalled, false);
  if (streetRefund > 0) {
    player.streetInvested = Math.max(0, player.streetInvested - streetRefund);
  }

  state.log.push(`${player.name} gets ${uncalled} back as uncalled chips`);
  updateDerived(state);
  return uncalled;
}

function finishHandState(state) {
  state.street = "finished";
  state.currentSeatIndex = -1;
  state.currentBet = 0;
  state.minRaise = state.bigBlind;
  state.streetBetLevel = 0;
  state.forcedBets = {
    sbSeatIndex: -1,
    bbSeatIndex: -1,
    sbAmount: 0,
    bbAmount: 0,
    anteAmount: 0,
  };

  state.seats.forEach((p) => {
    if (!p) return;
    p.totalInvested = 0;
    p.streetInvested = 0;
    p.acted = false;
    p.folded = false;
    p.allIn = false;
    p.inHand = false;
    p.streetActionLabel = "";
  });

  state.confirmedPots = [];
  state.pendingExcess = [];
  state.pots = [];
  state.totalCommitted = 0;
  return state;
}

function awardIfOneRemaining(state) {
  const alive = state.seats.filter((p) => isInCurrentHand(p) && !p.folded);
  if (alive.length !== 1) return false;

  returnUncalledExcess(state);

  const winner = alive[0];
  const totalPot = state.seats.reduce((sum, p) => sum + (p ? p.totalInvested : 0), 0);

  winner.stack += totalPot;
  state.log.push(`${winner.name} wins ${totalPot} (everyone else folded)`);

  finishHandState(state);
  return true;
}

function finalizeStateProgress(state, actorSeatIndex = -1) {
  updateDerived(state);

  if (awardIfOneRemaining(state)) return state;

  if (shouldForceImmediateShowdown(state)) {
    return moveToShowdown(state);
  }

  if (roundComplete(state)) {
    if (state.street === "river" || shouldGoDirectToShowdown(state)) {
      return moveToShowdown(state);
    }

    const moved = moveToNextStreet(state);

    if (shouldForceImmediateShowdown(moved)) {
      return moveToShowdown(moved);
    }

    return moved;
  }

  if (actorSeatIndex >= 0) {
    advanceTurn(state, actorSeatIndex);
  } else if (state.currentSeatIndex !== -1 && !canAct(state.seats[state.currentSeatIndex])) {
    state.currentSeatIndex = nextSeatIndex(state.seats, state.currentSeatIndex, (p) => canAct(p));
  }

  if (state.currentSeatIndex === -1 && !awardIfOneRemaining(state)) {
    const alive = state.seats.filter((p) => isInCurrentHand(p) && !p.folded);
    if (alive.length > 1) {
      return moveToShowdown(state);
    }
  }

  return updateDerived(state);
}

function countAvailablePlayers(seats) {
  return seats.filter((p) => isAvailableForHand(p)).length;
}

function makePlayer(id, name, stack) {
  return {
    id,
    name,
    startStack: stack,
    stack,
    totalInvested: 0,
    streetInvested: 0,
    folded: false,
    allIn: false,
    acted: false,
    sitOut: false,
    inHand: false,
    streetActionLabel: "",
  };
}

function nextPlayerId(seats) {
  const ids = seats.filter(Boolean).map((p) => p.id);
  return ids.length ? Math.max(...ids) + 1 : 1;
}

export function createInitialSetup() {
  const seats = Array(MAX_SEATS).fill(null);
  seats[0] = makePlayer(1, "P1", 5000);
  seats[1] = makePlayer(2, "P2", 5000);
  seats[2] = makePlayer(3, "P3", 5000);
  seats[3] = makePlayer(4, "P4", 5000);

  const blindLevels = normalizeBlindLevels();

  return {
    smallBlind: blindLevels[0].smallBlind,
    bigBlind: blindLevels[0].bigBlind,
    ante: blindLevels[0].ante,
    blindLevels,
    currentBlindLevelIndex: 0,
    pendingBlindLevelIndex: 0,
    dealerSeatIndex: 0,
    street: "setup",
    currentBet: 0,
    minRaise: blindLevels[0].bigBlind,
    currentSeatIndex: -1,
    totalCommitted: 0,
    confirmedPots: [],
    pendingExcess: [],
    pots: [],
    forcedBets: {
      sbSeatIndex: -1,
      bbSeatIndex: -1,
      sbAmount: 0,
      bbAmount: 0,
      anteAmount: 0,
    },
    seats,
    log: [],
    history: [],
    streetBetLevel: 0,
  };
}

export function startHand(setupState, keepStacks = false) {
  const state = clone(setupState);

  applyPendingBlindLevel(state);

  state.street = "preflop";
  state.currentBet = 0;
  state.minRaise = n(state.bigBlind, 100);
  state.log = [];
  state.history = [];
  state.streetBetLevel = 0;
  state.confirmedPots = [];
  state.pendingExcess = [];
  state.pots = [];
  state.forcedBets = {
    sbSeatIndex: -1,
    bbSeatIndex: -1,
    sbAmount: 0,
    bbAmount: 0,
    anteAmount: 0,
  };

  state.seats = state.seats.map((p) => {
    if (!p) return null;
    const stackBase = keepStacks ? n(p.stack, p.startStack) : n(p.startStack, 0);
    const available = !p.sitOut && stackBase > 0;

    return {
      ...p,
      stack: stackBase,
      totalInvested: 0,
      streetInvested: 0,
      folded: false,
      allIn: false,
      acted: false,
      inHand: available,
      streetActionLabel: "",
    };
  });

  if (countAvailablePlayers(state.seats) < 2) {
    state.street = "finished";
    state.log.push("Need at least 2 active players with chips to start a hand.");
    return updateDerived(state);
  }

  const occupiedSeats = occupiedSeatIndices(state.seats);
  if (!occupiedSeats.includes(state.dealerSeatIndex)) {
    state.dealerSeatIndex = occupiedSeats[0];
  }

  const bbAnte = n(state.ante, 0);
  const sb = n(state.smallBlind, 0);
  const bb = n(state.bigBlind, 0);

  const { sbPositionSeatIndex, bbPositionSeatIndex, sbSeatIndex, bbSeatIndex } =
    getBlindAssignments(state.seats, state.dealerSeatIndex);

  const sbPaid = sbSeatIndex >= 0 ? pay(state.seats[sbSeatIndex], sb, true) : 0;
  const bbPaid = bbSeatIndex >= 0 ? pay(state.seats[bbSeatIndex], bb, true) : 0;
  const bbAntePaid =
    bbAnte > 0 && bbSeatIndex >= 0 ? pay(state.seats[bbSeatIndex], bbAnte, false) : 0;

  state.forcedBets = {
    sbSeatIndex: sbPositionSeatIndex,
    bbSeatIndex: bbPositionSeatIndex,
    sbAmount: sbPaid,
    bbAmount: bbPaid,
    anteAmount: bbAntePaid,
  };

  state.currentBet = bbPaid;
  state.minRaise = bb;

  if (sbPositionSeatIndex >= 0) {
    if (sbPaid > 0) {
      state.log.push(`${state.seats[sbSeatIndex].name} posts SB ${sbPaid}`);
    } else {
      state.log.push(`Seat ${sbPositionSeatIndex + 1} is dead SB`);
    }
  }

  if (bbPositionSeatIndex >= 0 && bbSeatIndex >= 0) {
    state.log.push(`${state.seats[bbSeatIndex].name} posts BB ${bbPaid}`);
    if (bbAntePaid > 0) {
      state.log.push(`${state.seats[bbSeatIndex].name} posts BB Ante ${bbAntePaid}`);
    }
  }

  state.seats.forEach((p) => {
    if (!p) return;
    p.acted = !canAct(p);
  });

  if (sbSeatIndex >= 0 && canAct(state.seats[sbSeatIndex])) {
    state.seats[sbSeatIndex].acted = true;
  }

  if (bbSeatIndex >= 0 && canAct(state.seats[bbSeatIndex])) {
    state.seats[bbSeatIndex].acted = false;
  }

  state.currentSeatIndex = getFirstToActPreflop(state.seats, state.dealerSeatIndex);

  return updateDerived(state);
}

export function startNextHand(prevState) {
  const next = clone(prevState);
  const occupiedSeats = occupiedSeatIndices(next.seats);

  if (occupiedSeats.length) {
    const pos = occupiedSeats.indexOf(next.dealerSeatIndex);
    next.dealerSeatIndex =
      pos === -1 ? occupiedSeats[0] : occupiedSeats[(pos + 1) % occupiedSeats.length];
  }

  applyPendingBlindLevel(next);
  return startHand(next, true);
}

export function undoAction(prevState) {
  if (!prevState.history || prevState.history.length === 0) return prevState;

  const state = clone(prevState);
  const last = state.history[state.history.length - 1];
  last.history = state.history.slice(0, -1);
  return last;
}

export function getCurrentPlayer(state) {
  if (state.currentSeatIndex < 0) return null;
  return state.seats[state.currentSeatIndex] || null;
}

export function getCallAmount(state, seatIndex) {
  const p = state.seats[seatIndex];
  if (!p) return 0;
  return Math.max(0, state.currentBet - p.streetInvested);
}

export function getMinRaiseTo(state, seatIndex) {
  const p = state.seats[seatIndex];
  if (!p) return state.currentBet;
  if (state.currentBet === 0) return state.bigBlind;
  return state.currentBet + state.minRaise;
}

export function getForcedBetMarkers(state) {
  if (!state || state.street !== "preflop") {
    return {
      sbSeatIndex: -1,
      bbSeatIndex: -1,
      sbAmount: 0,
      bbAmount: 0,
      anteAmount: 0,
    };
  }

  return (
    state.forcedBets || {
      sbSeatIndex: -1,
      bbSeatIndex: -1,
      sbAmount: 0,
      bbAmount: 0,
      anteAmount: 0,
    }
  );
}

export function applyAction(prevState, action, rawAmount = 0) {
  const state = clone(prevState);
  if (["setup", "showdown", "finished"].includes(state.street)) return state;

  state.history = [...(state.history || []), snapshotForHistory(prevState)];

  const idx = state.currentSeatIndex;
  const player = state.seats[idx];
  if (!player || !canAct(player)) return state;

  const toCall = Math.max(0, state.currentBet - player.streetInvested);
  const amount = n(rawAmount, 0);

  switch (action) {
    case "fold":
      player.folded = true;
      player.acted = true;
      player.streetActionLabel = "";
      state.log.push(`${player.name}: fold`);
      break;

    case "check":
      if (toCall !== 0) return prevState;
      player.acted = true;
      player.streetActionLabel = "CHECK";
      state.log.push(`${player.name}: check`);
      break;

    case "call": {
      const paid = pay(player, toCall, true);
      player.acted = true;
      player.streetActionLabel = "CALL";
      state.log.push(`${player.name}: call ${paid}`);
      break;
    }

    case "bet": {
      if (state.currentBet !== 0) return prevState;
      if (amount <= 0) return prevState;

      const maxTotal = player.streetInvested + player.stack;
      const target = Math.min(amount, maxTotal);
      const minBet = state.bigBlind;
      const isAllInAttempt = target >= maxTotal;
      const isFullBet = target >= minBet;

      if (!isAllInAttempt && !isFullBet) return prevState;

      const paid = pay(player, target - player.streetInvested, true);
      const newBet = player.streetInvested;

      if (newBet <= 0) return prevState;

      state.currentBet = newBet;

      if (isFullBet) {
        state.minRaise = newBet;
      }

      player.acted = true;
      player.streetActionLabel = player.allIn
        ? `${getAggressiveLabel(state.street, state.streetBetLevel)} ALL-IN`
        : getAggressiveLabel(state.street, state.streetBetLevel);

      if (isFullBet) {
        state.streetBetLevel += 1;
        resetPendingPlayersActed(state, idx);
      }

      state.log.push(`${player.name}: bet ${paid}`);
      break;
    }

    case "raise": {
      if (state.currentBet === 0) return prevState;

      const maxTotal = player.streetInvested + player.stack;
      if (amount <= state.currentBet) return prevState;

      const target = Math.min(amount, maxTotal);
      const minRaiseTo = state.currentBet + state.minRaise;
      const isAllInAttempt = target >= maxTotal;
      const isFullRaise = target >= minRaiseTo;

      if (!isAllInAttempt && !isFullRaise) return prevState;

      const paid = pay(player, target - player.streetInvested, true);
      const newBet = player.streetInvested;
      const previousBet = state.currentBet;

      if (newBet <= previousBet) return prevState;

      state.currentBet = newBet;
      player.acted = true;

      if (isFullRaise) {
        const raiseSize = newBet - previousBet;
        state.minRaise = raiseSize;
        player.streetActionLabel = player.allIn
          ? `${getAggressiveLabel(state.street, state.streetBetLevel)} ALL-IN`
          : getAggressiveLabel(state.street, state.streetBetLevel);

        state.streetBetLevel += 1;
        resetPendingPlayersActed(state, idx);
      } else {
        player.streetActionLabel = "ALL-IN";
      }

      state.log.push(
        `${player.name}: raise to ${newBet} (+${paid})${isFullRaise ? "" : " [short all-in]"}`
      );
      break;
    }

    case "allin": {
      if (player.stack <= 0) return prevState;

      const prevCurrentBet = state.currentBet;
      const maxTotal = player.streetInvested + player.stack;

      const paid = pay(player, player.stack, true);
      const newBet = player.streetInvested;

      if (newBet <= prevCurrentBet) {
        player.streetActionLabel = "ALL-IN";
        player.acted = true;
        state.log.push(`${player.name}: all-in ${paid} (to ${newBet})`);
        return finalizeStateProgress(state, idx);
      }

      if (prevCurrentBet === 0) {
        const minBet = state.bigBlind;
        const isFullBet = newBet >= minBet;

        state.currentBet = newBet;
        player.acted = true;

        if (isFullBet) {
          state.minRaise = newBet;
          player.streetActionLabel = `${getAggressiveLabel(state.street, state.streetBetLevel)} ALL-IN`;
          state.streetBetLevel += 1;
          resetPendingPlayersActed(state, idx);
        } else {
          player.streetActionLabel = "ALL-IN";
        }

        state.log.push(
          `${player.name}: all-in ${paid} (to ${newBet})${isFullBet ? "" : " [short bet]"}`
        );
        return finalizeStateProgress(state, idx);
      }

      const minRaiseTo = prevCurrentBet + state.minRaise;
      const isFullRaise = newBet >= minRaiseTo;

      state.currentBet = newBet;
      player.acted = true;

      if (isFullRaise) {
        const raiseSize = newBet - prevCurrentBet;
        state.minRaise = raiseSize;
        player.streetActionLabel = `${getAggressiveLabel(state.street, state.streetBetLevel)} ALL-IN`;
        state.streetBetLevel += 1;
        resetPendingPlayersActed(state, idx);
      } else {
        player.streetActionLabel = "ALL-IN";
      }

      state.log.push(
        `${player.name}: all-in ${paid} (to ${newBet})${isFullRaise ? "" : " [short raise]"}`
      );
      break;
    }

    default:
      return prevState;
  }

  return finalizeStateProgress(state, idx);
}

export function settleShowdown(prevState, winnersByPot) {
  const state = clone(prevState);
  if (state.street !== "showdown") return state;

  state.history = [...(state.history || []), snapshotForHistory(prevState)];
  returnUncalledExcess(state);

  state.confirmedPots.forEach((pot, potIndex) => {
    const selected = Array.isArray(winnersByPot[potIndex]) ? winnersByPot[potIndex] : [];
    const winners = selected.filter((seatIndex) => pot.eligibleSeatIndices.includes(seatIndex));

    if (!winners.length) return;

    const share = Math.floor(pot.amount / winners.length);
    const remainder = pot.amount % winners.length;

    winners.forEach((seatIndex, idx) => {
      const p = state.seats[seatIndex];
      if (p) {
        p.stack += share + (idx < remainder ? 1 : 0);
      }
    });

    const names = winners
      .map((seatIndex) => state.seats[seatIndex]?.name)
      .filter(Boolean)
      .join(", ");
    state.log.push(`Pot ${potIndex + 1} (${pot.amount}) -> ${names}`);
  });

  finishHandState(state);
  return state;
}

export function addPlayerToSeat(prevState, seatIndex, playerData) {
  const state = clone(prevState);
  if (seatIndex < 0 || seatIndex >= MAX_SEATS) return state;
  if (state.seats[seatIndex]) return state;

  const id = nextPlayerId(state.seats);
  const stack = n(playerData?.stack, 5000);
  const name = playerData?.name?.trim() || `P${id}`;

  state.seats[seatIndex] = makePlayer(id, name, stack);
  state.log.push(`${name} takes seat ${seatIndex + 1} and will enter next hand`);
  return state;
}

export function toggleSitOut(prevState, seatIndex) {
  const state = clone(prevState);
  const player = state.seats[seatIndex];
  if (!player) return state;

  if (state.street === "setup" || state.street === "finished") {
    player.sitOut = !player.sitOut;
    player.inHand = false;
    state.log.push(`${player.name} is now ${player.sitOut ? "sitting out" : "back in"}`);
    return state;
  }

  if (player.inHand) {
    player.sitOut = true;
    player.folded = true;
    player.acted = true;
    player.streetActionLabel = "";
    state.log.push(`${player.name} sits out and folds current hand`);

    return finalizeStateProgress(state, state.currentSeatIndex === seatIndex ? seatIndex : -1);
  }

  player.sitOut = !player.sitOut;
  state.log.push(`${player.name} is now ${player.sitOut ? "sitting out" : "back in for next hand"}`);
  return state;
}

export function removePlayerFromSeat(prevState, seatIndex) {
  const state = clone(prevState);
  const player = state.seats[seatIndex];
  const occupiedCount = state.seats.filter(Boolean).length;
  if (!player || occupiedCount <= 2) return state;

  const wasCurrentSeat = state.currentSeatIndex === seatIndex;

  if (["preflop", "flop", "turn", "river"].includes(state.street) && player.inHand && !player.folded) {
    player.folded = true;
    player.acted = true;
    player.streetActionLabel = "";
    state.log.push(`${player.name} leaves seat ${seatIndex + 1} and forfeits current hand`);
  } else {
    state.log.push(`${player.name} leaves seat ${seatIndex + 1}`);
  }

  state.seats[seatIndex] = null;

  if (state.dealerSeatIndex === seatIndex) {
    const nextOccupied = getNextOccupiedSeat(state.seats, seatIndex);
    state.dealerSeatIndex = nextOccupied === -1 ? 0 : nextOccupied;
  }

  if (state.currentSeatIndex === seatIndex) {
    state.currentSeatIndex = nextSeatIndex(state.seats, seatIndex, (p) => canAct(p));
  }

  if (state.forcedBets?.sbSeatIndex === seatIndex) {
    state.forcedBets.sbSeatIndex = -1;
    state.forcedBets.sbAmount = 0;
  }

  if (state.forcedBets?.bbSeatIndex === seatIndex) {
    state.forcedBets.bbSeatIndex = -1;
    state.forcedBets.bbAmount = 0;
    state.forcedBets.anteAmount = 0;
  }

  return finalizeStateProgress(state, wasCurrentSeat ? seatIndex : -1);
}

export function swapSeats(prevState, seatA, seatB) {
  const state = clone(prevState);
  if (
    seatA < 0 ||
    seatB < 0 ||
    seatA >= MAX_SEATS ||
    seatB >= MAX_SEATS ||
    seatA === seatB
  ) {
    return state;
  }

  const temp = state.seats[seatA];
  state.seats[seatA] = state.seats[seatB];
  state.seats[seatB] = temp;

  if (state.dealerSeatIndex === seatA) state.dealerSeatIndex = seatB;
  else if (state.dealerSeatIndex === seatB) state.dealerSeatIndex = seatA;

  if (state.currentSeatIndex === seatA) state.currentSeatIndex = seatB;
  else if (state.currentSeatIndex === seatB) state.currentSeatIndex = seatA;

  if (state.forcedBets?.sbSeatIndex === seatA) state.forcedBets.sbSeatIndex = seatB;
  else if (state.forcedBets?.sbSeatIndex === seatB) state.forcedBets.sbSeatIndex = seatA;

  if (state.forcedBets?.bbSeatIndex === seatA) state.forcedBets.bbSeatIndex = seatB;
  else if (state.forcedBets?.bbSeatIndex === seatB) state.forcedBets.bbSeatIndex = seatA;

  state.log.push(`Swapped seat ${seatA + 1} and seat ${seatB + 1}`);
  return state;
}

export function streetLabel(street) {
  switch (street) {
    case "preflop":
      return "Preflop";
    case "flop":
      return "Flop";
    case "turn":
      return "Turn";
    case "river":
      return "River";
    case "showdown":
      return "Showdown";
    case "finished":
      return "Finished";
    default:
      return "Setup";
  }
}

export function formatPotName(index) {
  return index === 0 ? "Main Pot" : `Side Pot ${index}`;
}