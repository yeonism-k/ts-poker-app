import { useEffect, useMemo, useState } from "react";
import {
  MAX_SEATS,
  addPlayerToSeat,
  applyAction,
  createInitialSetup,
  getCallAmount,
  getMinRaiseTo,
  removePlayerFromSeat,
  settleShowdown,
  startHand,
  startNextHand,
  streetLabel,
  toggleSitOut,
  undoAction,
} from "./engine/pokerEngine";

function PlainNumberInput({ value, onChange, min = 0, step = 1 }) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function normalizeBlindLevelsForApp(levels) {
  const source = Array.isArray(levels) && levels.length
    ? levels
    : [{ level: 1, smallBlind: 50, bigBlind: 100, ante: 100 }];

  return source.map((item, idx) => ({
    level: idx + 1,
    smallBlind: Number.isFinite(Number(item?.smallBlind)) ? Number(item.smallBlind) : 0,
    bigBlind: Number.isFinite(Number(item?.bigBlind)) ? Number(item.bigBlind) : 0,
    ante: Number.isFinite(Number(item?.ante)) ? Number(item.ante) : 0,
  }));
}

function clampLevelIndex(levels, index) {
  const normalized = normalizeBlindLevelsForApp(levels);
  if (!normalized.length) return 0;
  return Math.max(0, Math.min(Number(index) || 0, normalized.length - 1));
}

function levelSummary(level) {
  if (!level) return "-";
  return `${level.smallBlind} / ${level.bigBlind} / ${level.ante}`;
}

function getDisplayPotItems(state) {
  const confirmedPots = state.confirmedPots || [];
  const totalCommitted = state.totalCommitted || 0;

  const hasConfirmedSidePot = confirmedPots.length > 1;
  const shouldSplitDisplay = state.street === "showdown" && hasConfirmedSidePot;

  if (!shouldSplitDisplay) {
    return [
      {
        label: "POT",
        amount: totalCommitted,
        kind: "main",
      },
    ];
  }

  return confirmedPots.map((pot, idx) => ({
    label: idx === 0 ? "MAIN POT" : `SIDE POT ${idx}`,
    amount: pot.amount,
    kind: idx === 0 ? "main" : "side",
  }));
}

function getSeatsInCurrentHand(state) {
  return state.seats
    .map((player, seatIndex) => ({ player, seatIndex }))
    .filter(({ player }) => player && player.inHand && !player.sitOut)
    .map(({ seatIndex }) => seatIndex);
}

function getPositionOrder(playerCount) {
  switch (playerCount) {
    case 2:
      return ["BB"];
    case 3:
      return ["SB", "BB"];
    case 4:
      return ["SB", "BB", "CO"];
    case 5:
      return ["SB", "BB", "HJ", "CO"];
    case 6:
      return ["SB", "BB", "UTG", "HJ", "CO"];
    case 7:
      return ["SB", "BB", "UTG", "+1", "HJ", "CO"];
    case 8:
      return ["SB", "BB", "UTG", "+1", "+2", "HJ", "CO"];
    case 9:
      return ["SB", "BB", "UTG", "+1", "+2", "LJ", "HJ", "CO"];
    case 10:
      return ["SB", "BB", "UTG", "+1", "+2", "+3", "LJ", "HJ", "CO"];
    default:
      return [];
  }
}

function getPositionLabels(state) {
  if (state.street === "setup") return {};

  const handSeats = getSeatsInCurrentHand(state);
  const count = handSeats.length;
  if (count < 2) return {};

  const labels = {};
  const handSeatSet = new Set(handSeats);

  const dealerSeat = handSeatSet.has(state.dealerSeatIndex)
    ? state.dealerSeatIndex
    : handSeats[0];

  if (count === 2) {
    let otherSeat = -1;

    for (let i = 1; i <= MAX_SEATS; i++) {
      const idx = (dealerSeat + i) % MAX_SEATS;
      if (handSeatSet.has(idx)) {
        otherSeat = idx;
        break;
      }
    }

    labels[dealerSeat] = "D/SB";

    if (otherSeat >= 0) {
      labels[otherSeat] = "BB";
    }

    return labels;
  }

  labels[dealerSeat] = "BTN";

  const orderAfterDealer = [];
  for (let i = 1; i <= MAX_SEATS; i++) {
    const idx = (dealerSeat + i) % MAX_SEATS;
    if (handSeatSet.has(idx)) {
      orderAfterDealer.push(idx);
    }
  }

  const positionOrder = getPositionOrder(count);

  orderAfterDealer.forEach((seatIndex, idx) => {
    const label = positionOrder[idx];
    if (label) labels[seatIndex] = label;
  });

  return labels;
}

function BlindLevelsEditor({
  state,
  onSelectStartLevel,
  onUpdateBlindLevel,
  onAddBlindLevel,
  onRemoveBlindLevel,
}) {
  return (
    <div className="blind-levels-panel">
      <div className="blind-levels-head">
        <h3>블라인드 레벨 설정</h3>
        <button type="button" onClick={onAddBlindLevel}>
          레벨 추가
        </button>
      </div>

      <div className="blind-levels-list">
        {state.blindLevels.map((level, idx) => {
          const isSelected = idx === state.currentBlindLevelIndex;
          return (
            <div
              key={idx}
              className={[
                "blind-level-row",
                isSelected ? "blind-level-row-selected" : "",
              ].join(" ")}
            >
              <div className="blind-level-row-top">
                <div className="blind-level-badge">Lv {idx + 1}</div>
                <div className="blind-level-row-actions">
                  <button
                    type="button"
                    className={isSelected ? "primary" : ""}
                    onClick={() => onSelectStartLevel(idx)}
                  >
                    {isSelected ? "시작 레벨" : "이 레벨로 시작"}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    disabled={state.blindLevels.length <= 1}
                    onClick={() => onRemoveBlindLevel(idx)}
                  >
                    삭제
                  </button>
                </div>
              </div>

              <div className="blind-level-grid">
                <label>
                  SB
                  <PlainNumberInput
                    value={level.smallBlind}
                    min={0}
                    step={50}
                    onChange={(v) => onUpdateBlindLevel(idx, "smallBlind", v)}
                  />
                </label>

                <label>
                  BB
                  <PlainNumberInput
                    value={level.bigBlind}
                    min={0}
                    step={100}
                    onChange={(v) => onUpdateBlindLevel(idx, "bigBlind", v)}
                  />
                </label>

                <label>
                  Ante
                  <PlainNumberInput
                    value={level.ante}
                    min={0}
                    step={100}
                    onChange={(v) => onUpdateBlindLevel(idx, "ante", v)}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SetupPanel({
  state,
  onChangeState,
  onStart,
  onSelectStartLevel,
  onUpdateBlindLevel,
  onAddBlindLevel,
  onRemoveBlindLevel,
}) {
  const updateSeatPlayer = (seatIndex, key, value) => {
    onChangeState({
      ...state,
      seats: state.seats.map((p, idx) => {
        if (idx !== seatIndex || !p) return p;
        const next = { ...p, [key]: value };
        if (key === "startStack") next.stack = value;
        return next;
      }),
    });
  };

  const addSeatPlayer = (seatIndex) => {
    if (state.seats[seatIndex]) return;

    const existingIds = state.seats.filter(Boolean).map((p) => p.id);
    const nextId = existingIds.length ? Math.max(...existingIds) + 1 : 1;

    onChangeState({
      ...state,
      seats: state.seats.map((p, idx) =>
        idx === seatIndex
          ? {
              id: nextId,
              name: `P${nextId}`,
              startStack: 5000,
              stack: 5000,
              totalInvested: 0,
              streetInvested: 0,
              folded: false,
              allIn: false,
              acted: false,
              sitOut: false,
              inHand: false,
              streetActionLabel: "",
            }
          : p
      ),
    });
  };

  const removeSeatPlayer = (seatIndex) => {
    onChangeState({
      ...state,
      seats: state.seats.map((p, idx) => (idx === seatIndex ? null : p)),
      dealerSeatIndex: state.dealerSeatIndex === seatIndex ? 0 : state.dealerSeatIndex,
    });
  };

  const toggleSetupSitOut = (seatIndex) => {
    onChangeState({
      ...state,
      seats: state.seats.map((p, idx) =>
        idx === seatIndex && p ? { ...p, sitOut: !p.sitOut } : p
      ),
    });
  };

  const currentLevel = state.blindLevels?.[state.currentBlindLevelIndex];

  return (
    <div className="panel">
      <h2>게임 설정</h2>

      <div className="setup-grid">
        <label>
          시작 레벨
          <select
            value={state.currentBlindLevelIndex}
            onChange={(e) => onSelectStartLevel(Number(e.target.value))}
          >
            {state.blindLevels.map((level, idx) => (
              <option key={idx} value={idx}>
                Lv {idx + 1} · {levelSummary(level)}
              </option>
            ))}
          </select>
        </label>

        <label>
          현재 블라인드
          <input value={levelSummary(currentLevel)} readOnly />
        </label>

        <label>
          Dealer Seat
          <select
            value={state.dealerSeatIndex}
            onChange={(e) => onChangeState({ ...state, dealerSeatIndex: Number(e.target.value) })}
          >
            {Array.from({ length: MAX_SEATS }).map((_, idx) => (
              <option key={idx} value={idx}>
                {idx + 1}번 좌석 {state.seats[idx] ? `(${state.seats[idx].name})` : "(빈 자리)"}
              </option>
            ))}
          </select>
        </label>
      </div>

      <BlindLevelsEditor
        state={state}
        onSelectStartLevel={onSelectStartLevel}
        onUpdateBlindLevel={onUpdateBlindLevel}
        onAddBlindLevel={onAddBlindLevel}
        onRemoveBlindLevel={onRemoveBlindLevel}
      />

      <div className="players-block">
        <div className="players-head">
          <h3>고정 좌석 1~10</h3>
        </div>

        <div className="muted">
          빈 자리는 유지됩니다. 원하는 좌석에 플레이어를 직접 앉힐 수 있습니다.
        </div>

        {state.seats.map((player, seatIndex) => (
          <div className="player-row player-row-seat" key={seatIndex}>
            <div className="seat-badge">{seatIndex + 1}</div>

            {player ? (
              <>
                <input
                  type="text"
                  value={player.name}
                  onChange={(e) => updateSeatPlayer(seatIndex, "name", e.target.value)}
                />
                <PlainNumberInput
                  value={player.startStack}
                  onChange={(v) => updateSeatPlayer(seatIndex, "startStack", v)}
                  min={0}
                  step={100}
                />
                <button onClick={() => toggleSetupSitOut(seatIndex)}>
                  {player.sitOut ? "복귀" : "Sit out"}
                </button>
                <button className="danger" onClick={() => removeSeatPlayer(seatIndex)}>
                  자리 비우기
                </button>
              </>
            ) : (
              <>
                <div className="empty-seat-label">빈 자리</div>
                <div></div>
                <button onClick={() => addSeatPlayer(seatIndex)}>앉히기</button>
                <div></div>
              </>
            )}
          </div>
        ))}
      </div>

      <button className="primary big-btn" onClick={onStart}>
        첫 핸드 시작
      </button>
    </div>
  );
}

function BlindEditor({ state, onUpdateDealer, onChangeBlindLevel }) {
  const [open, setOpen] = useState(false);

  const currentLevel = state.blindLevels?.[state.currentBlindLevelIndex];
  const pendingLevel = state.blindLevels?.[state.pendingBlindLevelIndex];
  const canLevelDown = state.pendingBlindLevelIndex > 0;
  const canLevelUp = state.pendingBlindLevelIndex < (state.blindLevels?.length || 1) - 1;
  const pendingChanged = state.pendingBlindLevelIndex !== state.currentBlindLevelIndex;

  return (
    <div className="panel blind-editor-panel blind-editor-inline">
      <button
        type="button"
        className="blind-editor-toggle"
        onClick={() => setOpen((prev) => !prev)}
      >
        <div className="blind-editor-toggle-left">
          <div className="blind-editor-title">블라인드</div>
          <div className="blind-editor-summary">
            Lv {state.currentBlindLevelIndex + 1} · {levelSummary(currentLevel)}
          </div>
          {pendingChanged ? (
            <div className="blind-editor-pending">
              다음 핸드 예약: Lv {state.pendingBlindLevelIndex + 1} · {levelSummary(pendingLevel)}
            </div>
          ) : null}
        </div>

        <span className={["blind-editor-chevron", open ? "open" : ""].join(" ")}>
          ▾
        </span>
      </button>

      {open && (
        <div className="blind-editor-body blind-editor-body-compact">
          <div className="blind-level-live-panel">
            <div className="blind-level-live-top">
              <div className="blind-level-live-title">
                현재 레벨: Lv {state.currentBlindLevelIndex + 1}
              </div>
              <div className="blind-level-live-value">{levelSummary(currentLevel)}</div>
            </div>

            <div className="blind-level-live-actions">
              <button type="button" disabled={!canLevelDown} onClick={() => onChangeBlindLevel(-1)}>
                Level -
              </button>
              <button type="button" disabled={!canLevelUp} onClick={() => onChangeBlindLevel(1)}>
                Level +
              </button>
            </div>

            <label>
              Dealer
              <select
                value={state.dealerSeatIndex}
                onChange={(e) => onUpdateDealer(Number(e.target.value))}
              >
                {Array.from({ length: MAX_SEATS }).map((_, idx) => (
                  <option key={idx} value={idx}>
                    Seat {idx + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

function ShowdownPanel({ state, onSettle }) {
  const [winnersByPot, setWinnersByPot] = useState({});

  useEffect(() => {
    const init = {};
    (state.confirmedPots || []).forEach((_, idx) => {
      init[idx] = [];
    });
    setWinnersByPot(init);
  }, [state.confirmedPots]);

  const toggleWinner = (potIndex, seatIndex) => {
    setWinnersByPot((prev) => {
      const exists = prev[potIndex]?.includes(seatIndex);

      return {
        ...prev,
        [potIndex]: exists
          ? prev[potIndex].filter((id) => id !== seatIndex)
          : [...(prev[potIndex] || []), seatIndex],
      };
    });
  };

  return (
    <div className="panel">
      <h2>쇼다운 분배</h2>
      {state.confirmedPots.length === 0 && <div className="muted">분배할 팟이 없습니다.</div>}

      {state.confirmedPots.map((pot, idx) => (
        <div className="showdown-pot" key={idx}>
          <div className="showdown-title">
            {idx === 0 ? "Pot" : `Side Pot ${idx}`} - {pot.amount}
          </div>

          <div className="winner-list">
            {pot.eligibleSeatIndices.map((seatIndex) => {
              const player = state.seats[seatIndex];
              const checked = winnersByPot[idx]?.includes(seatIndex);

              return (
                <label key={seatIndex} className="winner-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleWinner(idx, seatIndex)}
                  />
                  {seatIndex + 1}. {player?.name}
                </label>
              );
            })}
          </div>
        </div>
      ))}

      <button className="primary big-btn" onClick={() => onSettle(winnersByPot)}>
        선택한 승자로 분배
      </button>
    </div>
  );
}

function getSeatLayoutClass(seatIndex) {
  return `table-seat-pos-${seatIndex + 1}`;
}

function SeatHudCard({ player, seatIndex, isCurrent, positionLabel = "" }) {
  if (!player) {
    return (
      <div className="table-seat-hud table-seat-hud-empty">
        <div className="table-seat-empty-number">{seatIndex + 1}</div>
        <div className="table-seat-empty-text">EMPTY</div>
      </div>
    );
  }

  const actionLabel = player.streetActionLabel || "";
  const currentBetAmount = player.streetInvested || 0;

  const showActionBanner =
    actionLabel === "CHECK" ||
    actionLabel === "CALL" ||
    actionLabel === "BET" ||
    actionLabel === "RAISE" ||
    actionLabel === "ALL-IN" ||
    actionLabel.includes("BET") ||
    actionLabel.includes("ALL-IN");

  return (
    <div
      className={[
        "table-seat-hud",
        isCurrent ? "table-seat-hud-current" : "",
        player.folded ? "table-seat-hud-folded" : "",
        player.sitOut ? "table-seat-hud-sitout" : "",
        !player.inHand && !player.sitOut ? "table-seat-hud-waiting" : "",
      ].join(" ")}
    >
      <div className="table-seat-hud-top">
        <div className="table-seat-id">{seatIndex + 1}</div>

        <div className="table-seat-main">
          <div className="table-seat-name-row">
            <div className="table-seat-name-group">
              <div className="table-seat-name">{player.name}</div>
              {positionLabel ? (
                <span
                  className={
                    positionLabel === "BTN" || positionLabel === "D/SB"
                      ? "table-position-chip table-position-btn"
                      : "table-position-chip"
                  }
                >
                  {positionLabel}
                </span>
              ) : null}
            </div>

            <div className="table-seat-stack">{player.stack}</div>
          </div>

          <div className="table-seat-subline">
            {player.sitOut
              ? "SIT OUT"
              : player.folded
              ? "FOLDED"
              : player.inHand
              ? "IN HAND"
              : "NEXT HAND"}
          </div>
        </div>
      </div>

      <div className="table-seat-action-line">
        {showActionBanner ? (
          <>
            <span
              className={[
                "table-seat-action-text",
                actionLabel.includes("ALL-IN")
                  ? "table-seat-action-allin"
                  : actionLabel === "CHECK" || actionLabel === "CALL"
                  ? "table-seat-action-passive"
                  : "table-seat-action-aggressive",
              ].join(" ")}
            >
              {actionLabel}
            </span>
            {actionLabel !== "CHECK" && currentBetAmount > 0 && (
              <span className="table-seat-action-value">{currentBetAmount}</span>
            )}
          </>
        ) : isCurrent ? (
          <span className="table-seat-to-act">TO ACT</span>
        ) : (
          <span className="table-seat-action-placeholder"> </span>
        )}
      </div>
    </div>
  );
}

function OvalTableLayout({ state, positionLabels, selectedSeatIndex, onSelectSeat }) {
  const potItems = getDisplayPotItems(state);
  const currentStreet = streetLabel(state.street).toUpperCase();
  const blindText = `${state.smallBlind || 0} / ${state.bigBlind || 0} / ${state.ante || 0}`;

  return (
    <div className="table-stage">
      <div className="poker-table-shell">
        <div className="poker-table-oval">
          <div className="table-center-hud">
            <div className="table-center-street">{currentStreet}</div>

            <div className="table-center-pots">
              {potItems.map((item, idx) => (
                <div
                  key={idx}
                  className={[
                    "table-center-pot-pill",
                    item.kind === "side" ? "table-center-pot-pill-side" : "",
                  ].join(" ")}
                >
                  <span className="table-center-pot-label">{item.label}</span>
                  <span className="table-center-pot-value">{item.amount}</span>
                </div>
              ))}
            </div>

            <div className="table-center-blinds">{blindText}</div>
          </div>

          {Array.from({ length: MAX_SEATS }).map((_, seatIndex) => (
            <button
              key={seatIndex}
              type="button"
              className={[
                "table-seat-wrap",
                getSeatLayoutClass(seatIndex),
                selectedSeatIndex === seatIndex ? "table-seat-wrap-selected" : "",
              ].join(" ")}
              onClick={() => onSelectSeat(seatIndex)}
            >
              <SeatHudCard
                player={state.seats[seatIndex]}
                seatIndex={seatIndex}
                isCurrent={state.currentSeatIndex === seatIndex}
                positionLabel={positionLabels[seatIndex] || ""}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CurrentPlayerActionPanel({ state, onPlayerAction }) {
  const currentPlayer =
    state.currentSeatIndex >= 0 ? state.seats[state.currentSeatIndex] : null;

  const [amount, setAmount] = useState(0);

  const isActionStreet = ["preflop", "flop", "turn", "river"].includes(state.street);
  const canDoAction =
    isActionStreet &&
    currentPlayer &&
    currentPlayer.inHand &&
    !currentPlayer.folded &&
    !currentPlayer.allIn &&
    !currentPlayer.sitOut;

  const callAmount = currentPlayer ? getCallAmount(state, state.currentSeatIndex) : 0;
  const minRaiseTo = currentPlayer ? getMinRaiseTo(state, state.currentSeatIndex) : state.bigBlind;
  const maxTotal = currentPlayer
    ? (currentPlayer.streetInvested || 0) + (currentPlayer.stack || 0)
    : 0;

  useEffect(() => {
    if (!currentPlayer) return;
    setAmount(state.currentBet === 0 ? state.bigBlind : minRaiseTo);
  }, [state.currentSeatIndex, state.currentBet, state.bigBlind, minRaiseTo, currentPlayer]);

  const applyAmount = (next) => {
    const safe = Math.max(0, Number.isFinite(next) ? next : 0);
    setAmount(safe);
  };

  if (!canDoAction) {
    return (
      <div className="panel action-panel-compact action-panel-empty">
        <div className="action-panel-compact-head">
          <div className="action-panel-compact-title">현재 액션</div>
          <div className="muted">진행 중인 액션이 없습니다.</div>
        </div>
      </div>
    );
  }

  const canCheck = callAmount === 0;
  const canCall = callAmount > 0;

  const canBet =
    state.currentBet === 0 &&
    amount > 0 &&
    (amount >= state.bigBlind || amount >= maxTotal);

  const canRaise =
    state.currentBet > 0 &&
    amount > state.currentBet &&
    (amount >= minRaiseTo || amount >= maxTotal);

  const canAllIn = currentPlayer.stack > 0;

  return (
    <div className="panel action-panel-compact">
      <div className="action-panel-compact-top">
        <div className="action-panel-compact-head">
          <div className="action-panel-compact-title">현재 액션</div>
          <div className="action-panel-compact-player">
            Seat {state.currentSeatIndex + 1} · {currentPlayer.name}
          </div>
        </div>

        <div className="action-panel-compact-meta">
          <span>Call {callAmount}</span>
          <span>Min {minRaiseTo}</span>
          <span>Stack {currentPlayer.stack}</span>
        </div>
      </div>

      <div className="action-panel-compact-bottom">
        <label className="action-panel-compact-amount">
          <span>Amount</span>

          <div className="amount-control">
            <div className="amount-control-main">
              <button type="button" onClick={() => applyAmount(amount - 100)}>
                -100
              </button>

              <input
                type="number"
                min="0"
                step="100"
                value={amount}
                onChange={(e) => applyAmount(Number(e.target.value))}
              />

              <button type="button" onClick={() => applyAmount(amount + 100)}>
                +100
              </button>
            </div>

            <div className="amount-quick-buttons">
              <button type="button" onClick={() => applyAmount(amount + 1000)}>
                +1000
              </button>
              <button type="button" onClick={() => applyAmount(amount + 5000)}>
                +5000
              </button>
            </div>
          </div>
        </label>

        <div className="action-panel-compact-buttons">
          <button onClick={() => onPlayerAction("fold")}>Fold</button>
          <button disabled={!canCheck} onClick={() => onPlayerAction("check")}>
            Check
          </button>
          <button disabled={!canCall} onClick={() => onPlayerAction("call")}>
            Call
          </button>
          <button disabled={!canBet} onClick={() => onPlayerAction("bet", amount)}>
            Bet
          </button>
          <button disabled={!canRaise} onClick={() => onPlayerAction("raise", amount)}>
            Raise
          </button>
          <button className="danger" disabled={!canAllIn} onClick={() => onPlayerAction("allin")}>
            All-in
          </button>
        </div>
      </div>
    </div>
  );
}

function SeatDetailPanel({
  state,
  selectedSeatIndex,
  onSelectSeat,
  onDirectStateChange,
  onAddPlayerToSeat,
  onToggleSitOut,
  onLeaveSeat,
}) {
  const player = selectedSeatIndex >= 0 ? state.seats[selectedSeatIndex] : null;

  const [newName, setNewName] = useState("");
  const [newStack, setNewStack] = useState(5000);

  useEffect(() => {
    if (player) {
      setNewName(player.name || "");
      setNewStack(player.stack || player.startStack || 5000);
    } else {
      setNewName("");
      setNewStack(5000);
    }
  }, [selectedSeatIndex, player]);

  const handleRename = () => {
    if (!player) return;
    const trimmed = newName.trim();
    if (!trimmed) return;

    onDirectStateChange((prev) => ({
      ...prev,
      seats: prev.seats.map((p, idx) =>
        idx === selectedSeatIndex && p ? { ...p, name: trimmed } : p
      ),
    }));
  };

  const handleStackApply = () => {
    const safeStack = Math.max(0, Number.isFinite(newStack) ? newStack : 0);

    onDirectStateChange((prev) => ({
      ...prev,
      seats: prev.seats.map((p, idx) => {
        if (idx !== selectedSeatIndex || !p) return p;

        const next = { ...p, stack: safeStack };

        if (prev.street === "setup") {
          next.startStack = safeStack;
        }

        if (prev.street !== "setup" && safeStack > 0 && p.allIn) {
          next.allIn = false;
        }

        if (prev.street !== "setup" && safeStack === 0 && !p.folded && p.inHand) {
          next.allIn = true;
        }

        return next;
      }),
    }));
  };

  const handleAdd = () => {
    onAddPlayerToSeat(selectedSeatIndex, {
      name: newName.trim() || "",
      stack: newStack,
    });
  };

  return (
    <div className="panel seat-detail-panel">
      <div className="seat-detail-head">
        <div>
          <h2>좌석 상세 관리</h2>
          <div className="muted">
            {selectedSeatIndex >= 0 ? `Seat ${selectedSeatIndex + 1}` : "좌석 선택"}
          </div>
        </div>

        {selectedSeatIndex >= 0 && <button onClick={() => onSelectSeat(-1)}>닫기</button>}
      </div>

      {selectedSeatIndex < 0 ? (
        <div className="muted">테이블에서 좌석을 클릭하면 상세 관리가 표시됩니다.</div>
      ) : player ? (
        <div className="seat-detail-body">
          <div className="seat-detail-status">
            <div className="seat-detail-status-row">
              <span className="seat-detail-k">이름</span>
              <span className="seat-detail-v">{player.name}</span>
            </div>
            <div className="seat-detail-status-row">
              <span className="seat-detail-k">현재 스택</span>
              <span className="seat-detail-v">{player.stack}</span>
            </div>
            <div className="seat-detail-status-row">
              <span className="seat-detail-k">상태</span>
              <span className="seat-detail-v">
                {player.sitOut
                  ? "Sit out"
                  : player.folded
                  ? "Folded"
                  : player.inHand
                  ? "In hand"
                  : "Waiting"}
              </span>
            </div>
          </div>

          <div className="seat-detail-form">
            <label>
              이름 수정
              <input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>

            <button onClick={handleRename}>이름 적용</button>
          </div>

          <div className="seat-detail-form">
            <label>
              스택 수정
              <input
                type="number"
                min="0"
                step="1"
                value={newStack}
                onChange={(e) => setNewStack(Number(e.target.value))}
              />
            </label>

            <button onClick={handleStackApply}>스택 적용</button>
          </div>

          <div className="seat-detail-actions">
            <button onClick={() => onToggleSitOut(selectedSeatIndex)}>
              {player.sitOut ? "복귀" : "Sit out"}
            </button>
            <button className="danger" onClick={() => onLeaveSeat(selectedSeatIndex)}>
              자리 비우기
            </button>
          </div>
        </div>
      ) : (
        <div className="seat-detail-body">
          <div className="muted">빈 자리입니다. 새 플레이어를 앉힐 수 있습니다.</div>

          <div className="seat-detail-form">
            <label>
              플레이어 이름
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="예: P9"
              />
            </label>
          </div>

          <div className="seat-detail-form">
            <label>
              시작 스택
              <input
                type="number"
                min="0"
                step="100"
                value={newStack}
                onChange={(e) => setNewStack(Number(e.target.value))}
              />
            </label>
          </div>

          <div className="seat-detail-actions">
            <button className="primary" onClick={handleAdd}>
              이 자리에 앉히기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState(createInitialSetup());
  const [selectedSeatIndex, setSelectedSeatIndex] = useState(-1);

  const positionLabels = useMemo(() => getPositionLabels(state), [state]);

  const handleStart = () => setState((prev) => startHand(prev, false));
  const handleNextHand = () => setState((prev) => startNextHand(prev));
  const handleAction = (action, amount = 0) =>
    setState((prev) => applyAction(prev, action, amount));
  const handleSettle = (winnersByPot) =>
    setState((prev) => settleShowdown(prev, winnersByPot));
  const handleUndo = () => setState((prev) => undoAction(prev));

  const handleSelectStartLevel = (targetIndex) => {
    setState((prev) => {
      const blindLevels = normalizeBlindLevelsForApp(prev.blindLevels);
      const nextIndex = clampLevelIndex(blindLevels, targetIndex);
      const level = blindLevels[nextIndex];

      return {
        ...prev,
        blindLevels,
        currentBlindLevelIndex: nextIndex,
        pendingBlindLevelIndex: nextIndex,
        smallBlind: level.smallBlind,
        bigBlind: level.bigBlind,
        ante: level.ante,
      };
    });
  };

  const handleUpdateBlindLevel = (levelIndex, key, rawValue) => {
    setState((prev) => {
      const blindLevels = normalizeBlindLevelsForApp(prev.blindLevels).map((level, idx) =>
        idx === levelIndex
          ? {
              ...level,
              [key]: Math.max(0, Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0),
            }
          : level
      );

      const currentBlindLevelIndex = clampLevelIndex(blindLevels, prev.currentBlindLevelIndex);
      const pendingBlindLevelIndex = clampLevelIndex(blindLevels, prev.pendingBlindLevelIndex);
      const currentLevel = blindLevels[currentBlindLevelIndex];

      return {
        ...prev,
        blindLevels,
        currentBlindLevelIndex,
        pendingBlindLevelIndex,
        smallBlind: currentLevel.smallBlind,
        bigBlind: currentLevel.bigBlind,
        ante: currentLevel.ante,
      };
    });
  };

  const handleAddBlindLevel = () => {
    setState((prev) => {
      const blindLevels = normalizeBlindLevelsForApp(prev.blindLevels);
      const last = blindLevels[blindLevels.length - 1] || {
        smallBlind: 50,
        bigBlind: 100,
        ante: 100,
      };

      const nextLevel = {
        level: blindLevels.length + 1,
        smallBlind: last.smallBlind > 0 ? last.smallBlind * 2 : 50,
        bigBlind: last.bigBlind > 0 ? last.bigBlind * 2 : 100,
        ante: last.ante > 0 ? last.ante * 2 : 100,
      };

      return {
        ...prev,
        blindLevels: [...blindLevels, nextLevel],
      };
    });
  };

  const handleRemoveBlindLevel = (levelIndex) => {
    setState((prev) => {
      const currentLevels = normalizeBlindLevelsForApp(prev.blindLevels);
      if (currentLevels.length <= 1) return prev;

      const blindLevels = currentLevels
        .filter((_, idx) => idx !== levelIndex)
        .map((level, idx) => ({ ...level, level: idx + 1 }));

      const currentBlindLevelIndex = clampLevelIndex(
        blindLevels,
        prev.currentBlindLevelIndex > levelIndex
          ? prev.currentBlindLevelIndex - 1
          : prev.currentBlindLevelIndex
      );

      const pendingBlindLevelIndex = clampLevelIndex(
        blindLevels,
        prev.pendingBlindLevelIndex > levelIndex
          ? prev.pendingBlindLevelIndex - 1
          : prev.pendingBlindLevelIndex
      );

      const currentLevel = blindLevels[currentBlindLevelIndex];

      return {
        ...prev,
        blindLevels,
        currentBlindLevelIndex,
        pendingBlindLevelIndex,
        smallBlind: currentLevel.smallBlind,
        bigBlind: currentLevel.bigBlind,
        ante: currentLevel.ante,
      };
    });
  };

  const handleUpdateDealer = (dealerSeatIndex) =>
    setState((prev) => ({ ...prev, dealerSeatIndex }));

  const handleChangeBlindLevel = (delta) => {
    setState((prev) => {
      const blindLevels = normalizeBlindLevelsForApp(prev.blindLevels);
      const baseIndex =
        prev.street === "finished"
          ? prev.currentBlindLevelIndex
          : prev.pendingBlindLevelIndex ?? prev.currentBlindLevelIndex;

      const nextIndex = clampLevelIndex(blindLevels, baseIndex + delta);
      const nextLevel = blindLevels[nextIndex];

      if (prev.street === "finished") {
        return {
          ...prev,
          blindLevels,
          currentBlindLevelIndex: nextIndex,
          pendingBlindLevelIndex: nextIndex,
          smallBlind: nextLevel.smallBlind,
          bigBlind: nextLevel.bigBlind,
          ante: nextLevel.ante,
        };
      }

      return {
        ...prev,
        blindLevels,
        pendingBlindLevelIndex: nextIndex,
      };
    });
  };

  const handleAddPlayerToSeat = (seatIndex, player) =>
    setState((prev) => addPlayerToSeat(prev, seatIndex, player));

  const handleToggleSitOut = (seatIndex) => setState((prev) => toggleSitOut(prev, seatIndex));
  const handleLeaveSeat = (seatIndex) => setState((prev) => removePlayerFromSeat(prev, seatIndex));

  const resetAll = () => {
    setState(createInitialSetup());
    setSelectedSeatIndex(-1);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <h1>TS POKER APP</h1>
        </div>

        <div className="topbar-right">
          {state.street !== "setup" && (
            <button onClick={handleUndo} disabled={!state.history?.length}>
              Undo
            </button>
          )}

          {state.street === "finished" && (
            <button className="primary" onClick={handleNextHand}>
              다음 핸드 시작
            </button>
          )}

          <button className="danger" onClick={resetAll}>
            전체 리셋
          </button>
        </div>
      </header>

      {state.street === "setup" ? (
        <SetupPanel
          state={state}
          onChangeState={setState}
          onStart={handleStart}
          onSelectStartLevel={handleSelectStartLevel}
          onUpdateBlindLevel={handleUpdateBlindLevel}
          onAddBlindLevel={handleAddBlindLevel}
          onRemoveBlindLevel={handleRemoveBlindLevel}
        />
      ) : (
        <>
          <div className="table-and-side-grid">
            <div className="table-main-col">
              <OvalTableLayout
                state={state}
                positionLabels={positionLabels}
                selectedSeatIndex={selectedSeatIndex}
                onSelectSeat={setSelectedSeatIndex}
              />

              <div className="bottom-control-row">
                <CurrentPlayerActionPanel state={state} onPlayerAction={handleAction} />
                <BlindEditor
                  state={state}
                  onUpdateDealer={handleUpdateDealer}
                  onChangeBlindLevel={handleChangeBlindLevel}
                />
              </div>
            </div>

            <div className="table-side-col">
              <SeatDetailPanel
                state={state}
                selectedSeatIndex={selectedSeatIndex}
                onSelectSeat={setSelectedSeatIndex}
                onDirectStateChange={setState}
                onAddPlayerToSeat={handleAddPlayerToSeat}
                onToggleSitOut={handleToggleSitOut}
                onLeaveSeat={handleLeaveSeat}
              />
            </div>
          </div>

          {state.street === "showdown" && (
            <div className="showdown-floating">
              <ShowdownPanel state={state} onSettle={handleSettle} />
            </div>
          )}

          {state.street === "finished" && (
            <div className="showdown-floating">
              <div className="panel">
                <h2>핸드 종료</h2>
                <div className="muted">다음 핸드를 시작할 수 있습니다.</div>
                <button className="primary" onClick={handleNextHand}>
                  다음 핸드 시작
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}