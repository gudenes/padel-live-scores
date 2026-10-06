// Generated from admin scouting. Run node extensions/scouting-video-overlay/sync-scoring.cjs
// src/lib/padel-scoring.ts — Pure scoring engine for padel.
export const DEUCE_RULES = [
    { id: "star-point" },
    { id: "golden-point" },
    { id: "advantage" },
];
export function getDeuceRule(config) {
    return (config.deuceRule ?? (config.goldenPoint ? "golden-point" : "advantage"));
}
export function isStarPoint(state) {
    return (state.phase === "playing" &&
        getDeuceRule(state.config) === "star-point" &&
        state.currentGame.a === 40 &&
        state.currentGame.b === 40 &&
        (state.advantageReturns ?? 0) >= 2);
}
export function createInitialState(config) {
    return {
        config,
        sets: [{ a: 0, b: 0 }],
        currentGame: { a: 0, b: 0 },
        servingTeam: "a",
        servingPlayer: 0,
        phase: "playing",
        winner: null,
        endReason: null,
        advantageReturns: 0,
    };
}
const NEXT_POINT = {
    0: 15,
    15: 30,
    30: 40,
};
export function apply(state, action) {
    if (action.kind === "reset")
        return createInitialState(state.config);
    if (state.phase === "finished")
        return state;
    switch (action.kind) {
        case "point_for":
            return pointFor(state, action.team);
        case "mark_retirement":
            return {
                ...state,
                phase: "finished",
                winner: other(action.team),
                endReason: "retired",
            };
        case "mark_walkover":
            return {
                ...state,
                phase: "finished",
                winner: other(action.team),
                endReason: "walkover",
            };
        case "correct_score":
            return { ...state, ...action.patch };
        case "set_server": {
            const order = [...(state.servingOrder ?? [0, 1, 2, 3])];
            const currentSlot = order.indexOf(state.servingPlayer);
            const targetSlot = state.servingTeam === action.team ? currentSlot : (currentSlot + 1) % 4;
            const player = (action.player * 2 +
                (action.team === "b" ? 1 : 0));
            const previousSlot = order.indexOf(player);
            [order[targetSlot], order[previousSlot]] = [
                order[previousSlot],
                order[targetSlot],
            ];
            return {
                ...state,
                servingTeam: action.team,
                servingPlayer: player,
                servingOrder: order,
            };
        }
        case "set_golden_point":
            return {
                ...state,
                advantageReturns: 0,
                config: {
                    ...state.config,
                    goldenPoint: action.value,
                    deuceRule: action.value ? "golden-point" : "advantage",
                },
            };
        case "set_format":
            return { ...state, config: { ...state.config, format: action.value } };
        case "undo":
            // Undo is handled by the match-log wrapper, not the pure reducer.
            return state;
        default:
            return state;
    }
}
function nextServer(state) {
    const order = state.servingOrder ?? [0, 1, 2, 3];
    return order[(order.indexOf(state.servingPlayer) + 1) % 4];
}
function other(team) {
    return team === "a" ? "b" : "a";
}
function pointFor(state, team) {
    if (state.phase === "tiebreak" || state.phase === "super-tiebreak") {
        return pointInTiebreak(state, team);
    }
    return pointInGame(state, team);
}
function pointInGame(state, team) {
    const game = state.currentGame;
    const mine = game[team];
    const theirs = game[other(team)];
    // Advantage resolution
    if (mine === "Adv")
        return finishGame(state, team);
    if (theirs === "Adv") {
        return {
            ...state,
            advantageReturns: (state.advantageReturns ?? 0) + 1,
            currentGame: { ...game, [other(team)]: 40 },
        };
    }
    // Deuce
    if (mine === 40 && theirs === 40) {
        if (getDeuceRule(state.config) === "golden-point" || isStarPoint(state))
            return finishGame(state, team);
        return { ...state, currentGame: { ...game, [team]: "Adv" } };
    }
    // Win from 40 when opponent is not 40/Adv
    if (mine === 40)
        return finishGame(state, team);
    // Normal progression
    const next = NEXT_POINT[mine];
    return { ...state, currentGame: { ...game, [team]: next } };
}
function finishGame(state, winner) {
    const sets = state.sets.map((s, i) => i === state.sets.length - 1 ? { ...s, [winner]: s[winner] + 1 } : s);
    const updated = {
        ...state,
        sets,
        currentGame: { a: 0, b: 0 },
        advantageReturns: 0,
        servingTeam: other(state.servingTeam),
        servingPlayer: nextServer(state),
    };
    return maybeCloseSetOrMatch(updated);
}
function maybeCloseSetOrMatch(state) {
    const current = state.sets[state.sets.length - 1];
    const { a, b } = current;
    const setComplete = isSetComplete(a, b, state.config);
    // 6-6 tiebreak entry
    if (a === 6 && b === 6 && state.config.setTiebreakAt === 6 && !setComplete) {
        return { ...state, phase: "tiebreak", currentGame: { a: 0, b: 0 } };
    }
    if (!setComplete)
        return state;
    const setWinner = a > b ? "a" : "b";
    const matchOver = checkMatchOver(state.sets, state.config);
    if (matchOver) {
        return {
            ...state,
            phase: "finished",
            winner: setWinner,
            endReason: "completed",
        };
    }
    const nextSets = [...state.sets, { a: 0, b: 0 }];
    if (state.config.superTiebreak && isDecidingSet(nextSets, state.config)) {
        return {
            ...state,
            sets: nextSets,
            phase: "super-tiebreak",
            currentGame: { a: 0, b: 0 },
        };
    }
    return { ...state, sets: nextSets };
}
function isSetComplete(a, b, config) {
    if (config.format === "pro-set") {
        return (a >= 9 || b >= 9) && Math.abs(a - b) >= 2;
    }
    // bo3 / bo5 / single-set: standard 6-game set with 7-6 tiebreak and 7-5.
    if (a === 7 && b === 6)
        return true;
    if (a === 6 && b === 7)
        return true;
    return (a >= 6 || b >= 6) && Math.abs(a - b) >= 2;
}
function setsNeededFor(format) {
    if (format === "bo5")
        return 3;
    if (format === "bo3")
        return 2;
    // pro-set and single-set end in one "set"
    return 1;
}
function checkMatchOver(sets, config) {
    const needed = setsNeededFor(config.format);
    let aSets = 0;
    let bSets = 0;
    for (const s of sets) {
        if (!isSetComplete(s.a, s.b, config))
            continue;
        if (s.a > s.b)
            aSets++;
        else
            bSets++;
    }
    return aSets >= needed || bSets >= needed;
}
function isDecidingSet(sets, config) {
    // Super-tiebreak replaces a deciding set — only meaningful for bo3/bo5.
    if (config.format !== "bo3" && config.format !== "bo5")
        return false;
    const needed = setsNeededFor(config.format);
    let aSets = 0;
    let bSets = 0;
    for (let i = 0; i < sets.length - 1; i++) {
        const s = sets[i];
        if (!isSetComplete(s.a, s.b, config))
            continue;
        if (s.a > s.b)
            aSets++;
        else
            bSets++;
    }
    return aSets === needed - 1 && bSets === needed - 1;
}
function pointInTiebreak(state, team) {
    const tb = state.currentGame;
    const totalPoints = tb.a + tb.b + 1; // points played including the one just won
    const mine = tb[team] + 1;
    const theirs = tb[other(team)];
    const threshold = state.phase === "super-tiebreak" ? 10 : 7;
    let next = { ...state, currentGame: { ...tb, [team]: mine } };
    // Serve rotation in tiebreak: change after point 1, then every 2 points.
    const rotate = totalPoints === 1 || (totalPoints >= 3 && (totalPoints - 1) % 2 === 0);
    if (rotate) {
        next = {
            ...next,
            servingTeam: other(next.servingTeam),
            servingPlayer: nextServer(next),
        };
    }
    if (mine >= threshold && mine - theirs >= 2) {
        return closeTiebreak(next, team);
    }
    return next;
}
function closeTiebreak(state, winner) {
    const setIndex = state.sets.length - 1;
    const wasSuper = state.phase === "super-tiebreak";
    const sets = state.sets.map((s, i) => {
        if (i !== setIndex)
            return s;
        if (wasSuper) {
            // Super-tiebreak sets are recorded as 1-0 (not 7-6)
            return { a: winner === "a" ? 1 : 0, b: winner === "b" ? 1 : 0 };
        }
        return {
            a: winner === "a" ? s.a + 1 : s.a,
            b: winner === "b" ? s.b + 1 : s.b,
        };
    });
    const base = {
        ...state,
        sets,
        currentGame: { a: 0, b: 0 },
        phase: "playing",
    };
    const matchOver = wasSuper || checkMatchOver(sets, state.config);
    if (matchOver) {
        return { ...base, phase: "finished", winner, endReason: "completed" };
    }
    // The pair that received the first tiebreak point starts the next set.
    const total = Number(state.currentGame.a) + Number(state.currentGame.b);
    const order = state.servingOrder ?? [0, 1, 2, 3];
    const firstSlot = (order.indexOf(state.servingPlayer) - (Math.ceil(total / 2) % 4) + 4) % 4;
    const nextServer = order[(firstSlot + 1) % 4];
    return {
        ...base,
        servingPlayer: nextServer,
        servingTeam: nextServer % 2 === 0 ? "a" : "b",
        sets: [...sets, { a: 0, b: 0 }],
    };
}
