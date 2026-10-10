// Generated from admin scouting. Run node extensions/scouting-video-overlay/sync-scoring.cjs
import { shots } from './shots.mjs';
import { apply, createInitialState } from './scoring.mjs';
import { createTracking } from './tracking.mjs';
export const teamOf = (p) => p < 2 ? 'a' : 'b';
const slot = (p) => [0, 2, 1, 3][p];
export function freshDoc() { return { version: 1, rule: 'star-point', firstServer: 0, otherServer: 2, near: 'a', events: [] }; }
export function validateDoc(raw) {
    if (!raw || typeof raw !== 'object')
        throw Error('Invalid scouting session.');
    const d = raw;
    const player = (p) => Number.isInteger(p) && Number(p) >= 0 && Number(p) <= 3;
    if (d.preparation !== undefined && d.preparation !== true)
        throw Error('Invalid preparation mode.');
    if (d.version !== 1 || !['star-point', 'golden-point', 'advantage'].includes(d.rule) || !player(d.firstServer) || !player(d.otherServer) || teamOf(d.firstServer) === teamOf(d.otherServer) || !['a', 'b'].includes(d.near) || !Array.isArray(d.events) || d.events.length > 5000)
        throw Error('Invalid session settings.');
    const ids = new Set();
    for (const e of d.events) {
        if (!e || typeof e !== 'object' || typeof e.id !== 'string' || e.id.length > 80 || ids.has(e.id) || !Number.isFinite(Date.parse(e.at)))
            throw Error('Invalid scouting event.');
        ids.add(e.id);
        if (!['point', 'smash', 'unclassified', 'flip', 'swap', 'server', 'score', 'start', 'game_start', 'rally_start', 'first_fault', 'double_fault', 'pair_arrived', 'court_setup', 'undo'].includes(e.kind))
            throw Error('Unknown scouting action.');
        if (['point', 'smash', 'server'].includes(e.kind) && !player(e.player))
            throw Error('Invalid player.');
        if (e.kind === 'start' && !['match', 'observation'].includes(e.scope))
            throw Error('Invalid clock scope.');
        if (e.kind === 'score')
            validateSeed(e.seed);
        if (e.kind === 'court_setup') {
            const c = e.settings;
            if (!c || !['star-point', 'golden-point', 'advantage'].includes(c.rule) || !player(c.firstServer) || !player(c.otherServer) || teamOf(c.firstServer) === teamOf(c.otherServer) || !['a', 'b'].includes(c.near))
                throw Error('Invalid court setup.');
        }
        if (e.kind === 'point') {
            if (e.shot !== undefined && (!Object.hasOwn(shots, e.shot) || (e.shot === 'smash') !== e.smash))
                throw Error('Invalid shot type.');
            if (e.side !== undefined && !['forehand', 'backhand'].includes(e.side))
                throw Error('Invalid shot side.');
            if (e.assistBy !== undefined && (!player(e.assistBy) || e.outcome !== 'winner' || e.assistBy !== (e.player ^ 1)))
                throw Error('Assists must credit the winning player’s teammate.');
            if (e.forcedBy !== undefined && (!player(e.forcedBy) || e.outcome !== 'forced' || teamOf(e.forcedBy) === teamOf(e.player)))
                throw Error('Forced-error credit must name an opponent.');
            if (e.previousPlayer !== undefined && (!player(e.previousPlayer) || !['forced', 'unforced'].includes(e.outcome) || teamOf(e.previousPlayer) === teamOf(e.player)))
                throw Error('Previous player must name an opponent for an error.');
            if (e.previousShot !== undefined && (e.previousPlayer === undefined || !Object.hasOwn(shots, e.previousShot)))
                throw Error('Previous stroke requires an opponent and valid shot.');
            if (e.previousPlayer !== undefined && e.forcedBy !== undefined && e.previousPlayer !== e.forcedBy)
                throw Error('Previous player and forced-error credit must agree.');
            if (e.netTouch !== undefined && typeof e.netTouch !== 'boolean')
                throw Error('Invalid net touch tag.');
            if (e.smashRecovery !== undefined && (typeof e.smashRecovery !== 'boolean' || (e.smashRecovery && e.outcome !== 'winner')))
                throw Error('Smash recovery is only available for winners.');
            if (e.netCord !== undefined && !['lucky', 'unlucky'].includes(e.netCord))
                throw Error('Invalid net cord tag.');
            if (e.recovery !== undefined && (typeof e.recovery !== 'boolean' || (e.recovery && e.outcome !== 'winner')))
                throw Error('Recovery is only available for winners.');
        }
        if (e.kind === 'point' && e.smashAttemptId !== undefined && (typeof e.smashAttemptId !== 'string' || !e.smash))
            throw Error('Invalid smash attempt link.');
        if (e.kind === 'point' && (!['winner', 'forced', 'unforced'].includes(e.outcome) || typeof e.smash !== 'boolean'))
            throw Error('Invalid point outcome.');
        if ((e.kind === 'swap' || e.kind === 'unclassified' || e.kind === 'pair_arrived') && !['a', 'b'].includes(e.team))
            throw Error('Invalid pair.');
    }
    replay(d);
    return d;
}
export function activeEvents(doc) {
    const active = [];
    for (const e of doc.events) {
        if (e.kind === 'undo')
            active.pop();
        else
            active.push(e);
    }
    return active;
}
export function replay(doc) {
    const events = activeEvents(doc), arrivals = { a: null, b: null };
    let ready = !doc.preparation;
    let settings = { rule: doc.rule, firstServer: doc.firstServer, otherServer: doc.otherServer, near: doc.near };
    for (const e of events) {
        if (e.kind === 'pair_arrived') {
            if (ready || arrivals[e.team])
                throw Error('Pair arrival is already recorded or setup is complete.');
            arrivals[e.team] = e.at;
        }
        else if (e.kind === 'court_setup') {
            if (ready || !arrivals.a || !arrivals.b)
                throw Error('Mark both pairs on court before confirming setup.');
            settings = e.settings;
            ready = true;
        }
        else if (!ready)
            throw Error('Confirm court setup before starting scouting.');
    }
    let score = createInitialState({ format: 'bo3', goldenPoint: settings.rule === 'golden-point', deuceRule: settings.rule, superTiebreak: false, setTiebreakAt: 6 });
    const f = slot(settings.firstServer), o = slot(settings.otherServer);
    score = { ...score, servingPlayer: f, servingTeam: teamOf(settings.firstServer), servingOrder: [f, o, ((f + 2) % 4), ((o + 2) % 4)] };
    let near = settings.near;
    const swapped = { a: false, b: false };
    const stats = Array.from({ length: 4 }, () => ({ winners: 0, forced: 0, unforced: 0, smashes: 0, smashWinners: 0, smashPointsWon: 0, smashErrorsGenerated: 0, smashErrors: 0, assists: 0, forcedErrorsCreated: 0, netTouches: 0, recoveryWinners: 0, smashRecoveryWinners: 0, luckyNetCords: 0, unluckyNetCords: 0, shots: {} }));
    const tracking = createTracking();
    let points = 0, unclassified = 0;
    const rallySmashes = new Map();
    for (const e of events) {
        if (e.kind === 'pair_arrived' || e.kind === 'court_setup')
            continue;
        if (e.kind === 'rally_start' || e.kind === 'score')
            rallySmashes.clear();
        if (e.kind === 'start' || e.kind === 'game_start' || e.kind === 'rally_start' || e.kind === 'first_fault') {
            if (score.phase === 'finished')
                throw Error('Match has finished.');
            tracking.handle(e, score, score);
            continue;
        }
        if (e.kind === 'score') {
            const before = score;
            const v = e.seed;
            score = { ...score, sets: v.sets, currentGame: v.game, phase: v.phase, advantageReturns: v.returns, winner: null, endReason: null };
            score = apply(score, { kind: 'set_server', team: teamOf(v.server), player: (v.server % 2) });
            tracking.handle(e, before, score);
            continue;
        }
        if (e.kind === 'flip') {
            near = near === 'a' ? 'b' : 'a';
            continue;
        }
        if (e.kind === 'swap') {
            swapped[e.team] = !swapped[e.team];
            continue;
        }
        if (e.kind === 'server') {
            const before = score;
            score = apply(score, { kind: 'set_server', team: teamOf(e.player), player: (e.player % 2) });
            tracking.handle(e, before, score);
            continue;
        }
        if (score.phase === 'finished')
            throw Error('Match has finished. Undo the last action to correct it.');
        if (e.kind === 'smash') {
            rallySmashes.set(e.id, e.player);
            stats[e.player].smashes++;
            tracking.handle(e, score, score);
            continue;
        }
        if (e.kind !== 'point' && e.kind !== 'unclassified' && e.kind !== 'double_fault')
            continue;
        let winningTeam;
        if (e.kind === 'point') {
            const s = stats[e.player];
            if (e.outcome === 'winner')
                s.winners++;
            else
                s[e.outcome]++;
            if (e.assistBy !== undefined)
                stats[e.assistBy].assists++;
            if (e.forcedBy !== undefined)
                stats[e.forcedBy].forcedErrorsCreated++;
            if (e.netTouch || e.netCord)
                s.netTouches++;
            if (e.recovery)
                s.recoveryWinners++;
            if (e.smashRecovery)
                s.smashRecoveryWinners++;
            if (e.netCord === 'lucky')
                s.luckyNetCords++;
            if (e.netCord === 'unlucky')
                s.unluckyNetCords++;
            const shot = e.shot ?? (e.smash ? 'smash' : 'unrecorded');
            const shotStats = s.shots[shot] ?? (s.shots[shot] = { winners: 0, unforced: 0, forced: 0 });
            if (e.outcome === 'winner')
                shotStats.winners++;
            else
                shotStats[e.outcome]++;
            if (e.smashAttemptId !== undefined && (!e.smash || rallySmashes.get(e.smashAttemptId) !== e.player))
                throw Error('Choose a smash attempt by this player in the current rally.');
            if (e.smash) {
                if (!e.smashAttemptId)
                    s.smashes++;
                if (e.outcome === 'winner') {
                    s.smashWinners++;
                    s.smashPointsWon++;
                }
                else
                    s.smashErrors++;
            }
            if (e.outcome !== 'winner' && e.previousShot === 'smash' && e.previousPlayer !== undefined) {
                const prior = stats[e.previousPlayer];
                // The last smash by this opponent in this rally is the attributed attempt.
                // If it was not tapped, the explicit previous-stroke observation supplies it.
                if (![...rallySmashes.values()].includes(e.previousPlayer))
                    prior.smashes++;
                prior.smashErrorsGenerated++;
                prior.smashPointsWon++;
            }
            winningTeam = e.outcome === 'winner' ? teamOf(e.player) : teamOf(e.player) === 'a' ? 'b' : 'a';
        }
        else if (e.kind === 'double_fault') {
            winningTeam = score.servingTeam === 'a' ? 'b' : 'a';
        }
        else {
            winningTeam = e.team;
            unclassified++;
        }
        rallySmashes.clear();
        const before = score;
        score = apply(score, { kind: 'point_for', team: winningTeam });
        points++;
        tracking.handle(e, before, score, winningTeam);
        if (changesEnds(before, score))
            near = near === 'a' ? 'b' : 'a';
    }
    return { ready, arrivals, settings, score, near, swapped, stats, points, unclassified, tracking: tracking.data, server: [0, 2, 1, 3][score.servingPlayer] };
}
export function changesEnds(before, after) {
    if (before.phase === 'tiebreak' || before.phase === 'super-tiebreak') {
        // A completed tie-break has one changeover, including when its final point
        // lands on a multiple of six. Do not count that boundary twice.
        if (after.phase !== before.phase)
            return true;
        return (Number(after.currentGame.a) + Number(after.currentGame.b)) % 6 === 0;
    }
    const i = before.sets.length - 1, prev = before.sets[i], next = after.sets[i];
    return next.a + next.b !== prev.a + prev.b && (next.a + next.b) % 2 === 1;
}
export function validateSeed(v) {
    if (!v || !Array.isArray(v.sets) || v.sets.length < 1 || v.sets.length > 3 || !['playing', 'tiebreak'].includes(v.phase) || !Number.isInteger(v.returns) || v.returns < 0 || v.returns > 2 || !Number.isInteger(v.server) || v.server < 0 || v.server > 3)
        throw Error('Invalid scoreboard setup.');
    const won = { a: 0, b: 0 };
    v.sets.forEach((s, i) => {
        if (!s || ![s.a, s.b].every(x => Number.isInteger(x) && x >= 0 && x <= 7))
            throw Error('Games must be between 0 and 7.');
        const complete = (Math.max(s.a, s.b) === 6 && Math.min(s.a, s.b) <= 4) || (Math.max(s.a, s.b) === 7 && [5, 6].includes(Math.min(s.a, s.b)));
        if (i < v.sets.length - 1) {
            if (!complete)
                throw Error('Enter valid completed sets, such as 6-4 or 7-6.');
            won[s.a > s.b ? 'a' : 'b']++;
        }
        else if (complete || s.a === 7 || s.b === 7)
            throw Error('Put completed sets in the completed-sets field and start the current set at 0–0.');
    });
    if (won.a >= 2 || won.b >= 2)
        throw Error('A completed match cannot be used as a starting score.');
    const last = v.sets.at(-1);
    if ((last.a === 6 && last.b === 6) !== (v.phase === 'tiebreak'))
        throw Error('Use tie-break scoring only at 6–6.');
    if (!v.game)
        throw Error('Points are required.');
    if (v.phase === 'tiebreak') {
        if (![v.game.a, v.game.b].every(p => Number.isInteger(p) && Number(p) >= 0 && Number(p) <= 100) || Math.max(Number(v.game.a), Number(v.game.b)) >= 7 && Math.abs(Number(v.game.a) - Number(v.game.b)) >= 2)
            throw Error('Enter an unfinished tie-break score.');
    }
    else {
        if (![v.game.a, v.game.b].every(p => [0, 15, 30, 40, 'Adv'].includes(p)))
            throw Error('Points must be 0, 15, 30, 40 or Adv.');
        if (v.game.a === 'Adv' && v.game.b !== 40 || v.game.b === 'Adv' && v.game.a !== 40)
            throw Error('Advantage requires 40 for the opposing pair.');
    }
    return v;
}
