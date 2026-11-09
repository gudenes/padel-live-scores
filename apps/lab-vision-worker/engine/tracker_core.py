"""Shared geometry, detection and assignment for the player tracker.

track_one.py and diag_coverage.py both need exactly this, and until now both
carried their own copy. Copied logic drifts, and a diagnostic that has drifted
from the thing it diagnoses reports on code nobody runs -- so it lives here
once.

Two decisions in here were measured rather than chosen:

**Assignment is optimal, not greedy.** The greedy version came with a comment
claiming that with four tracks and a speed gate the two agree. They do not:
26% of all lost detections were a good blob sitting next to the right track and
being taken by another one. With at most four of each, exhaustive search is
optimal, costs a few hundred comparisons, and needs no dependency.

**The speed gate scales with depth.** A constant gate in metres is a constant
only in metres: the position of a far player is derived from a foot estimate
good to about 13 px, and 13 px is 0.26 m at the near baseline and 0.85 m at the
far one. A gate of 1.08 m therefore rejects a STANDING far player as a
teleport, which is why the far half lost twice as many detections as the near
half -- the same ratio as the noise.
"""

import math
import os

import cv2
import numpy as np

W, L = 10.0, 20.0
ORDER = ["tl", "tr", "br", "bl"]
DEST = np.array([[0, 0], [W, 0], [W, L], [0, L]], np.float32)

THRESH = 38
MIN_AREA = 250
# K_NOMINAL comes from the NET, not from the players.
#
# The net is 0.92 m at the posts and 0.88 m at the centre, by rule, and it does
# not move, crouch or jump. Three hand-marked pairs agree on 0.195 to within
# 1%. The previous value, 0.106, was fitted to the players -- whose height was
# assumed to be 1.80 m, and whose blobs are split in two by the net's mesh, so
# what got measured was the larger fragment: legs and shorts. Calibrating a
# person's height on their legs understates it by exactly the factor observed,
# 1.84.
#
# That error survived a check that could not fail: k was fitted from truncated
# blob tops and then "validated" by deriving the feet from those same truncated
# tops, so the error cancelled and the answer came out 3 px from the hand
# marking. A circular test is worse than no test, because it grants confidence.
MARGIN, K_NOMINAL, HEAD_ROOM = 0.3, 0.195, 1.7
SMALL = (480, 270)
GATE_R, GATE_SHIFT, GATE_MOTION = 0.15, 3.0, 1.5
MAX_SPEED = 9.0
MAX_MISS, REACQUIRE, NET_SLACK = 12, 4, 1.0
AMBIG_M = 0.6         # cost margin under which a within-pair pairing is a toss
PIXEL_ERR = 13.0      # measured: mean |derived foot - hand marked foot|

KERN_O = np.ones((5, 5), np.uint8)
# Tall, not square: the net's dark mesh splits a player into torso and legs.
# A wide kernel would instead glue two players side by side into one blob.
KERN_C = np.ones((27, 9), np.uint8)


def grey_small(f):
    return cv2.cvtColor(cv2.resize(f, SMALL), cv2.COLOR_BGR2GRAY).astype(np.float32)


class Court:
    def __init__(self, court_marks, shape):
        src = np.array([[court_marks[o]["x"], court_marks[o]["y"]] for o in ORDER],
                       np.float32)
        self.H = cv2.getPerspectiveTransform(src, DEST)
        self.Hi = np.linalg.inv(self.H)
        h, w = shape[:2]
        box = np.array([[[-MARGIN, -MARGIN], [W + MARGIN, -MARGIN],
                         [W + MARGIN, L + MARGIN], [-MARGIN, L + MARGIN]]], np.float32)
        poly = cv2.perspectiveTransform(box, self.Hi)[0].astype(np.float32)
        # A tracking mask is a volume: a player at the far baseline projects
        # ABOVE it, and a floor polygon decapitates them.
        for i in (0, 1):
            px, py = poly[i]
            poly[i][1] = py - HEAD_ROOM * K_NOMINAL * (py - self.horizon_y(px))
        self.poly = poly.astype(np.int32)
        self.mask = np.zeros((h, w), np.uint8)
        cv2.fillPoly(self.mask, [self.poly], 255)

    def horizon_y(self, px):
        a, b, c = self.H[2]
        return -(a * px + c) / b

    def to_court(self, px, py):
        p = cv2.perspectiveTransform(np.array([[[px, py]]], np.float32), self.H)[0][0]
        return float(p[0]), float(p[1])

    def to_pixel(self, cx, cy):
        p = cv2.perspectiveTransform(np.array([[[cx, cy]]], np.float32), self.Hi)[0][0]
        return float(p[0]), float(p[1])

    def noise_m(self, cx, cy):
        """How many metres PIXEL_ERR of vertical error is worth, right here."""
        px, py = self.to_pixel(cx, cy)
        qx, qy = self.to_court(px, py + PIXEL_ERR)
        return float(np.hypot(qx - cx, qy - cy))

    def detect(self, frame, bg):
        """Blobs inside the mask, as court positions, largest first."""
        g = cv2.cvtColor(cv2.absdiff(frame, bg), cv2.COLOR_BGR2GRAY)
        _, m = cv2.threshold(g, THRESH, 255, cv2.THRESH_BINARY)
        m = cv2.bitwise_and(m, self.mask)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, KERN_O)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, KERN_C)
        n, _, st, ct = cv2.connectedComponentsWithStats(m, 8)
        big, small = [], []
        for j in range(1, n):
            s, c = st[j], ct[j]
            # Feet from the BASE of the blob, not from the head.
            #
            # Deriving the feet from the head needs a known height, and a padel
            # player never has one: they play crouched. Measured on the seed
            # frame, all four sat at 1.3-1.4 m of apparent height, not 1.8 --
            # posture changes it every frame. The base is posture-free and
            # lands 16 px from the hand markings.
            #
            # The base's one failure mode is a floor reflection or shadow
            # joining on underneath, which used to add ~90 px. That is now
            # detectable: with a correctly calibrated k an upright person
            # cannot be taller than about 2.3 m, so anything longer is clipped
            # back rather than believed.
            top, base = s[1], s[1] + s[3]
            fd = base - self.horizon_y(c[0])
            max_h = K_NOMINAL * (2.3 / 1.8) * fd
            if s[3] > max_h:
                base = top + max_h
            cx, cy = self.to_court(c[0], base)
            if not (-1.0 <= cx <= W + 1.0 and -1.0 <= cy <= L + 1.0):
                continue
            (big if s[4] >= MIN_AREA else small).append(
                {"pos": (cx, cy), "area": int(s[4])})
        big.sort(key=lambda b: -b["area"])
        return big, small


class Kalman:
    """Constant-velocity filter whose trust in a measurement depends on WHERE.

    A moving average smooths every sample by the same amount, which is wrong on
    a court seen in perspective: the same 16 px of foot error is 0.33 m at the
    near baseline and 0.83 m at the far one. Smoothing both identically left the
    far pair reading 83 m/min against the near pair's 47 -- a 75% split that is
    the camera, not the players.

    Here the measurement variance R is set per sample from the local geometry,
    so a far measurement is believed less and the prediction carries more of the
    answer. Nothing is invented: the far position stays uncertain, it just stops
    being treated as if it were as good as a near one.
    """

    def __init__(self, pos, sigma_pos, sigma_vel=2.0):
        self.x = np.array([pos[0], pos[1], 0.0, 0.0], float)
        self.P = np.diag([sigma_pos ** 2, sigma_pos ** 2,
                          sigma_vel ** 2, sigma_vel ** 2]).astype(float)

    def predict(self, dt, sigma_a=3.0):
        F = np.eye(4)
        F[0, 2] = F[1, 3] = dt
        q = sigma_a ** 2
        Q = q * np.array([
            [dt ** 4 / 4, 0, dt ** 3 / 2, 0],
            [0, dt ** 4 / 4, 0, dt ** 3 / 2],
            [dt ** 3 / 2, 0, dt ** 2, 0],
            [0, dt ** 3 / 2, 0, dt ** 2]])
        self.x = F @ self.x
        self.P = F @ self.P @ F.T + Q

    def update(self, z, sigma_m):
        H = np.zeros((2, 4))
        H[0, 0] = H[1, 1] = 1.0
        R = np.eye(2) * sigma_m ** 2
        y = np.asarray(z, float) - H @ self.x
        S = H @ self.P @ H.T + R
        K = self.P @ H.T @ np.linalg.inv(S)
        self.x = self.x + K @ y
        self.P = (np.eye(4) - K @ H) @ self.P

    @property
    def pos(self):
        return self.x[:2]

    @property
    def speed(self):
        return float(np.hypot(self.x[2], self.x[3]))

    @property
    def pos_std(self):
        return float(np.sqrt(max(self.P[0, 0] + self.P[1, 1], 0.0)))


# Depois de quanto tempo cego a posicao prevista deixa de significar algo.
# Medido: a autocorrelacao da velocidade nestas trilhas e 0,18 a 1 s.
RESGATE_S = 1.0

_LOG_ASSIGN = None
if os.environ.get("LOG_ASSIGN"):
    _a, _b = os.environ["LOG_ASSIGN"].split("-")
    _LOG_ASSIGN = (int(_a), int(_b))


def gate_for(court, track, dt):
    """How far this track could plausibly be from its prediction.

    Physics plus uncertainty. The filter already tracks how unsure it is -- a
    track coasting through a gap widens its own covariance every step -- so the
    reacquisition allowance falls out of the state instead of being a hand-tuned
    multiplier on a miss counter.
    """
    kf = track["kf"]
    cx, cy = kf.pos
    reach = MAX_SPEED * dt
    return reach + 3.0 * float(np.hypot(kf.pos_std, court.noise_m(cx, cy)))


def feasible(court, track, det_pos, dt):
    """Same half of the net, and within the depth-aware gate."""
    if track["near"] and det_pos[1] < L / 2 - NET_SLACK:
        return None
    if not track["near"] and det_pos[1] > L / 2 + NET_SLACK:
        return None
    d = float(np.hypot(*(np.array(det_pos) - track["kf"].pos)))
    return d if d <= gate_for(court, track, dt) else None


def assign(court, tracks, names, dets, dt):
    """Optimal matching: most tracks matched first, then shortest total move.

    Coverage is the objective that matters, so the count is maximised before
    the distance is minimised -- a pairing that matches three tracks always
    beats one that matches two, however tidy the two look. Greedy came with a
    comment claiming it agreed with the optimum here; it did not, and the
    disagreement was 26% of every lost detection.
    """
    cost = {}
    for n in names:
        for j, d in enumerate(dets):
            c = feasible(court, tracks[n], d["pos"], dt)
            if c is not None:
                cost[(n, j)] = c

    best = {"count": -1, "cost": 0.0, "map": {}}

    def walk(i, used, cur, total):
        if i == len(names):
            if (len(cur) > best["count"]
                    or (len(cur) == best["count"] and total < best["cost"])):
                best.update(count=len(cur), cost=total, map=dict(cur))
            return
        n = names[i]
        # Bound: even matching everything left cannot beat the incumbent.
        if len(cur) + (len(names) - i) < best["count"]:
            return
        for j in range(len(dets)):
            if j in used or (n, j) not in cost:
                continue
            cur[n] = j
            walk(i + 1, used | {j}, cur, total + cost[(n, j)])
            del cur[n]
        walk(i + 1, used, cur, total)

    walk(0, frozenset(), {}, 0.0)
    m = dict(best["map"])

    # Partners cross, and when they do they come within 7 cm of each other.
    # At that moment the two blobs are interchangeable and picking the cheaper
    # pairing is a coin toss -- one that never gets corrected, because after a
    # swap both tracks stay equally plausible forever.
    #
    # So when the swapped pairing costs about the same, neither is taken. Both
    # tracks coast on the velocity the filter already holds, which carries them
    # through the crossing and lets them re-attach once they separate. Refusing
    # to answer is the only honest option when the measurement cannot tell.
    #
    # The earlier check on this reported "0% ambiguous" and was believed. The
    # raw counts were 2 and 3 -- and three coin tosses are three chances to
    # mislabel the rest of a match. A rate was the wrong statistic for an event
    # whose damage is permanent.
    for side in (True, False):
        pair = [n for n in names if tracks[n]["near"] == side and n in m]
        if len(pair) != 2:
            continue
        a, b = pair
        chosen = cost[(a, m[a])] + cost[(b, m[b])]
        sw_a, sw_b = cost.get((a, m[b])), cost.get((b, m[a]))
        if sw_a is None or sw_b is None:
            continue
        if abs((sw_a + sw_b) - chosen) < AMBIG_M:
            del m[a]
            del m[b]
    return m


def changeovers(match):
    """When the pairs swap ends, from the score we already read.

    Ends change after the first game of a set and then after every two -- so
    before any game whose set already holds an odd number of games. Nothing
    here is inferred from the video: the scoreboard states it.

    A score can only move forwards. The last game block of match 1 reports
    "set 1, 6-3" after set 2 had already reached 5-1 -- a misread, and one that
    would have flipped all four identities at 83.2 min for no reason. A block
    that goes backwards is dropped rather than trusted: a scoreboard reading is
    evidence, and evidence that contradicts the game itself is a bad reading.
    """
    out = []
    best_set = best_played = -1
    for g in match["detail"]:
        ga, gb = g.get("games_a"), g.get("games_b")
        if not ga or not gb:
            continue
        try:
            played, set_i = int(ga[-1]) + int(gb[-1]), len(ga)
        except (ValueError, TypeError):
            continue
        if set_i < best_set or (set_i == best_set and played < best_played):
            print(f"  placar retrocede em {g['from_ms']/60000:.1f}min "
                  f"(set {set_i}, {played} games) -- bloco ignorado")
            continue
        best_set, best_played = set_i, played
        if played % 2 == 1:
            out.append(int(g["from_ms"]))
    return sorted(set(out))


def mirror(pos):
    """Where a player lands after changing ends, keeping their own side.

    Changing ends rotates the court 180 degrees, so venue coordinates mirror in
    both axes. A player's own left and right mirror with them: whoever played
    the left side still plays the left side, which from a fixed camera means
    they cross to the opposite x. That turns an unresolvable question -- which
    of two identically dressed partners is which after they walked off court --
    into a prediction that can be right or wrong.
    """
    return np.array([W - pos[0], L - pos[1]], float)


class PoseDetector:
    """Feet from a pose model's ankle joints, in place of a blob's bottom edge.

    Same output shape as Court.detect, so everything downstream -- filter,
    assignment, changeovers, metrics -- is untouched and the comparison isolates
    the detector.

    Two settings are not defaults and both were measured. The frame is CROPPED
    to the court: the model resizes its input, and feeding it 1920x1080 at the
    default 640 shrank a far player to 22 px and found nobody at all. And imgsz
    is 1280: at 640 the crop still found nothing, at 1280 it finds all four, and
    1920 costs more for one extra detection that is usually a spectator.

    Ankles beat a blob base because they are a joint, not the end of a smear:
    no floor reflection, no shadow, no dependence on a standing height that
    changes every frame in a sport played crouched.
    """

    ANKLES = (15, 16)          # COCO keypoint order
    MIN_KP_CONF = 0.3

    def __init__(self, court, weights=None, imgsz=1280, conf=0.25, device=None):
        import os as _os
        # The model is a parameter, not a path buried in a call site. YOLO11 was
        # chosen to see whether the cheapest option sufficed; comparing it with
        # anything else must not require editing code, or the comparison will
        # not be run.
        weights = weights or _os.path.join(
            "/Volumes/Crucial/dev/padelgod/video/models",
            _os.environ.get("POSE_MODEL", "yolo26n-pose.pt"))
        # Recorded so a rendered bundle can say which model produced it. Two
        # bundles rendered by different models and labelled identically are two
        # bundles that will be compared as if they were the same thing.
        self.weights_name = _os.path.basename(weights)
        from ultralytics import YOLO
        import torch
        self.court = court
        self.model = YOLO(weights)
        self.imgsz, self.conf = imgsz, conf
        # CUDA first: on a Linux box with an NVIDIA card the old mps-or-cpu
        # choice silently fell through to CPU, turning the fastest machine in
        # the room into the slowest.
        self.device = device or ("cuda" if torch.cuda.is_available()
                                 else "mps" if torch.backends.mps.is_available()
                                 else "cpu")
        x, y, w, h = cv2.boundingRect(court.poly)
        pad = 20
        self.x0, self.y0 = max(0, x - pad), max(0, y - pad)
        self.x1 = min(court.mask.shape[1], x + w + pad)
        self.y1 = min(court.mask.shape[0], y + h + pad)
        self.off = np.array([self.x0, self.y0], np.float32)

        # NUNCA ENCOLHER O RECORTE. `imgsz` fixo em 1280 parecia generoso e era
        # uma reducao disfarcada: a Court 3 tem recorte de 1788 px (camera mais
        # baixa, perspectiva mais aberta), entao o detector recebia 72% do que
        # existia. Medido num quadro, so mudando este numero:
        #
        #     imgsz    ICARDO(fundo)   JENSEN(fundo)
        #      1280        0,32         nao achou
        #      1920        0,83           0,31
        #
        # As duas de perto nao se mexem (0,88 -> 0,92): quem e grande sobrevive
        # ao encolhimento, e por isso o defeito passou despercebido em quatro
        # partidas -- a cobertura media continuava alta enquanto a dupla do
        # fundo despencava. Paris (1440) e Madrid (1527) tambem eram encolhidas,
        # so que menos.
        #
        # O piso continua sendo o `imgsz` recebido: recorte pequeno com imgsz
        # pequeno volta a esconder gente, que foi o defeito original de 640.
        alvo = max(self.imgsz, self.x1 - self.x0, self.y1 - self.y0)
        alvo = -(-alvo // 32) * 32            # o modelo exige multiplo de 32
        self.imgsz = int(os.environ.get("POSE_IMGSZ", alvo))

        # Tiling: run the far half on its own.
        #
        # The model resizes whatever it is given to imgsz, so a far player is
        # competing for resolution with the whole court. She is 65 px tall in a
        # 1643 px wide crop; alone in a crop of her own half she is the same 65
        # px in maybe 500, which is several times the effective resolution.
        # That is where the coverage hole is -- one player at 65% against 95%
        # for the two near ones -- and no change of model fixes a player who
        # was too small to see.
        self.tile = os.environ.get("TILE", "0") == "1"
        if self.tile:
            mid = [court.to_pixel(cx, L / 2) for cx in (0, W)]
            ymid = int(max(p[1] for p in mid)) + pad
            self.tiles = [(self.x0, self.y0, self.x1, min(self.y1, ymid)),
                          (self.x0, max(self.y0, ymid - 2 * pad), self.x1, self.y1)]
        else:
            self.tiles = [(self.x0, self.y0, self.x1, self.y1)]

    def _infer(self, frame, box):
        x0, y0, x1, y1 = box
        r = self.model(frame[y0:y1, x0:x1], classes=[0], conf=self.conf,
                       imgsz=self.imgsz, verbose=False, device=self.device)[0]
        return r, np.array([x0, y0], np.float32)

    def __call__(self, frame, _bg=None):
        found = []
        for box in self.tiles:
            r, off = self._infer(frame, box)
            found.extend(self._people(r, off, frame))
        if len(self.tiles) > 1:
            found = self._dedupe(found)
        found.sort(key=lambda d: -d["conf"])
        return found, []

    @staticmethod
    def _dedupe(people, min_sep=1.2):
        """A player near the net appears in both tiles; keep the confident one."""
        keep = []
        for p in sorted(people, key=lambda d: -d["conf"]):
            if all(np.hypot(p["pos"][0] - q["pos"][0],
                            p["pos"][1] - q["pos"][1]) > min_sep for q in keep):
                keep.append(p)
        return keep

    def _people(self, r, off, frame):
        out = []
        kp = r.keypoints
        if kp is None or kp.xy is None:
            return out
        xy = kp.xy.cpu().numpy()
        cf = (kp.conf.cpu().numpy() if kp.conf is not None
              else np.ones(xy.shape[:2], np.float32))
        bconf = r.boxes.conf.cpu().numpy()
        boxes = r.boxes.xyxy.cpu().numpy()
        h_img, w_img = frame.shape[:2]
        for i in range(len(xy)):
            a = [(xy[i][j], cf[i][j]) for j in self.ANKLES
                 if cf[i][j] > self.MIN_KP_CONF]
            if not a:
                continue
            foot = np.average([p for p, _ in a], axis=0,
                              weights=[c for _, c in a]) + off
            ix = int(np.clip(foot[0], 0, w_img - 1))
            iy = int(np.clip(foot[1], 0, h_img - 1))
            # Judged where the FEET are, not where the box is: a spectator
            # behind the glass has a box over the court and feet that are not.
            if self.court.mask[iy, ix] == 0:  # noqa
                continue
            cx, cy = self.court.to_court(float(foot[0]), float(foot[1]))
            if not (-1.0 <= cx <= W + 1.0 and -1.0 <= cy <= L + 1.0):
                continue
            bw, bh = boxes[i][2] - boxes[i][0], boxes[i][3] - boxes[i][1]
            # Keypoints travel with the detection, in FRAME coordinates. The
            # playback needs them to draw a skeleton, and converting once here
            # is the only place that knows about the crop offset.
            kp = [[float(xy[i][j][0] + off[0]),
                   float(xy[i][j][1] + off[1]),
                   float(cf[i][j])] for j in range(len(xy[i]))]
            out.append({"pos": (cx, cy), "area": int(bw * bh),
                        "conf": float(bconf[i]), "kp": kp})
        return out


class RFDetrDetector(PoseDetector):
    """Same contract as PoseDetector, different model underneath.

    RF-DETR is worth testing for a reason beyond accuracy: it is Apache 2.0 and
    it does keypoints, so if it holds up it removes the licence question from
    the product entirely rather than trading one paid dependency for another.

    Keypoints are COCO-17, the same order YOLO uses, so ankle indices 15 and 16
    carry over and nothing downstream changes. Only this class knows which model
    produced the joints.

    Its keypoint head is a preview at the time of writing -- worth remembering
    if it behaves oddly, and a reason not to build on it before measuring.
    """

    def __init__(self, court, imgsz=1280, conf=0.25, device=None, **_):
        from rfdetr import RFDETRKeypointPreview
        self.court = court
        self.model = RFDETRKeypointPreview()
        self.imgsz, self.conf, self.device = imgsz, conf, "auto"
        x, y, w, h = cv2.boundingRect(court.poly)
        pad = 20
        self.x0, self.y0 = max(0, x - pad), max(0, y - pad)
        self.x1 = min(court.mask.shape[1], x + w + pad)
        self.y1 = min(court.mask.shape[0], y + h + pad)
        self.off = np.array([self.x0, self.y0], np.float32)

    def __call__(self, frame, _bg=None):
        crop = frame[self.y0:self.y1, self.x0:self.x1]
        kp = self.model.predict(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB),
                                threshold=self.conf)
        out = []
        xy = np.asarray(kp.xy)
        if xy.size == 0:
            return out, []
        kc = np.asarray(kp.keypoint_confidence)
        dc = np.asarray(kp.detection_confidence)
        boxes = np.asarray(kp.data["xyxy"])
        h_img, w_img = frame.shape[:2]
        for i in range(len(xy)):
            a = [(xy[i][j], kc[i][j]) for j in self.ANKLES
                 if kc[i][j] > self.MIN_KP_CONF]
            if not a:
                continue
            # self.off, not off: this class does not tile, so it has one fixed
            # offset. A blind text replace across the file rewrote both classes
            # at once because the line was identical in each, and only one of
            # them had grown a local `off`.
            foot = np.average([p for p, _ in a], axis=0,
                              weights=[c for _, c in a]) + self.off
            ix = int(np.clip(foot[0], 0, w_img - 1))
            iy = int(np.clip(foot[1], 0, h_img - 1))
            if self.court.mask[iy, ix] == 0:
                continue
            cx, cy = self.court.to_court(float(foot[0]), float(foot[1]))
            if not (-1.0 <= cx <= W + 1.0 and -1.0 <= cy <= L + 1.0):
                continue
            bw = boxes[i][2] - boxes[i][0]
            bh = boxes[i][3] - boxes[i][1]
            kps = [[float(xy[i][j][0] + self.off[0]),
                    float(xy[i][j][1] + self.off[1]),
                    float(kc[i][j])] for j in range(len(xy[i]))]
            out.append({"pos": (cx, cy), "area": int(bw * bh),
                        "conf": float(dc[i]), "kp": kps})
        out.sort(key=lambda d: -d["conf"])
        return out, []


class Tracker:
    """The tracking loop itself, so that everything driving it sees the same one.

    track_one.py measures and playback.html shows. If each carried its own copy
    of this the picture would eventually describe code nobody runs -- which is
    exactly how the coverage diagnostic drifted from the tracker earlier.
    """

    def __init__(self, court, seed, swaps=(), pairs=None, points=()):
        self.court = court
        self.names = list(seed)
        self.swaps = sorted(swaps)
        self.next_swap = 0
        self.tracks = {
            n: {"kf": Kalman(seed[n], court.noise_m(*seed[n])), "miss": 0,
                "near": seed[n][1] > L / 2, "swapped": 0}
            for n in self.names}

        # Re-anchoring identity at the start of every point.
        #
        # Within a pair, identity is the one thing geometry cannot recover: the
        # partners come within 7 cm of each other, wear the same kit, and once
        # confused stay confused for the rest of the match because both tracks
        # remain equally plausible. Seeding once and hoping is therefore a bet
        # that never gets a second chance.
        #
        # But padel restarts constantly, and at each restart the players are
        # apart, in position, and -- by strong convention -- on their own side.
        # Anchoring there turns a permanent error into one that lasts at most a
        # rally. The convention is a prior, not a law: players do switch sides,
        # so how often the anchor disagrees with the tracker is COUNTED and
        # reported rather than silently applied.
        self.pairs = [tuple(p) for p in (pairs or []) if len(p) == 2]
        self.points = sorted(points)
        self.next_point = 0
        self.reanchors = 0
        self.checks = 0
        # A player's own side, in a frame that survives changing ends: the same
        # mirror the swap uses, so a player who keeps their role keeps this
        # value whichever end they stand at.
        self.role = {n: (seed[n][0] if seed[n][1] > L / 2 else W - seed[n][0])
                     for n in self.names}
        self.cut_anchor = os.environ.get("CUT_ANCHOR", "0") == "1"
        self.serves = []
        self.next_serve = 0
        self.serve_fixes = self.serve_checks = 0
        # Coming back from a camera cut is the cheapest moment to re-anchor:
        # the tracker spent the whole cut coasting blind, so its positions are
        # a guess and nothing good is being overwritten. Whether the players
        # are actually back on their own sides by then is a claim about the
        # broadcast, not about the code, so it is COUNTED rather than assumed.
        self.was_cut = False
        self.cut_fixes = self.cut_checks = self.cut_returns = 0
        self.resgates = 0
        self._pending_serve = None
        self._pending_until = 0
        # WHICH games were corrected, not just how many. A counter says the
        # tracker was wrong six times; it does not say where to look. Reviewing
        # thirteen service games to find six is the difference between a number
        # and something anyone can check.
        self.serve_events = []

    def set_serves(self, serves):
        """Per-game server, read by name off the broadcast scoreboard.

        This is the strongest identity signal in the project and it does not
        come from the court at all. The serving player's name is dimmed on the
        scoreboard -- around 145 against 240 for the other three -- so it reads
        almost binary, where kit colour gave a margin of 0.11 against a
        frame-to-frame variation of 0.61.

        It also fires every service game rather than once per match, so a
        confusion picked up at a crossing survives until the next service game
        instead of contaminating everything after it.

        `serves` is [{ms, server, row}], row being which pair is serving.
        """
        self.serves = sorted(serves, key=lambda s: s["ms"])
        self.next_serve = 0
        self.serve_fixes = 0
        self.serve_checks = 0

    SERVE_WINDOW_MS = 20_000

    def _apply_serve(self, t, positions):
        """At a service game, the named server is the one at their own baseline.

        The server stands behind the baseline of the half their pair occupies,
        alone, waiting; their partner is at the net. So among the two tracks on
        the serving side, the deeper one IS the named player, and if the tracker
        has the other name there they are swapped.

        The check waits for a moment when that is actually visible instead of
        firing at one instant. The scoreboard timestamp is when a score was
        READ, not when the ball was struck -- by then the server has usually
        come forward and the depth difference has closed. Testing only that
        instant evaluated 2 of 16 service games; searching the opening of the
        game for the frame where the pair is most separated in depth uses the
        evidence when it exists rather than when it happens to be convenient.
        """
        while (self.next_serve < len(self.serves)
               and t >= self.serves[self.next_serve]["ms"]):
            self._pending_serve = self.serves[self.next_serve]
            self._pending_until = self.serves[self.next_serve]["ms"] + self.SERVE_WINDOW_MS
            self.next_serve += 1

        s = getattr(self, "_pending_serve", None)
        if s is not None and t <= getattr(self, "_pending_until", 0):
            name = s.get("server")
            if name not in self.tracks:
                self._pending_serve = None
                return
            mate = next((n for n in self.names
                         if n != name and self.tracks[n]["near"]
                         == self.tracks[name]["near"]), None)
            if mate is None:
                self._pending_serve = None
                return
            a, b = self.tracks[name], self.tracks[mate]
            if a["miss"] or b["miss"]:
                return            # coasting is a guess; wait for a real look
            # Depth from their own baseline: server deep, partner forward.
            own_base = L if a["near"] else 0.0
            da = abs(a["kf"].pos[1] - own_base)
            db = abs(b["kf"].pos[1] - own_base)
            if abs(da - db) < 2.0:
                return            # not separated enough yet; keep waiting
            self.serve_checks += 1
            fixed = da > db       # the named server is the FORWARD one: swapped
            if fixed:
                a["kf"], b["kf"] = b["kf"], a["kf"]
                self.serve_fixes += 1
            self.serve_events.append({
                "game_ms": int(s["ms"]), "at_ms": int(t), "server": name,
                "mate": mate, "fixed": bool(fixed),
                "depth_server": round(float(da), 2),
                "depth_mate": round(float(db), 2)})
            self._pending_serve = None

    @staticmethod
    def _canonical_x(pos):
        return pos[0] if pos[1] > L / 2 else W - pos[0]

    def _reanchor(self, t):
        """At a point start, put each pair back on its own sides."""
        while self.next_point < len(self.points) and t >= self.points[self.next_point]:
            self.next_point += 1
            for a, b in self.pairs:
                if a not in self.tracks or b not in self.tracks:
                    continue
                ta, tb = self.tracks[a], self.tracks[b]
                # Only when both are actually being seen: re-anchoring on a
                # coasted guess would launder the guess into a decision.
                if ta["miss"] or tb["miss"]:
                    continue
                xa = self._canonical_x(ta["kf"].pos)
                xb = self._canonical_x(tb["kf"].pos)
                if abs(xa - xb) < 1.5:
                    continue          # too close to call; leave it alone
                self.checks += 1
                expect_a_left = self.role[a] < self.role[b]
                if (xa < xb) != expect_a_left:
                    ta["kf"], tb["kf"] = tb["kf"], ta["kf"]
                    ta["near"], tb["near"] = tb["near"], ta["near"]
                    self.reanchors += 1

    def _apply_swaps(self, t):
        did = False
        while self.next_swap < len(self.swaps) and t >= self.swaps[self.next_swap]:
            for tr in self.tracks.values():
                tr["near"] = not tr["near"]
                # Position mirrored, confidence discarded: the walk off court
                # and back is not motion this filter saw.
                tr["kf"] = Kalman(mirror(tr["kf"].pos), sigma_pos=2.5)
                tr["miss"] = 0
                tr["swapped"] += 1
            self.next_swap += 1
            did = True
        return did

    def coast(self, dt):
        """Um quadro que nao e a camera principal: predizer, nunca medir.

        ATENCAO -- AQUI MORA UM DEFEITO CONHECIDO, E DUAS CORRECOES JA FALHARAM.
        Nao mexa neste metodo sem ler isto.

        O DEFEITO, medido. A extrapolacao corre solta pelo corte inteiro. Num
        corte de 6,2 s (t=553,7-560,0 s desta partida), COELLO saiu de y=15,9
        para y=25,9 -- seis metros DEPOIS da parede de fundo, numa quadra de
        20 m -- e TAPIA junto. Quando a camera voltou os corpos reais estavam a
        8 m da media fugida, o portao (calculado em volta DELA) os rejeitou, e
        as duas trilhas ficaram 25 s sem casar. O rali 4 perdeu metade dos
        golpes, e nada na tela denunciou.

        O QUE NAO FUNCIONOU:

          zerar a velocidade no primeiro quadro cego -- consertou o rali 4 e o
          32 e QUEBROU o 14 e o 15; o rali 1 caiu de 17 para 8 propostas;
          quatro ralis sumiram; 19 dos 45 rotulos humanos ficaram orfaos, e
          nenhum foi recuperavel por proximidade de instante.

          decair a velocidade com o tempo medido de decorrelacao (0,8 s) --
          pior ainda: 2486 amostras dentro dos ralis contra 2554 do zeramento
          e 2540 sem conserto nenhum.

        A LICAO. Os dois mexiam em TODO corte para consertar os longos, e os
        curtos sao a maioria esmagadora -- a extrapolacao serve neles. O
        conserto certo nao e mudar como a media anda: e deixar uma trilha que
        JA esta sem casar reencontrar um corpo livre, o que so pode transformar
        "nenhuma amostra" em "alguma amostra" e nao tem como tirar nada.
        """
        self.was_cut = True
        for tr in self.tracks.values():
            tr["kf"].predict(dt)
            tr["miss"] += 1

    def _resgata(self, m, dets, dt):
        """Uma trilha FAMINTA pega uma deteccao LIVRE do seu lado da rede.

        O buraco que isto fecha: durante um corte longo a extrapolacao leva a
        media para longe (num caso medido, seis metros depois da parede de
        fundo), e o portao -- que e calculado em volta DELA -- passa a rejeitar
        justamente o corpo certo. A trilha fica sem casar ate que outra regra a
        salve, 25 s depois. Metade dos golpes daquele rali nunca existiu.

        POR QUE ESTA REGRA NAO PODE PIORAR NADA. Ela so olha trilhas que JA
        estao sem casar e deteccoes que JA sobraram. Uma trilha que esta casando
        normalmente nunca entra aqui, e uma deteccao ja atribuida nunca e
        roubada -- entao o unico efeito possivel e transformar "nenhuma
        amostra" em "alguma amostra". Foi exatamente isso que faltou nas duas
        tentativas anteriores, que mexiam em TODO corte para consertar os
        longos e estragavam os curtos, onde a extrapolacao serve.

        O LIMIAR VEM DE MEDIDA. A autocorrelacao da velocidade nestas trilhas e
        0,18 a 1 s: passado um segundo cego, a posicao prevista nao descreve
        mais onde a pessoa esta, e o portao em volta dela nao significa nada.
        Antes disso a extrapolacao e boa e nao se mexe nela.

        A REDE CONTINUA VALENDO. O resgate respeita o lado: ninguem atravessa a
        rede durante um ponto, e ignorar isso para salvar um vinculo poria o
        rotulo humano no jogador errado -- o defeito mais caro deste projeto.
        """
        livres = [j for j in range(len(dets)) if j not in m.values()]
        if not livres:
            return 0

        def mesmo_lado(tr, pos):
            if tr["near"]:
                return pos[1] >= L / 2 - NET_SLACK
            return pos[1] <= L / 2 + NET_SLACK

        famintas = [n for n in self.names
                    if n not in m and self.tracks[n]["miss"] * dt >= RESGATE_S]
        # A mais faminta escolhe primeiro: ela e a que tem menos chance de
        # estar certa por conta propria.
        famintas.sort(key=lambda n: -self.tracks[n]["miss"])
        feitos = 0
        for n in famintas:
            tr = self.tracks[n]
            cands = [j for j in livres if mesmo_lado(tr, dets[j]["pos"])]
            if not cands:
                continue
            j = min(cands, key=lambda k: float(np.hypot(
                *(np.array(dets[k]["pos"]) - tr["kf"].pos))))
            livres.remove(j)
            z = dets[j]["pos"]
            # RE-ANCORA, nao atualiza: a media estava a metros de distancia e
            # um `update` a arrastaria devagar, gastando mais quadros para
            # chegar onde a medida ja diz que a pessoa esta. A velocidade vai a
            # zero porque nao se sabe nada sobre ela depois do escuro.
            tr["kf"] = Kalman(z, self.court.noise_m(*z))
            tr["miss"] = 0
            m[n] = j
            self.resgates += 1
            feitos += 1
        return feitos

    def _fix_sides(self):
        """Put each pair back on its own sides. Returns how many it moved."""
        moved = 0
        for a, b in self.pairs:
            if a not in self.tracks or b not in self.tracks:
                continue
            ta, tb = self.tracks[a], self.tracks[b]
            xa = self._canonical_x(ta["kf"].pos)
            xb = self._canonical_x(tb["kf"].pos)
            if abs(xa - xb) < 1.5:
                continue          # too close to call; leave it alone
            self.cut_checks += 1
            if (xa < xb) != (self.role[a] < self.role[b]):
                ta["kf"], tb["kf"] = tb["kf"], ta["kf"]
                ta["near"], tb["near"] = tb["near"], ta["near"]
                moved += 1
        return moved

    def step(self, t, dets, dt):
        swapped = self._apply_swaps(t)
        # First main-camera frame after a cut.
        if self.was_cut and self.pairs and self.cut_anchor:
            self.cut_returns += 1
            self.cut_fixes += self._fix_sides()
        self.was_cut = False
        # Serve first: it names a player, where the side convention only guesses
        # one. A weaker rule must not get to move things before a stronger one.
        self._apply_serve(t, None)
        self._reanchor(t)
        for tr in self.tracks.values():
            tr["kf"].predict(dt)
        m = assign(self.court, self.tracks, self.names, dets, dt)
        self._resgata(m, dets, dt)
        # Diagnostico sob demanda: por que uma trilha ficou sem deteccao num
        # quadro em que o detector achou gente. Fica atras de env porque e
        # barulhento e so serve quando se esta investigando um buraco.
        if _LOG_ASSIGN and _LOG_ASSIGN[0] <= t <= _LOG_ASSIGN[1]:
            livres = [j for j in range(len(dets)) if j not in m.values()]
            print(f"[assign] t={t/1000:7.1f}s dets={len(dets)} casadas={len(m)}", end="")
            for n in self.names:
                tr = self.tracks[n]
                cx, cy = tr["kf"].pos
                print(f" | {n[:4]} {'perto' if tr['near'] else 'fundo'}"
                      f" ({cx:.1f},{cy:.1f}) miss={tr['miss']}"
                      f" {'OK' if n in m else 'SEM'}", end="")
            if livres:
                print("  livres=" + " ".join(
                    f"({dets[j]['pos'][0]:.1f},{dets[j]['pos'][1]:.1f})" for j in livres),
                    end="")
            print(flush=True)
        for n in self.names:
            tr = self.tracks[n]
            if n in m:
                z = dets[m[n]]["pos"]
                # R from the geometry at the measured point: the same foot
                # error is worth 0.33 m near and 0.83 m far.
                tr["kf"].update(z, self.court.noise_m(*z))
                tr["miss"] = 0
            else:
                tr["miss"] += 1
        return {"match": m, "swapped": swapped}


def build_background(cap, start_ms, dur_ms, samples=40):
    """Median of main-camera frames only; a close-up poisons every subtraction."""
    bg = []
    for i in range(samples):
        cap.set(cv2.CAP_PROP_POS_MSEC, start_ms + dur_ms * i / samples)
        ok, f = cap.read()
        if not ok:
            continue
        a = grey_small(f)
        for _ in range(50):
            cap.grab()
        ok, b = cap.retrieve()
        if not ok:
            continue
        gb = grey_small(b)
        (dx, dy), r = cv2.phaseCorrelate(a, gb)
        if (abs(dx) <= GATE_SHIFT and abs(dy) <= GATE_SHIFT and r >= GATE_R
                and float(np.abs(a - gb).mean()) >= GATE_MOTION):
            bg.append(f)
    return np.median(np.stack(bg), axis=0).astype(np.uint8), len(bg)


def is_main_camera(frame, bg_small):
    """Gate against the background, which IS the main camera by construction."""
    (dx, dy), r = cv2.phaseCorrelate(grey_small(frame), bg_small)
    return abs(dx) <= GATE_SHIFT and abs(dy) <= GATE_SHIFT and r >= GATE_R
