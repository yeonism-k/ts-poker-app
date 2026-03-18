import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CHIP_UNIT,
  MAX_SEATS,
  addPlayerToSeat,
  applyAction,
  createInitialSetup,
  getCallAmount,
  getMinRaiseTo,
  removePlayerFromSeat,
  runChipRace,
  settleShowdown,
  startHand,
  startNextHand,
  streetLabel,
  toggleSitOut,
  undoAction,
} from "./engine/pokerEngine";

function PlainNumberInput({ value, onChange, min = 0, step = DEFAULT_CHIP_UNIT }) {
  const [draft, setDraft] = useState(String(value ?? ""));

  useEffect(() => {
    setDraft(String(value ?? ""));
  }, [value]);

  const commitValue = () => {
    if (draft === "") {
      setDraft(String(value ?? ""));
      return;
    }

    const num = Number(draft);

    if (!Number.isFinite(num) || num < min || num % step !== 0) {
      setDraft(String(value ?? ""));
      return;
    }

    onChange(num);
    setDraft(String(num));
  };

  return (
    <input
      type="number"
      min={min}
      step={step}
      value={draft}
      onChange={(e) => {
        const next = e.target.value;

        if (next === "") {
          setDraft("");
          return;
        }

        if (!/^\d+$/.test(next)) {
          return;
        }

        setDraft(next);

        const num = Number(next);
        if (Number.isFinite(num) && num >= min && num % step === 0) {
          onChange(num);
        }
      }}
      onBlur={commitValue}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function floorToChipUnit(value, chipUnit = DEFAULT_CHIP_UNIT) {
  const num = Number(value) || 0;
  return Math.floor(num / chipUnit) * chipUnit;
}

function normalizeBlindLevelsForApp(levels, chipUnit = DEFAULT_CHIP_UNIT) {
  const source =
    Array.isArray(levels) && levels.length
      ? levels
      : [{ level: 1, smallBlind: 100, bigBlind: 200, ante: 200 }];

  return source.map((item, idx) => ({
    level: idx + 1,
    smallBlind: floorToChipUnit(item?.smallBlind, chipUnit),
    bigBlind: floorToChipUnit(item?.bigBlind, chipUnit),
    ante: floorToChipUnit(item?.ante, chipUnit),
  }));
}

function clampLevelIndex(levels, index, chipUnit = DEFAULT_CHIP_UNIT) {
  const normalized = normalizeBlindLevelsForApp(levels, chipUnit);
  if (!normalized.length) return 0;
  return Math.max(0, Math.min(Number(index) || 0, normalized.length - 1));
}

function levelSummary(level) {
  if (!level) return "-";
  return `${formatBlind(level.smallBlind)} / ${formatBlind(level.bigBlind)} / ${formatBlind(level.ante)}`;
}

function formatBlind(value) {
  const num = Number(value) || 0;

  if (num >= 1000000) return `${num / 1000000}M`;
  if (num >= 10000) return `${num / 1000}K`;

  return `${num}`;
}

function formatPot(value) {
  const num = Number(value) || 0;
  return num.toLocaleString();
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

  const labels = {};
  const handSeats = getSeatsInCurrentHand(state);
  const activeCount = handSeats.length;
  if (activeCount < 2) return labels;

  const forced = state.forcedBets || {};
  const buttonSeatIndex =
    Number.isInteger(forced.buttonSeatIndex) && forced.buttonSeatIndex >= 0
      ? forced.buttonSeatIndex
      : state.dealerSeatIndex;

  const sbSeatIndex =
    Number.isInteger(forced.sbSeatIndex) && forced.sbSeatIndex >= 0
      ? forced.sbSeatIndex
      : -1;

  const bbSeatIndex =
    Number.isInteger(forced.bbSeatIndex) && forced.bbSeatIndex >= 0
      ? forced.bbSeatIndex
      : -1;

  const handSeatSet = new Set(handSeats);

  // Heads-up: button seat is D/SB, other is BB
  if (activeCount === 2) {
    if (buttonSeatIndex >= 0 && state.seats[buttonSeatIndex]) {
      labels[buttonSeatIndex] =
        handSeatSet.has(buttonSeatIndex) ? "D/SB" : "DEAD BTN";
    }

    if (bbSeatIndex >= 0 && handSeatSet.has(bbSeatIndex)) {
      labels[bbSeatIndex] = "BB";
    }

    return labels;
  }

  // 3명 이상
  if (buttonSeatIndex >= 0 && state.seats[buttonSeatIndex]) {
    labels[buttonSeatIndex] = handSeatSet.has(buttonSeatIndex) ? "BTN" : "DEAD BTN";
  }

  if (sbSeatIndex >= 0 && handSeatSet.has(sbSeatIndex)) {
    labels[sbSeatIndex] = "SB";
  }

  if (bbSeatIndex >= 0 && handSeatSet.has(bbSeatIndex)) {
    labels[bbSeatIndex] = "BB";
  }

  const roleSeats = handSeats.filter(
    (seatIndex) =>
      seatIndex !== buttonSeatIndex &&
      seatIndex !== sbSeatIndex &&
      seatIndex !== bbSeatIndex
  );

  if (!roleSeats.length) return labels;

  const positionOrder = getPositionOrder(activeCount).filter(
    (role) => role !== "SB" && role !== "BB"
  );

  // button 다음부터 시계방향으로 정렬
  const orderedRoleSeats = [...roleSeats].sort((a, b) => {
    const da = (a - buttonSeatIndex + MAX_SEATS) % MAX_SEATS;
    const db = (b - buttonSeatIndex + MAX_SEATS) % MAX_SEATS;
    return da - db;
  });

  orderedRoleSeats.forEach((seatIndex, idx) => {
    const role = positionOrder[idx];
    if (role) labels[seatIndex] = role;
  });

  return labels;
}

function ChipRaceControl({ chipUnit, onRunChipRace, disabled = false, compact = false }) {
  const [nextUnit, setNextUnit] = useState(chipUnit);

  useEffect(() => {
    setNextUnit(chipUnit);
  }, [chipUnit]);

  const options = [100, 500, 1000, 5000, 10000, 25000, 50000, 100000];

  return (
    <div className={["chip-race-control", compact ? "chip-race-control-compact" : ""].join(" ")}>
      <div className="chip-race-title">칩레이스</div>

      <div className="chip-race-row">
        <select value={nextUnit} onChange={(e) => setNextUnit(Number(e.target.value))}>
          {options.map((value) => (
            <option key={value} value={value}>
              최소칩 {formatPot(value)}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={disabled || nextUnit <= chipUnit}
          onClick={() => onRunChipRace(nextUnit)}
        >
          적용
        </button>
      </div>

      <div className="muted">현재 최소칩: {formatPot(chipUnit)}</div>
    </div>
  );
}

function BlindLevelsEditor({
  state,
  onSelectStartLevel,
  onUpdateBlindLevel,
  onAddBlindLevel,
  onRemoveBlindLevel,
}) {
  return (
    <div className="setup-section-card setup-blind-section-card">
      <div className="setup-section-head">
        <div className="setup-section-head-text">
          <h3>블라인드 레벨</h3>
          <div className="setup-section-subtext">
            시작 레벨을 선택하고 각 레벨의 SB / BB / Ante를 조정합니다.
          </div>
        </div>

        <div className="setup-section-head-actions">
          <button type="button" onClick={onAddBlindLevel}>
            + 레벨
          </button>
        </div>
      </div>

      <div className="blind-levels-panel">
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
                      {isSelected ? "선택됨" : "선택"}
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
                      step={state.chipUnit}
                      onChange={(v) => onUpdateBlindLevel(idx, "smallBlind", v)}
                    />
                  </label>

                  <label>
                    BB
                    <PlainNumberInput
                      value={level.bigBlind}
                      min={0}
                      step={state.chipUnit}
                      onChange={(v) => onUpdateBlindLevel(idx, "bigBlind", v)}
                    />
                  </label>

                  <label>
                    Ante
                    <PlainNumberInput
                      value={level.ante}
                      min={0}
                      step={state.chipUnit}
                      onChange={(v) => onUpdateBlindLevel(idx, "ante", v)}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
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
  onRunChipRace,
}) {
  const updateSeatPlayer = (seatIndex, key, value) => {
    onChangeState({
      ...state,
      seats: state.seats.map((p, idx) => {
        if (idx !== seatIndex || !p) return p;

        const nextValue = key === "startStack" ? floorToChipUnit(value, state.chipUnit) : value;
        const next = { ...p, [key]: nextValue };

        if (key === "startStack") next.stack = nextValue;
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
              anteInvested: 0,
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

      <div className="setup-grid setup-grid-top">
        <label className="setup-field-card">
          <span className="setup-field-label">시작 레벨</span>
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

        <label className="setup-field-card">
          <span className="setup-field-label">현재 블라인드</span>
          <input value={levelSummary(currentLevel)} readOnly />
        </label>

        <label className="setup-field-card">
          <span className="setup-field-label">Dealer Seat</span>
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

        <div className="setup-field-card setup-chip-race-inline">
          <ChipRaceControl chipUnit={state.chipUnit} onRunChipRace={onRunChipRace} compact />
        </div>
      </div>

      <div className="setup-main-grid">
        <div className="setup-left-col setup-column-card-wrap">
          <BlindLevelsEditor
            state={state}
            onSelectStartLevel={onSelectStartLevel}
            onUpdateBlindLevel={onUpdateBlindLevel}
            onAddBlindLevel={onAddBlindLevel}
            onRemoveBlindLevel={onRemoveBlindLevel}
          />
        </div>

        <div className="setup-right-col setup-column-card-wrap">
          <div className="setup-section-card setup-seat-section-card">
            <div className="setup-section-head">
              <div className="setup-section-head-text">
                <h3>고정 좌석 1~10</h3>
                <div className="setup-section-subtext">
                  빈 자리는 유지됩니다. 원하는 좌석에 플레이어를 직접 앉힐 수 있습니다.
                </div>
              </div>
            </div>

            <div className="players-block players-block-tight players-scroll-area">
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
                        step={state.chipUnit}
                      />
                      <button className="seat-row-btn" onClick={() => toggleSetupSitOut(seatIndex)}>
                        {player.sitOut ? "복귀" : "Sit out"}
                      </button>
                      <button
                        className="danger seat-row-btn"
                        onClick={() => removeSeatPlayer(seatIndex)}
                      >
                        자리 비우기
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="empty-seat-label">빈 자리</div>
                      <div></div>
                      <button className="seat-row-btn" onClick={() => addSeatPlayer(seatIndex)}>
                        앉히기
                      </button>
                      <div></div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <button className="primary big-btn" onClick={onStart}>
        첫 핸드 시작
      </button>
    </div>
  );
}

function BlindEditor({ state, onChangeBlindLevel }) {
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
              예약: Lv {state.pendingBlindLevelIndex + 1}
            </div>
          ) : null}
        </div>

        <span className={["blind-editor-chevron", open ? "open" : ""].join(" ")}>▾</span>
      </button>

      {open && (
        <div className="blind-editor-body blind-editor-body-compact">
          <div className="blind-level-live-panel">
            <div className="blind-level-live-top">
              <div className="blind-level-live-title">현재 Lv {state.currentBlindLevelIndex + 1}</div>
              <div className="blind-level-live-value">{levelSummary(currentLevel)}</div>
            </div>

            <div className="blind-level-live-actions">
              <button
                type="button"
                disabled={!canLevelDown}
                onClick={() => onChangeBlindLevel(-1)}
              >
                Level -
              </button>

              <button
                type="button"
                disabled={!canLevelUp}
                onClick={() => onChangeBlindLevel(1)}
              >
                Level +
              </button>
            </div>

            {pendingChanged ? (
              <div className="blind-editor-next-info">
                다음 핸드 적용: {levelSummary(pendingLevel)}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

function TableUtilityPanel({ state, onUpdateDealer, onRunChipRace }) {
  return (
    <div className="panel table-utility-panel">
      <div className="table-utility-grid">
        <label className="table-utility-field">
          <span className="table-utility-label">Dealer</span>
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

        <div className="table-utility-field">
          <ChipRaceControl
            chipUnit={state.chipUnit}
            onRunChipRace={onRunChipRace}
            disabled={state.street !== "finished"}
            compact
          />
        </div>
      </div>
    </div>
  );
}

function ShowdownPanel({ state, onSettle }) {
  const [winnersByPot, setWinnersByPot] = useState({});
  const [currentPotIndex, setCurrentPotIndex] = useState(0);

  useEffect(() => {
    const init = {};
    (state.confirmedPots || []).forEach((_, idx) => {
      init[idx] = [];
    });
    setWinnersByPot(init);
    setCurrentPotIndex(0);
  }, [state.confirmedPots]);

  const pots = state.confirmedPots || [];
  const currentPot = pots[currentPotIndex];

  const toggleWinner = (seatIndex) => {
    setWinnersByPot((prev) => {
      const exists = prev[currentPotIndex]?.includes(seatIndex);

      return {
        ...prev,
        [currentPotIndex]: exists
          ? prev[currentPotIndex].filter((id) => id !== seatIndex)
          : [...(prev[currentPotIndex] || []), seatIndex],
      };
    });
  };

  const handleNext = () => {
    if (currentPotIndex < pots.length - 1) {
      setCurrentPotIndex((prev) => prev + 1);
      return;
    }

    onSettle(winnersByPot);
  };

  if (!pots.length) {
    return (
      <div className="panel">
        <h2>쇼다운 분배</h2>
        <div className="muted">분배할 팟이 없습니다.</div>
      </div>
    );
  }

  return (
    <div className="panel">
      <h2>쇼다운 분배</h2>

      <div className="showdown-progress">
        {currentPotIndex + 1} / {pots.length}
      </div>

      <div className="showdown-pot">
        <div className="showdown-title">
          {currentPotIndex === 0 ? "Main Pot" : `Side Pot ${currentPotIndex}`} -{" "}
          {formatPot(currentPot.amount)}
        </div>

        <div className="winner-list winner-list-buttons">
          {currentPot.eligibleSeatIndices.map((seatIndex) => {
            const player = state.seats[seatIndex];
            const checked = winnersByPot[currentPotIndex]?.includes(seatIndex);

            return (
              <button
                key={seatIndex}
                type="button"
                className={[
                  "winner-select-btn",
                  checked ? "winner-select-btn-active" : "",
                ].join(" ")}
                onClick={() => toggleWinner(seatIndex)}
              >
                <span className="winner-select-seat">{seatIndex + 1}</span>
                <span className="winner-select-name">{player?.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button className="primary big-btn" onClick={handleNext}>
        {currentPotIndex < pots.length - 1 ? "다음 팟" : "선택한 승자로 분배"}
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
                  className={[
                    "table-position-chip",
                    positionLabel === "BTN" ||
                    positionLabel === "D/SB" ||
                    positionLabel === "DEAD BTN"
                      ? "table-position-btn"
                      : "",
                    positionLabel === "DEAD BTN" ? "table-position-dead-btn" : "",
                  ].join(" ")}
                >
                  {positionLabel === "DEAD BTN" ? "BTN" : positionLabel}
                </span>
              ) : null}
            </div>

            <div className="table-seat-stack">{formatPot(player.stack)}</div>
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
              <span className="table-seat-action-value">{formatPot(currentBetAmount)}</span>
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
  const blindText = `${formatBlind(state.smallBlind)} / ${formatBlind(state.bigBlind)} / ${formatBlind(state.ante)}`;
  const blindLevel = `LEVEL ${state.currentBlindLevelIndex + 1}`;

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
                  <span className="table-center-pot-value">{formatPot(item.amount)}</span>
                </div>
              ))}
            </div>

            <div className="table-center-blinds">
              <span className="table-center-level">{blindLevel}</span>
              <span className="table-center-blind-values">{blindText}</span>
            </div>
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
    setAmount(floorToChipUnit(state.currentBet === 0 ? state.bigBlind : minRaiseTo, state.chipUnit));
  }, [state.currentSeatIndex, state.currentBet, state.bigBlind, minRaiseTo, currentPlayer, state.chipUnit]);

  const applyAmount = (next) => {
    const safe = Math.max(0, floorToChipUnit(Number.isFinite(next) ? next : 0, state.chipUnit));
    setAmount(safe);
  };

  if (!canDoAction) {
    return (
      <div className="panel action-panel-compact action-panel-empty">
        <div className="action-panel-compact-head">
          <div className="action-panel-compact-title">현재 액션 없음</div>
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
          <div className="action-panel-compact-title">
            Seat {state.currentSeatIndex + 1} · {currentPlayer.name}
          </div>
        </div>
      </div>

      <div className="action-panel-compact-bottom">
        <div className="action-panel-compact-amount">
          <div className="amount-control">
            <div className="amount-control-main">
              <button type="button" onClick={() => applyAmount(amount - state.chipUnit)}>
                -{formatPot(state.chipUnit)}
              </button>

              <input
                type="number"
                min="0"
                step={state.chipUnit}
                value={amount}
                onChange={(e) => applyAmount(Number(e.target.value))}
              />

              <button type="button" onClick={() => applyAmount(amount + state.chipUnit)}>
                +{formatPot(state.chipUnit)}
              </button>
            </div>

            <div className="amount-quick-buttons">
              <button type="button" onClick={() => applyAmount(amount - state.chipUnit * 5)}>
                -{formatPot(state.chipUnit * 5)}
              </button>

              <button type="button" onClick={() => applyAmount(amount + state.chipUnit * 10)}>
                +{formatPot(state.chipUnit * 10)}
              </button>

              <button type="button" onClick={() => applyAmount(amount + state.chipUnit * 5)}>
                +{formatPot(state.chipUnit * 5)}
              </button>
            </div>
          </div>
        </div>

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
    const safeStack = floorToChipUnit(newStack, state.chipUnit);

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
      stack: floorToChipUnit(newStack, state.chipUnit),
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
              <span className="seat-detail-v">{formatPot(player.stack)}</span>
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
                step={state.chipUnit}
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
                step={state.chipUnit}
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

  const handleToggleSeatDetail = (seatIndex) => {
    setSelectedSeatIndex((prev) => (prev === seatIndex ? -1 : seatIndex));
  };

  const positionLabels = useMemo(() => getPositionLabels(state), [state]);

  const handleStart = () => setState((prev) => startHand(prev, false));
  const handleNextHand = () => setState((prev) => startNextHand(prev));
  const handleAction = (action, amount = 0) =>
    setState((prev) => applyAction(prev, action, amount));
  const handleSettle = (winnersByPot) =>
    setState((prev) => settleShowdown(prev, winnersByPot));
  const handleUndo = () => setState((prev) => undoAction(prev));
  const handleRunChipRace = (nextChipUnit) =>
    setState((prev) => runChipRace(prev, nextChipUnit));

  const handleSelectStartLevel = (targetIndex) => {
    setState((prev) => {
      const blindLevels = normalizeBlindLevelsForApp(prev.blindLevels, prev.chipUnit);
      const nextIndex = clampLevelIndex(blindLevels, targetIndex, prev.chipUnit);
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
      const blindLevels = normalizeBlindLevelsForApp(prev.blindLevels, prev.chipUnit).map((level, idx) =>
        idx === levelIndex
          ? {
              ...level,
              [key]: Math.max(0, floorToChipUnit(rawValue, prev.chipUnit)),
            }
          : level
      );

      const currentBlindLevelIndex = clampLevelIndex(
        blindLevels,
        prev.currentBlindLevelIndex,
        prev.chipUnit
      );
      const pendingBlindLevelIndex = clampLevelIndex(
        blindLevels,
        prev.pendingBlindLevelIndex,
        prev.chipUnit
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

  const handleAddBlindLevel = () => {
    setState((prev) => {
      const blindLevels = normalizeBlindLevelsForApp(prev.blindLevels, prev.chipUnit);
      const last = blindLevels[blindLevels.length - 1] || {
        smallBlind: prev.chipUnit,
        bigBlind: prev.chipUnit * 2,
        ante: prev.chipUnit * 2,
      };

      const nextLevel = {
        level: blindLevels.length + 1,
        smallBlind: floorToChipUnit(
          last.smallBlind > 0 ? last.smallBlind * 2 : prev.chipUnit,
          prev.chipUnit
        ),
        bigBlind: floorToChipUnit(
          last.bigBlind > 0 ? last.bigBlind * 2 : prev.chipUnit * 2,
          prev.chipUnit
        ),
        ante: floorToChipUnit(
          last.ante > 0 ? last.ante * 2 : prev.chipUnit * 2,
          prev.chipUnit
        ),
      };

      return {
        ...prev,
        blindLevels: [...blindLevels, nextLevel],
      };
    });
  };

  const handleRemoveBlindLevel = (levelIndex) => {
    setState((prev) => {
      const currentLevels = normalizeBlindLevelsForApp(prev.blindLevels, prev.chipUnit);
      if (currentLevels.length <= 1) return prev;

      const blindLevels = currentLevels
        .filter((_, idx) => idx !== levelIndex)
        .map((level, idx) => ({ ...level, level: idx + 1 }));

      const currentBlindLevelIndex = clampLevelIndex(
        blindLevels,
        prev.currentBlindLevelIndex > levelIndex
          ? prev.currentBlindLevelIndex - 1
          : prev.currentBlindLevelIndex,
        prev.chipUnit
      );

      const pendingBlindLevelIndex = clampLevelIndex(
        blindLevels,
        prev.pendingBlindLevelIndex > levelIndex
          ? prev.pendingBlindLevelIndex - 1
          : prev.pendingBlindLevelIndex,
        prev.chipUnit
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
      const blindLevels = normalizeBlindLevelsForApp(prev.blindLevels, prev.chipUnit);
      const baseIndex =
        prev.street === "finished"
          ? prev.currentBlindLevelIndex
          : prev.pendingBlindLevelIndex ?? prev.currentBlindLevelIndex;

      const nextIndex = clampLevelIndex(blindLevels, baseIndex + delta, prev.chipUnit);
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
          onRunChipRace={handleRunChipRace}
        />
      ) : (
        <div
          className={[
            "table-and-side-grid",
            selectedSeatIndex >= 0 ? "table-and-side-grid-with-side" : "table-and-side-grid-full",
          ].join(" ")}
        >
          <div className="table-main-col">
            <OvalTableLayout
              state={state}
              positionLabels={positionLabels}
              selectedSeatIndex={selectedSeatIndex}
              onSelectSeat={handleToggleSeatDetail}
            />

            <div
              className={[
                "bottom-control-row",
                state.street === "showdown" || state.street === "finished"
                  ? "bottom-control-row-with-showdown"
                  : "",
              ].join(" ")}
            >
              <CurrentPlayerActionPanel state={state} onPlayerAction={handleAction} />

              <BlindEditor state={state} onChangeBlindLevel={handleChangeBlindLevel} />

              <TableUtilityPanel
                state={state}
                onUpdateDealer={handleUpdateDealer}
                onRunChipRace={handleRunChipRace}
              />

              {state.street === "showdown" && (
                <div className="showdown-inline-panel">
                  <ShowdownPanel state={state} onSettle={handleSettle} />
                </div>
              )}

              {state.street === "finished" && (
                <div className="showdown-inline-panel">
                  <div className="panel hand-finished-panel">
                    <h2>핸드 종료</h2>
                    <div className="muted">다음 핸드를 시작하거나 칩레이스를 적용할 수 있습니다.</div>
                    <button className="primary big-btn" onClick={handleNextHand}>
                      다음 핸드 시작
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {selectedSeatIndex >= 0 && (
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
          )}
        </div>
      )}
    </div>
  );
}