const STREET_ORDER = ["preflop", "flop", "turn", "river", "showdown", "finished"];
export const MAX_SEATS = 10;
export const DEFAULT_CHIP_UNIT = 100;

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function n(v, fallback = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function getChipUnit(stateLike) {
  return Math.max(1, n(stateLike?.chipUnit, DEFAULT_CHIP_UNIT));
}

function chipFloor(value, chipUnit = DEFAULT_CHIP_UNIT) {
  const num = Number(value) || 0;
  return Math.floor(num / chipUnit) * chipUnit;
}

function sortSeatIndicesFromDealerLeft(seatIndices, dealerSeatIndex, maxSeats) {
  return [...seatIndices].sort((a, b) => {
    const da = (a - dealerSeatIndex + maxSeats) % maxSeats;
    const db = (b - dealerSeatIndex + maxSeats) % maxSeats;
    return da - db;
  });
}

function makeBlindLevel(level, smallBlind, bigBlind, ante, chipUnit = DEFAULT_CHIP_UNIT) {
  return {
    level,
    smallBlind: chipFloor(n(smallBlind, 0), chipUnit),
    bigBlind: chipFloor(n(bigBlind, 0), chipUnit),
    ante: chipFloor(n(ante, 0), chipUnit),
  };
}

function normalizeBlindLevels(levels, chipUnit = DEFAULT_CHIP_UNIT) {
  const source =
    Array.isArray(levels) && levels.length
      ? levels
      : [
          makeBlindLevel(1, 100, 200, 200, chipUnit),
          makeBlindLevel(2, 200, 400, 400, chipUnit),
          makeBlindLevel(3, 300, 600, 600, chipUnit),
          makeBlindLevel(4, 500, 1000, 1000, chipUnit),
          makeBlindLevel(5, 1000, 2000, 2000, chipUnit),
        ];

  return source.map((item, idx) =>
    makeBlindLevel(idx + 1, item?.smallBlind, item?.bigBlind, item?.ante, chipUnit)
  );
}

function clampBlindLevelIndex(levels, index, chipUnit = DEFAULT_CHIP_UNIT) {
  const normalized = normalizeBlindLevels(levels, chipUnit);
  if (!normalized.length) return 0;
  return Math.max(0, Math.min(n(index, 0), normalized.length - 1));
}

function applyBlindLevelToState(state, index) {
  const chipUnit = getChipUnit(state);
  const levels = normalizeBlindLevels(state.blindLevels, chipUnit);
  const nextIndex = clampBlindLevelIndex(levels, index, chipUnit);
  const level = levels[nextIndex];

  state.blindLevels = levels;
  state.currentBlindLevelIndex = nextIndex;
  state.smallBlind = n(level.smallBlind, 0);
  state.bigBlind = n(level.bigBlind, 0);
  state.ante = n(level.ante, 0);

  return state;
}

function applyPendingBlindLevel(state) {
  const chipUnit = getChipUnit(state);
  const levels = normalizeBlindLevels(state.blindLevels, chipUnit);
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

function getFirstAvailableFromOccupied(seats, occupied, fromSeatIndex) {
  if (!occupied.length) return -1;

  const startPos = occupied.indexOf(fromSeatIndex);
  if (startPos === -1) return -1;

  for (let step = 0; step < occupied.length; step++) {
    const seatIndex = occupied[(startPos + step) % occupied.length];
    if (isAvailableForHand(seats[seatIndex])) return seatIndex;
  }

  return -1;
}

function getBlindAssignments(seats, dealerSeatIndex, previousForcedBets = null) {
  const occupied = occupiedSeatIndices(seats);
  const active = activeSeatIndices(seats);

  if (occupied.length < 2 || active.length < 2) {
    return {
      buttonSeatIndex: dealerSeatIndex,
      sbPositionSeatIndex: -1,
      bbPositionSeatIndex: -1,
      sbSeatIndex: -1,
      bbSeatIndex: -1,
    };
  }

  // Heads-up:
  // dealer = SB, other = BB
  // Special fix for 3-handed -> heads-up transition:
  // if previous hand BB is still active, that player becomes next D/SB.
  if (active.length === 2) {
    const prevBbSeatIndex = previousForcedBets?.bbSeatIndex;
    const prevButtonSeatIndex = previousForcedBets?.buttonSeatIndex;

    let buttonSeatIndex = -1;

    if (
      Number.isInteger(prevBbSeatIndex) &&
      prevBbSeatIndex >= 0 &&
      active.includes(prevBbSeatIndex)
    ) {
      buttonSeatIndex = prevBbSeatIndex;
    } else if (dealerSeatIndex >= 0 && active.includes(dealerSeatIndex)) {
      buttonSeatIndex = dealerSeatIndex;
    } else if (
      Number.isInteger(prevButtonSeatIndex) &&
      prevButtonSeatIndex >= 0 &&
      active.includes(prevButtonSeatIndex)
    ) {
      buttonSeatIndex = prevButtonSeatIndex;
    } else {
      buttonSeatIndex = active[0];
    }

    const bbSeatIndex = nextSeatIndex(
      seats,
      buttonSeatIndex,
      (seat) => isAvailableForHand(seat)
    );

    return {
      buttonSeatIndex,
      sbPositionSeatIndex: buttonSeatIndex,
      bbPositionSeatIndex: bbSeatIndex,
      sbSeatIndex: buttonSeatIndex,
      bbSeatIndex,
    };
  }

  // 3+ players: dead button / dead SB allowed
  const buttonSeatIndex = occupied.includes(dealerSeatIndex) ? dealerSeatIndex : occupied[0];
  const sbPositionSeatIndex = getNextOccupiedFromList(occupied, buttonSeatIndex, 1);
  const bbPositionSeatIndex = getNextOccupiedFromList(occupied, sbPositionSeatIndex, 1);

  const sbSeatIndex =
    sbPositionSeatIndex >= 0 && isAvailableForHand(seats[sbPositionSeatIndex])
      ? sbPositionSeatIndex
      : -1;

  const bbSeatIndex =
    bbPositionSeatIndex >= 0
      ? getFirstAvailableFromOccupied(seats, occupied, bbPositionSeatIndex)
      : -1;

  return {
    buttonSeatIndex,
    sbPositionSeatIndex,
    bbPositionSeatIndex,
    sbSeatIndex,
    bbSeatIndex,
  };
}

function getFirstToActPreflop(seats, dealerSeatIndex, forcedBets = null) {
  const active = activeSeatIndices(seats);
  if (active.length < 2) return -1;

  const bbSeatIndex =
    forcedBets?.bbSeatIndex != null && forcedBets.bbSeatIndex >= 0
      ? forcedBets.bbSeatIndex
      : getBlindAssignments(seats, dealerSeatIndex, forcedBets).bbSeatIndex;

  if (bbSeatIndex === -1) return active[0];

  return nextSeatIndex(seats, bbSeatIndex, (p) => canAct(p));
}

function getFirstToActPostflop(seats, dealerSeatIndex) {
  const active = activeSeatIndices(seats);
  if (active.length < 2) return -1;

  return nextSeatIndex(seats, dealerSeatIndex, (p) => canAct(p));
}

function pay(player, amount, chipUnit, countAsStreet = true) {
  const invest = Math.max(0, Math.min(chipFloor(n(amount), chipUnit), player.stack));
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

function refund(player, amount, chipUnit, countAsStreet = true) {
  const value = Math.max(0, chipFloor(n(amount), chipUnit));
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
  const isLiveEligible = (p) => p && p.inHand && !p.sitOut && !p.folded;

  const liveEligibleSeatIndices = seats
    .map((p, seatIndex) => ({ p, seatIndex }))
    .filter(({ p }) => isLiveEligible(p))
    .map(({ seatIndex }) => seatIndex);

  const invested = seats
    .map((p, seatIndex) => {
      if (!p || p.totalInvested <= 0) return null;

      const anteInvested = p.anteInvested || 0;
      const betInvested = Math.max(0, p.totalInvested - anteInvested);

      return {
        seatIndex,
        totalInvested: p.totalInvested,
        anteInvested,
        betInvested,
        folded: p.folded,
        inHand: p.inHand,
        sitOut: p.sitOut,
        allIn: p.allIn,
      };
    })
    .filter(Boolean);

  if (!invested.length) {
    return {
      confirmedPots: [],
      pendingExcess: [],
    };
  }

  const anteTotal = invested.reduce((sum, p) => sum + (p.anteInvested || 0), 0);
  const betContributors = invested.filter((p) => p.betInvested > 0);

  let confirmedPots = [];
  let pendingExcess = [];

  if (betContributors.length > 0 && liveEligibleSeatIndices.length >= 2) {
    const hasAllInPlayer = betContributors.some((p) => p.allIn);

    if (!hasAllInPlayer) {
      confirmedPots = [
        {
          amount: betContributors.reduce((sum, p) => sum + p.betInvested, 0),
          eligibleSeatIndices: [...liveEligibleSeatIndices],
        },
      ];
    } else {
      const levels = [...new Set(betContributors.map((p) => p.betInvested))].sort((a, b) => a - b);
      let prev = 0;

      for (const level of levels) {
        const contributors = betContributors.filter((p) => p.betInvested >= level);
        const slice = level - prev;
        const amount = slice * contributors.length;

        if (amount <= 0) {
          prev = level;
          continue;
        }

        const eligibleSeatIndices = contributors
          .filter((p) => isLiveEligible(seats[p.seatIndex]))
          .map((p) => p.seatIndex);

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

      confirmedPots = mergeSameEligiblePots(confirmedPots);
      pendingExcess = mergePendingExcess(pendingExcess);
    }
  }

  if (anteTotal > 0 && liveEligibleSeatIndices.length >= 2) {
    if (confirmedPots.length > 0) {
      confirmedPots[0] = {
        amount: confirmedPots[0].amount + anteTotal,
        eligibleSeatIndices: [
          ...new Set([...confirmedPots[0].eligibleSeatIndices, ...liveEligibleSeatIndices]),
        ].sort((a, b) => a - b),
      };
    } else {
      confirmedPots = [
        {
          amount: anteTotal,
          eligibleSeatIndices: [...liveEligibleSeatIndices],
        },
      ];
    }
  }

  return {
    confirmedPots,
    pendingExcess,
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
  const chipUnit = getChipUnit(state);

  const invested = state.seats
    .map((p, seatIndex) => {
      if (!p) return null;

      const anteInvested = p.anteInvested || 0;
      const betInvested = Math.max(0, (p.totalInvested || 0) - anteInvested);

      return betInvested > 0
        ? {
            seatIndex,
            betInvested,
            streetInvested: p.streetInvested,
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.betInvested - a.betInvested);

  if (invested.length < 2) return 0;

  const top = invested[0];
  const second = invested[1];
  if (top.betInvested <= second.betInvested) return 0;

  const uncalled = top.betInvested - second.betInvested;
  const player = state.seats[top.seatIndex];
  if (!player || uncalled <= 0) return 0;

  const streetRefund = Math.min(player.streetInvested, uncalled);
  refund(player, uncalled, chipUnit, false);

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

  state.lastHandForcedBets = clone(
    state.forcedBets || {
      buttonSeatIndex: -1,
      sbPositionSeatIndex: -1,
      bbPositionSeatIndex: -1,
      sbSeatIndex: -1,
      bbSeatIndex: -1,
      sbAmount: 0,
      bbAmount: 0,
      anteAmount: 0,
    }
  );

  state.forcedBets = {
    buttonSeatIndex: -1,
    sbPositionSeatIndex: -1,
    bbPositionSeatIndex: -1,
    sbSeatIndex: -1,
    bbSeatIndex: -1,
    sbAmount: 0,
    bbAmount: 0,
    anteAmount: 0,
  };

  state.seats.forEach((p) => {
    if (!p) return;
    p.totalInvested = 0;
    p.anteInvested = 0;
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

function makePlayer(id, name, stack, chipUnit = DEFAULT_CHIP_UNIT) {
  const normalizedStack = chipFloor(stack, chipUnit);

  return {
    id,
    name,
    startStack: normalizedStack,
    stack: normalizedStack,
    totalInvested: 0,
    anteInvested: 0,
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

function normalizeStateToChipUnit(state, nextChipUnit) {
  state.chipUnit = nextChipUnit;

  state.blindLevels = normalizeBlindLevels(state.blindLevels, nextChipUnit);

  const currentIdx = clampBlindLevelIndex(state.blindLevels, state.currentBlindLevelIndex, nextChipUnit);
  const pendingIdx = clampBlindLevelIndex(state.blindLevels, state.pendingBlindLevelIndex, nextChipUnit);

  state.currentBlindLevelIndex = currentIdx;
  state.pendingBlindLevelIndex = pendingIdx;

  const currentLevel = state.blindLevels[currentIdx];
  state.smallBlind = chipFloor(currentLevel.smallBlind, nextChipUnit);
  state.bigBlind = chipFloor(currentLevel.bigBlind, nextChipUnit);
  state.ante = chipFloor(currentLevel.ante, nextChipUnit);

  state.minRaise = chipFloor(state.minRaise || state.bigBlind, nextChipUnit);

  state.seats = state.seats.map((p) => {
    if (!p) return null;

    return {
      ...p,
      startStack: chipFloor(p.startStack, nextChipUnit),
      stack: chipFloor(p.stack, nextChipUnit),
      totalInvested: chipFloor(p.totalInvested, nextChipUnit),
      anteInvested: chipFloor(p.anteInvested || 0, nextChipUnit),
      streetInvested: chipFloor(p.streetInvested, nextChipUnit),
    };
  });

  updateDerived(state);
  return state;
}

export function createInitialSetup() {
  const chipUnit = DEFAULT_CHIP_UNIT;
  const seats = Array(MAX_SEATS).fill(null);
  seats[0] = makePlayer(1, "P1", 5000, chipUnit);
  seats[1] = makePlayer(2, "P2", 5000, chipUnit);
  seats[2] = makePlayer(3, "P3", 5000, chipUnit);
  seats[3] = makePlayer(4, "P4", 5000, chipUnit);

  const blindLevels = normalizeBlindLevels([], chipUnit);

  return {
    chipUnit,
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
      buttonSeatIndex: -1,
      sbPositionSeatIndex: -1,
      bbPositionSeatIndex: -1,
      sbSeatIndex: -1,
      bbSeatIndex: -1,
      sbAmount: 0,
      bbAmount: 0,
      anteAmount: 0,
    },
    lastHandForcedBets: {
      buttonSeatIndex: -1,
      sbPositionSeatIndex: -1,
      bbPositionSeatIndex: -1,
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

export function runChipRace(prevState, nextChipUnitRaw) {
  const state = clone(prevState);
  const nextChipUnit = Math.max(1, n(nextChipUnitRaw, getChipUnit(state)));
  const currentChipUnit = getChipUnit(state);

  if (nextChipUnit === currentChipUnit) return state;
  if (nextChipUnit < currentChipUnit) return state;
  if (state.street !== "setup" && state.street !== "finished") return state;

  normalizeStateToChipUnit(state, nextChipUnit);
  state.log = [...(state.log || []), `Chip race completed: chip unit ${currentChipUnit} -> ${nextChipUnit}`];
  return state;
}

export function startHand(setupState, keepStacks = false) {
  const state = clone(setupState);
  const chipUnit = getChipUnit(state);

  applyPendingBlindLevel(state);

  // IMPORTANT:
  // Use lastHandForcedBets first, because finishHandState resets forcedBets.
  const previousForcedBets = clone(state.lastHandForcedBets || state.forcedBets || null);

  state.street = "preflop";
  state.currentBet = 0;
  state.minRaise = n(state.bigBlind, chipUnit);
  state.log = [];
  state.history = [];
  state.streetBetLevel = 0;
  state.confirmedPots = [];
  state.pendingExcess = [];
  state.pots = [];
  state.forcedBets = {
    buttonSeatIndex: -1,
    sbPositionSeatIndex: -1,
    bbPositionSeatIndex: -1,
    sbSeatIndex: -1,
    bbSeatIndex: -1,
    sbAmount: 0,
    bbAmount: 0,
    anteAmount: 0,
  };

  state.seats = state.seats.map((p) => {
    if (!p) return null;
    const stackBase = keepStacks ? n(p.stack, p.startStack) : n(p.startStack, 0);
    const normalizedStack = chipFloor(stackBase, chipUnit);
    const available = !p.sitOut && normalizedStack > 0;

    return {
      ...p,
      stack: normalizedStack,
      totalInvested: 0,
      anteInvested: 0,
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

  const {
    buttonSeatIndex,
    sbPositionSeatIndex,
    bbPositionSeatIndex,
    sbSeatIndex,
    bbSeatIndex,
  } = getBlindAssignments(state.seats, state.dealerSeatIndex, previousForcedBets);

  state.dealerSeatIndex = buttonSeatIndex;

  const sbPaid = sbSeatIndex >= 0 ? pay(state.seats[sbSeatIndex], sb, chipUnit, true) : 0;
  const bbPaid = bbSeatIndex >= 0 ? pay(state.seats[bbSeatIndex], bb, chipUnit, true) : 0;
  const bbAntePaid =
    bbAnte > 0 && bbSeatIndex >= 0 ? pay(state.seats[bbSeatIndex], bbAnte, chipUnit, false) : 0;

  if (bbSeatIndex >= 0 && bbAntePaid > 0) {
    state.seats[bbSeatIndex].anteInvested = bbAntePaid;
  }

  if (sbSeatIndex >= 0) {
    const sbPlayer = state.seats[sbSeatIndex];
    if (sbPlayer && sbPlayer.allIn) {
      sbPlayer.streetActionLabel = "ALL-IN";
    }
  }

  if (bbSeatIndex >= 0) {
    const bbPlayer = state.seats[bbSeatIndex];
    if (bbPlayer && bbPlayer.allIn) {
      bbPlayer.streetActionLabel = "ALL-IN";
    }
  }

  state.forcedBets = {
    buttonSeatIndex,
    sbPositionSeatIndex,
    bbPositionSeatIndex,
    sbSeatIndex,
    bbSeatIndex,
    sbAmount: sbPaid,
    bbAmount: bbPaid,
    anteAmount: bbAntePaid,
  };

  state.currentBet = bbPaid;
  state.minRaise = bb;

  if (sbPositionSeatIndex >= 0) {
    if (sbSeatIndex >= 0 && sbPaid > 0) {
      state.log.push(`${state.seats[sbSeatIndex].name} posts SB ${sbPaid}`);
    } else {
      state.log.push(`Seat ${sbPositionSeatIndex + 1} is dead SB`);
    }
  }

  if (bbPositionSeatIndex >= 0) {
    if (bbSeatIndex >= 0) {
      if (bbSeatIndex === bbPositionSeatIndex) {
        state.log.push(`${state.seats[bbSeatIndex].name} posts BB ${bbPaid}`);
      } else {
        state.log.push(
          `Seat ${bbPositionSeatIndex + 1} is dead BB position, ${state.seats[bbSeatIndex].name} posts BB ${bbPaid}`
        );
      }

      if (bbAntePaid > 0) {
        state.log.push(`${state.seats[bbSeatIndex].name} posts BB Ante ${bbAntePaid}`);
      }
    } else {
      state.log.push(`Seat ${bbPositionSeatIndex + 1} is dead BB`);
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

  state.currentSeatIndex = getFirstToActPreflop(
    state.seats,
    state.dealerSeatIndex,
    state.forcedBets
  );

  return updateDerived(state);
}

export function startNextHand(prevState) {
  const next = clone(prevState);
  const occupiedSeats = occupiedSeatIndices(next.seats);

  if (occupiedSeats.length) {
    next.dealerSeatIndex = getNextOccupiedFromList(occupiedSeats, next.dealerSeatIndex, 1);
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
      buttonSeatIndex: -1,
      sbPositionSeatIndex: -1,
      bbPositionSeatIndex: -1,
      sbSeatIndex: -1,
      bbSeatIndex: -1,
      sbAmount: 0,
      bbAmount: 0,
      anteAmount: 0,
    };
  }

  return (
    state.forcedBets || {
      buttonSeatIndex: -1,
      sbPositionSeatIndex: -1,
      bbPositionSeatIndex: -1,
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
  const chipUnit = getChipUnit(state);

  if (["setup", "showdown", "finished"].includes(state.street)) return state;

  state.history = [...(state.history || []), snapshotForHistory(prevState)];

  const idx = state.currentSeatIndex;
  const player = state.seats[idx];
  if (!player || !canAct(player)) return state;

  const toCall = Math.max(0, state.currentBet - player.streetInvested);
  const amount = chipFloor(n(rawAmount, 0), chipUnit);

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
      const paid = pay(player, toCall, chipUnit, true);
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

      const paid = pay(player, target - player.streetInvested, chipUnit, true);
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

      const paid = pay(player, target - player.streetInvested, chipUnit, true);
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
      const paid = pay(player, player.stack, chipUnit, true);
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
          player.streetActionLabel = `${getAggressiveLabel(
            state.street,
            state.streetBetLevel
          )} ALL-IN`;
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
        player.streetActionLabel = `${getAggressiveLabel(
          state.street,
          state.streetBetLevel
        )} ALL-IN`;
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
  const chipUnit = getChipUnit(state);

  if (state.street !== "showdown") return state;

  state.history = [...(state.history || []), snapshotForHistory(prevState)];
  returnUncalledExcess(state);

  state.confirmedPots.forEach((pot, potIndex) => {
    const selected = Array.isArray(winnersByPot[potIndex]) ? winnersByPot[potIndex] : [];
    const winners = selected.filter((seatIndex) => pot.eligibleSeatIndices.includes(seatIndex));

    if (!winners.length) return;

    const orderedWinners = sortSeatIndicesFromDealerLeft(
      winners,
      state.dealerSeatIndex,
      state.seats.length
    );

    const totalUnits = Math.floor((Number(pot.amount) || 0) / chipUnit);
    const shareUnits = Math.floor(totalUnits / orderedWinners.length);
    const oddUnits = totalUnits % orderedWinners.length;

    orderedWinners.forEach((seatIndex, idx) => {
      const p = state.seats[seatIndex];
      if (!p) return;

      const unitsWon = shareUnits + (idx < oddUnits ? 1 : 0);
      p.stack += unitsWon * chipUnit;
    });

    const distributedAmount = totalUnits * chipUnit;
    const undistributed = (Number(pot.amount) || 0) - distributedAmount;

    const names = orderedWinners
      .map((seatIndex) => state.seats[seatIndex]?.name)
      .filter(Boolean)
      .join(", ");

    state.log.push(`Pot ${potIndex + 1} (${pot.amount}) -> ${names}`);

    if (oddUnits > 0) {
      const oddChipNames = orderedWinners
        .slice(0, oddUnits)
        .map((seatIndex) => state.seats[seatIndex]?.name)
        .filter(Boolean)
        .join(", ");
      state.log.push(
        `Odd chip (${oddUnits * chipUnit}) awarded from dealer-left order: ${oddChipNames}`
      );
    }

    if (undistributed > 0) {
      state.log.push(
        `Warning: ${undistributed} could not be distributed because chip unit is ${chipUnit}`
      );
    }
  });

  finishHandState(state);
  return state;
}

export function addPlayerToSeat(prevState, seatIndex, playerData) {
  const state = clone(prevState);
  const chipUnit = getChipUnit(state);

  if (seatIndex < 0 || seatIndex >= MAX_SEATS) return state;
  if (state.seats[seatIndex]) return state;

  const id = nextPlayerId(state.seats);
  const stack = chipFloor(n(playerData?.stack, 5000), chipUnit);
  const name = playerData?.name?.trim() || `P${id}`;

  state.seats[seatIndex] = makePlayer(id, name, stack, chipUnit);
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

  if (state.forcedBets?.buttonSeatIndex === seatIndex) {
    state.forcedBets.buttonSeatIndex = -1;
  }

  if (state.forcedBets?.sbPositionSeatIndex === seatIndex) {
    state.forcedBets.sbPositionSeatIndex = -1;
  }

  if (state.forcedBets?.bbPositionSeatIndex === seatIndex) {
    state.forcedBets.bbPositionSeatIndex = -1;
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

  if (state.forcedBets?.buttonSeatIndex === seatA) state.forcedBets.buttonSeatIndex = seatB;
  else if (state.forcedBets?.buttonSeatIndex === seatB) state.forcedBets.buttonSeatIndex = seatA;

  if (state.forcedBets?.sbPositionSeatIndex === seatA) state.forcedBets.sbPositionSeatIndex = seatB;
  else if (state.forcedBets?.sbPositionSeatIndex === seatB) state.forcedBets.sbPositionSeatIndex = seatA;

  if (state.forcedBets?.bbPositionSeatIndex === seatA) state.forcedBets.bbPositionSeatIndex = seatB;
  else if (state.forcedBets?.bbPositionSeatIndex === seatB) state.forcedBets.bbPositionSeatIndex = seatA;

  if (state.forcedBets?.sbSeatIndex === seatA) state.forcedBets.sbSeatIndex = seatB;
  else if (state.forcedBets?.sbSeatIndex === seatB) state.forcedBets.sbSeatIndex = seatA;

  if (state.forcedBets?.bbSeatIndex === seatA) state.forcedBets.bbSeatIndex = seatB;
  else if (state.forcedBets?.bbSeatIndex === seatB) state.forcedBets.bbSeatIndex = seatA;

  if (state.lastHandForcedBets?.buttonSeatIndex === seatA) state.lastHandForcedBets.buttonSeatIndex = seatB;
  else if (state.lastHandForcedBets?.buttonSeatIndex === seatB) state.lastHandForcedBets.buttonSeatIndex = seatA;

  if (state.lastHandForcedBets?.sbPositionSeatIndex === seatA) state.lastHandForcedBets.sbPositionSeatIndex = seatB;
  else if (state.lastHandForcedBets?.sbPositionSeatIndex === seatB) state.lastHandForcedBets.sbPositionSeatIndex = seatA;

  if (state.lastHandForcedBets?.bbPositionSeatIndex === seatA) state.lastHandForcedBets.bbPositionSeatIndex = seatB;
  else if (state.lastHandForcedBets?.bbPositionSeatIndex === seatB) state.lastHandForcedBets.bbPositionSeatIndex = seatA;

  if (state.lastHandForcedBets?.sbSeatIndex === seatA) state.lastHandForcedBets.sbSeatIndex = seatB;
  else if (state.lastHandForcedBets?.sbSeatIndex === seatB) state.lastHandForcedBets.sbSeatIndex = seatA;

  if (state.lastHandForcedBets?.bbSeatIndex === seatA) state.lastHandForcedBets.bbSeatIndex = seatB;
  else if (state.lastHandForcedBets?.bbSeatIndex === seatB) state.lastHandForcedBets.bbSeatIndex = seatA;

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