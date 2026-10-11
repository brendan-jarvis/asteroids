import {
  AmbientLight,
  Color,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Object3D,
  OrthographicCamera,
  ACESFilmicToneMapping,
  PointLight,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer,
} from "three";
import { createAudio } from "@/game/audio";
import { bindHapticLabel, haptic, setHapticsEnabled } from "@/game/haptics";
import {
  makeBullet,
  makeField,
  makeGlowTexture,
  makeRock,
  makeShip,
  makeSpark,
  makeStars,
  makeUfo,
  retintBullet,
  type BulletView,
  type RockView,
  type ShipView,
  type UfoView,
} from "@/game/meshes";
import type { ActionName, GameApi, Hud, Phase } from "@/game/types";

const FIELD = 64;
const HALF = FIELD / 2;
const STEP = 1 / 60;
const SHIP_R = 1.55;
const ACCEL = 28;
const MAX_SPEED = 24;
const TURN = 3.7;
const BULLET_SPEED = 46;
const BULLET_LIFE = 0.62;
const FIRE_GAP = 0.2;
const SCORES = [20, 50, 100] as const;
const RADII = [6.1, 3.15, 1.75] as const;
const ROCK_SPEED = [8.2, 12.5, 16.5] as const;
const SAVE_KEY = "asteroids-revision-v1";
const ICE = 0x6ae4ff;
const EMBER = 0xff9a3c;

type Rock = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  gen: 0 | 1 | 2;
  radius: number;
  alive: boolean;
  view: RockView;
};

type Ufo = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  kind: "large" | "small";
  radius: number;
  score: number;
  fireT: number;
  dirT: number;
  age: number;
  view: UfoView;
};

type Bullet = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  age: number;
  owner: "player" | "ufo";
  alive: boolean;
  view: BulletView;
};

type Spark = {
  sprite: Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
};

type Save = { v: 1; best: number; sound: boolean; haptics: boolean };

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      setSteer?: (v: number) => void;
      setKeys?: (codes: string[]) => void;
    };
  }
}

export function createGame(opts: {
  canvas: HTMLCanvasElement;
  root: HTMLElement;
  popups: HTMLElement;
  hapticLabel: HTMLLabelElement;
  onHud: (hud: Hud) => void;
}): GameApi {
  const { canvas, root: rootEl, popups, onHud } = opts;
  bindHapticLabel(opts.hapticLabel);

  const save = loadSave();
  let soundOn = save.sound;
  let hapticsOn = save.haptics;
  let tiltOn = false;
  let tiltSteer = 0;
  setHapticsEnabled(hapticsOn);

  const audio = createAudio();
  audio.setMuted(!soundOn);

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scene = new Scene();
  scene.background = new Color(0x07090e);

  const camera = new OrthographicCamera(-40, 40, 40, -40, 0.1, 220);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 90, 0);
  camera.lookAt(0, 0, 0);

  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  renderer.setClearColor(0x07090e, 1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const hemi = new HemisphereLight(0xc5d4e4, 0x07090e, 0.72);
  const key = new DirectionalLight(0xfff4ea, 1.45);
  key.position.set(28, 70, 18);
  const rim = new DirectionalLight(0x6ae4ff, 0.65);
  rim.position.set(-36, 28, -40);
  const fill = new AmbientLight(0x8ea0b8, 0.28);
  const engineLight = new PointLight(EMBER, 0, 18, 2);
  scene.add(hemi, key, rim, fill, engineLight);

  const glow = makeGlowTexture();
  scene.add(makeStars());
  const stars = scene.children.at(-1) as Object3D;
  scene.add(makeField(FIELD));

  const shipView = makeShip();
  scene.add(shipView.root);
  for (const ghost of shipView.ghosts) scene.add(ghost);
  shipView.root.visible = false;

  const rocks: Rock[] = [];
  const bullets: Bullet[] = [];
  const sparks: Spark[] = [];
  for (let i = 0; i < 16; i++) {
    const view = makeBullet(glow);
    scene.add(view.root);
    scene.add(view.ghost);
    bullets.push({
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      age: 0,
      owner: "player",
      alive: false,
      view,
    });
  }
  for (let i = 0; i < 72; i++) {
    const sprite = makeSpark(glow);
    scene.add(sprite);
    sparks.push({ sprite, vx: 0, vy: 0, vz: 0, life: 0, max: 1 });
  }

  const keys = new Set<string>();
  const actions = { left: false, right: false, thrust: false, fire: false };
  let steerOverride: number | null = null;
  let gamepadArmed = false;

  let phase: Phase = "attract";
  let score = 0;
  let best = save.best;
  let wave = 1;
  let lives = 3;
  let banner: string | null = null;
  let bannerT = 0;
  let nextLife = 10000;
  let between = false;
  let waveGap = 0;
  let waveScale = 1;
  let waveMass = 1;
  let ufoTimer = 8;
  let ufo: Ufo | null = null;
  let simTime = 0;
  let beatAcc = 0;
  let beatEvery = 1;
  let sparkT = 0;
  let hitStop = 0;
  let shakeAmt = 0;
  let hurt = 0;
  let thrusting = false;
  let thrustVis = 0;
  let respawnT = 0;
  let respawnWait = 0;
  let ending = false;
  let popupGen = 0;
  let viewShiftZ = 0;
  let hudKey = "";
  let wakeLock: WakeLockSentinel | null = null;

  const ship = {
    x: 0,
    z: 0,
    vx: 0,
    vz: 0,
    yaw: 0,
    invuln: 0,
    cool: 0,
    hyperCool: 0,
    dead: true,
  };

  const timer = new Timer();
  const acc = { v: 0 };
  const proj = new Vector3();

  function loadSave(): Save {
    const fallback: Save = { v: 1, best: 0, sound: true, haptics: true };
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<Save>;
      return {
        v: 1,
        best: typeof parsed.best === "number" ? parsed.best : 0,
        sound: parsed.sound !== false,
        haptics: parsed.haptics !== false,
      };
    } catch {
      return fallback;
    }
  }

  function persist() {
    try {
      const data: Save = { v: 1, best, sound: soundOn, haptics: hapticsOn };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* private mode */
    }
  }

  function emit() {
    const hud: Hud = {
      phase,
      score,
      best,
      wave,
      lives,
      banner,
      sound: soundOn,
      haptics: hapticsOn,
      tilt: tiltOn,
    };
    const key = JSON.stringify(hud);
    if (key === hudKey) return;
    hudKey = key;
    onHud(hud);
  }

  function popup(text: string, x: number, z: number, ember = false) {
    proj.set(x, 2.4, z);
    proj.project(camera);
    if (proj.z < -1 || proj.z > 1) return;
    const el = document.createElement("span");
    el.className = ember ? "popup ember" : "popup";
    el.textContent = text;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    el.style.left = `${((proj.x + 1) / 2) * w}px`;
    el.style.top = `${((-proj.y + 1) / 2) * h}px`;
    popups.appendChild(el);
    const gen = popupGen;
    window.setTimeout(() => {
      if (gen === popupGen) el.remove();
    }, 720);
  }

  function addShake(amount: number) {
    if (reduceMotion) return;
    shakeAmt = Math.min(2.6, shakeAmt + amount);
  }

  function wrapCoord(v: number) {
    if (v < -HALF) return v + FIELD;
    if (v > HALF) return v - FIELD;
    return v;
  }

  function wrapDelta(a: number, b: number) {
    let d = a - b;
    if (d > HALF) d -= FIELD;
    if (d < -HALF) d += FIELD;
    return d;
  }

  function dist2(ax: number, az: number, bx: number, bz: number) {
    const dx = wrapDelta(ax, bx);
    const dz = wrapDelta(az, bz);
    return dx * dx + dz * dz;
  }

  function offsets(x: number, z: number, margin: number) {
    const list: Array<[number, number]> = [];
    let ox = 0;
    let oz = 0;
    if (x > HALF - margin) ox = -FIELD;
    else if (x < -HALF + margin) ox = FIELD;
    if (z > HALF - margin) oz = -FIELD;
    else if (z < -HALF + margin) oz = FIELD;
    if (ox) list.push([ox, 0]);
    if (oz) list.push([0, oz]);
    if (ox && oz) list.push([ox, oz]);
    return list;
  }

  function layout(root: Object3D, ghosts: Object3D[], x: number, z: number, margin: number, show: boolean) {
    root.visible = show;
    root.position.x = x;
    root.position.z = z;
    const offs = show ? offsets(x, z, margin) : [];
    for (let i = 0; i < ghosts.length; i++) {
      const ghost = ghosts[i];
      const off = offs[i];
      if (!ghost) continue;
      if (!off) {
        ghost.visible = false;
        continue;
      }
      ghost.visible = true;
      ghost.position.x = x + off[0];
      ghost.position.z = z + off[1];
    }
  }

  function clearRocks() {
    for (const rock of rocks) dropRock(rock);
    rocks.length = 0;
  }

  function dropRock(rock: Rock) {
    rock.view.root.removeFromParent();
    for (const ghost of rock.view.ghosts) ghost.removeFromParent();
    rock.view.geo.dispose();
  }

  function spawnRock(gen: 0 | 1 | 2, x: number, z: number, vx: number, vz: number) {
    const radius = RADII[gen];
    const view = makeRock((Math.random() * 1e9) | 0, radius);
    view.body.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    scene.add(view.root);
    for (const ghost of view.ghosts) scene.add(ghost);
    rocks.push({
      x: wrapCoord(x),
      z: wrapCoord(z),
      vx,
      vz,
      gen,
      radius,
      alive: true,
      view,
    });
  }

  function edgePoint() {
    for (let i = 0; i < 8; i++) {
      const edge = (Math.random() * 4) | 0;
      const along = (Math.random() * 2 - 1) * (HALF - 8);
      const out = HALF - 4 - Math.random() * 6;
      const point =
        edge === 0
          ? { x: along, z: -out }
          : edge === 1
            ? { x: along, z: out }
            : edge === 2
              ? { x: -out, z: along }
              : { x: out, z: along };
      if (Math.hypot(point.x, point.z) > 16) return point;
    }
    return { x: HALF - 6, z: 0 };
  }

  function spawnWave() {
    const count = Math.min(11, 2 + wave * 2);
    waveScale = Math.min(1.55, 1 + (wave - 1) * 0.06);
    for (let i = 0; i < count; i++) {
      const point = edgePoint();
      const angle = Math.random() * Math.PI * 2;
      const speed = ROCK_SPEED[0] * waveScale * (0.78 + Math.random() * 0.45);
      spawnRock(0, point.x, point.z, Math.sin(angle) * speed, Math.cos(angle) * speed);
    }
    waveMass = Math.max(1, currentMass());
    banner = `Wave ${wave}`;
    bannerT = 1.55;
    ufoTimer = Math.max(6.5, 15 - wave) + Math.random() * 5;
    between = false;
    waveGap = 0;
    audio.wave();
    emit();
  }

  function currentMass() {
    let mass = 0;
    for (const rock of rocks) {
      if (!rock.alive) continue;
      mass += rock.gen === 0 ? 4 : rock.gen === 1 ? 2 : 1;
    }
    return mass;
  }

  function burst(x: number, z: number, ember: boolean, count: number, speed: number, life: number) {
    let left = count;
    for (const spark of sparks) {
      if (left <= 0) break;
      if (spark.life > 0) continue;
      const angle = Math.random() * Math.PI * 2;
      const mag = speed * (0.35 + Math.random() * 0.85);
      spark.vx = Math.sin(angle) * mag;
      spark.vz = Math.cos(angle) * mag;
      spark.vy = (Math.random() - 0.15) * speed * 0.45;
      spark.max = life * (0.65 + Math.random() * 0.55);
      spark.life = spark.max;
      spark.sprite.position.set(x, 1 + Math.random() * 0.8, z);
      spark.sprite.visible = true;
      const mat = spark.sprite.material as SpriteMaterial;
      mat.color.setHex(ember ? EMBER : ICE);
      mat.opacity = 1;
      spark.sprite.scale.setScalar(0.45 + Math.random() * 0.4);
      left -= 1;
    }
  }

  function removeUfo() {
    if (!ufo) return;
    ufo.view.root.removeFromParent();
    for (const ghost of ufo.view.ghosts) ghost.removeFromParent();
    ufo = null;
    audio.ufo(false);
  }

  function spawnUfo() {
    const small = score >= 4000 && Math.random() < Math.min(0.75, 0.3 + score / 48000);
    const kind = small ? "small" : "large";
    const view = makeUfo(kind);
    scene.add(view.root);
    for (const ghost of view.ghosts) scene.add(ghost);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const speed = (kind === "large" ? 9.5 : 14.5) * Math.min(1.35, 0.95 + wave * 0.04);
    ufo = {
      x: -dir * (HALF - 2),
      z: (Math.random() * 2 - 1) * (HALF - 10),
      vx: dir * speed,
      vz: (Math.random() * 2 - 1) * speed * 0.25,
      kind,
      radius: kind === "large" ? 2.55 : 1.42,
      score: kind === "large" ? 200 : 1000,
      fireT: 0.6,
      dirT: 0.8,
      age: 0,
      view,
    };
    audio.ufo(true);
    haptic("ufo");
    popup(kind === "large" ? "SAUCER" : "HUNTER", ufo.x, ufo.z, kind === "small");
  }

  function killUfo(scored: boolean) {
    if (!ufo) return;
    burst(ufo.x, ufo.z, ufo.kind === "small", 18, 11, 0.45);
    audio.explode(true);
    addShake(0.85);
    hurt = Math.min(1, hurt + 0.35);
    if (scored) {
      score += ufo.score;
      popup(`+${ufo.score}`, ufo.x, ufo.z, true);
      grantLife();
      haptic("boom");
    }
    removeUfo();
    emit();
  }

  function grantLife() {
    while (score >= nextLife) {
      nextLife += 10000;
      if (lives < 6) {
        lives += 1;
        audio.life();
        haptic("life");
        popup("1UP", ship.x, ship.z, false);
      }
    }
  }

  function destroyRock(rock: Rock, by: "player" | "ufo") {
    if (!rock.alive) return;
    rock.alive = false;
    if (by === "player") {
      const pts = SCORES[rock.gen];
      score += pts;
      popup(`+${pts}`, rock.x, rock.z, false);
      grantLife();
    }
    burst(rock.x, rock.z, false, rock.gen === 0 ? 16 : 10, 8 + rock.gen * 2, 0.4);
    audio.explode(rock.gen === 0);
    if (rock.gen === 0) {
      addShake(0.7);
      hitStop = Math.max(hitStop, 0.045);
      hurt = Math.min(1, hurt + 0.28);
      haptic("hit");
    } else {
      addShake(rock.gen === 1 ? 0.32 : 0.14);
      if (by === "player") haptic(rock.gen === 1 ? "hit" : "tick");
    }
    if (rock.gen < 2) {
      const base = Math.atan2(rock.vx, rock.vz);
      const next = (rock.gen + 1) as 1 | 2;
      for (const side of [-1, 1]) {
        const angle = base + side * (0.45 + Math.random() * 0.45);
        const speed = ROCK_SPEED[next] * waveScale * (0.82 + Math.random() * 0.4);
        spawnRock(
          next,
          rock.x + Math.sin(angle) * 1.6,
          rock.z + Math.cos(angle) * 1.6,
          Math.sin(angle) * speed,
          Math.cos(angle) * speed,
        );
      }
    }
    emit();
  }

  function killShip() {
    if (ship.dead || ship.invuln > 0 || phase !== "play") return;
    ship.dead = true;
    ship.vx = 0;
    ship.vz = 0;
    lives -= 1;
    burst(ship.x, ship.z, true, 26, 14, 0.55);
    audio.explode(true);
    audio.thrust(false);
    thrusting = false;
    addShake(1.8);
    hitStop = Math.max(hitStop, 0.07);
    hurt = 1;
    haptic("die");
    respawnT = 1.25;
    respawnWait = 0;
    ending = lives <= 0;
    emit();
  }

  function centerClear() {
    for (const rock of rocks) {
      if (!rock.alive) continue;
      if (dist2(0, 0, rock.x, rock.z) < (rock.radius + 7) ** 2) return false;
    }
    if (ufo && dist2(0, 0, ufo.x, ufo.z) < (ufo.radius + 8) ** 2) return false;
    return true;
  }

  function respawn() {
    ship.dead = false;
    ship.x = 0;
    ship.z = 0;
    ship.vx = 0;
    ship.vz = 0;
    ship.invuln = 2.8;
    ship.cool = 0;
    respawnWait = 0;
    emit();
  }

  function alivePlayerShots() {
    let n = 0;
    for (const bullet of bullets) if (bullet.alive && bullet.owner === "player") n += 1;
    return n;
  }

  function tryFire() {
    if (phase !== "play" || ship.dead || ship.cool > 0) return false;
    if (alivePlayerShots() >= 4) return false;
    const bullet = bullets.find((item) => !item.alive);
    if (!bullet) return false;
    const fx = -Math.sin(ship.yaw);
    const fz = -Math.cos(ship.yaw);
    bullet.alive = true;
    bullet.owner = "player";
    bullet.age = 0;
    bullet.x = ship.x + fx * 2.35;
    bullet.z = ship.z + fz * 2.35;
    bullet.vx = fx * BULLET_SPEED + ship.vx;
    bullet.vz = fz * BULLET_SPEED + ship.vz;
    ship.cool = FIRE_GAP;
    retintBullet(bullet.view, ICE);
    audio.shoot(false);
    haptic("fire");
    return true;
  }

  function fireUfo() {
    if (!ufo || ship.dead) return;
    const bullet = bullets.find((item) => !item.alive);
    if (!bullet) return;
    const dx = wrapDelta(ship.x, ufo.x);
    const dz = wrapDelta(ship.z, ufo.z);
    const skill = Math.min(0.78, score / 36000);
    const error = ufo.kind === "large" ? Math.PI * 2 : 0.72 - skill * 0.55;
    const angle =
      ufo.kind === "large"
        ? Math.random() * Math.PI * 2
        : Math.atan2(dx, dz) + (Math.random() - 0.5) * 2 * error;
    const speed = ufo.kind === "large" ? 34 : 42;
    bullet.alive = true;
    bullet.owner = "ufo";
    bullet.age = 0;
    bullet.x = ufo.x + Math.sin(angle) * (ufo.radius + 0.4);
    bullet.z = ufo.z + Math.cos(angle) * (ufo.radius + 0.4);
    bullet.vx = Math.sin(angle) * speed;
    bullet.vz = Math.cos(angle) * speed;
    retintBullet(bullet.view, EMBER);
    audio.shoot(true);
  }

  function tryHyper() {
    if (phase !== "play" || ship.dead || ship.hyperCool > 0) return;
    ship.hyperCool = 0.75;
    burst(ship.x, ship.z, false, 12, 9, 0.35);
    ship.x = (Math.random() * 2 - 1) * (HALF - 8);
    ship.z = (Math.random() * 2 - 1) * (HALF - 8);
    ship.vx *= 0.2;
    ship.vz *= 0.2;
    burst(ship.x, ship.z, false, 12, 9, 0.35);
    audio.hyper();
    haptic("hyper");
    const crowded = rocks.some(
      (rock) => rock.alive && dist2(ship.x, ship.z, rock.x, rock.z) < (rock.radius + 2.4) ** 2,
    );
    if (crowded || Math.random() < 0.12) {
      ship.invuln = 0;
      killShip();
    } else {
      ship.invuln = Math.max(ship.invuln, 0.4);
    }
  }

  function readInput() {
    let turn = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft") || actions.left) turn += 1;
    if (keys.has("KeyD") || keys.has("ArrowRight") || actions.right) turn -= 1;
    if (steerOverride !== null) turn = steerOverride;
    else if (tiltOn) turn += tiltSteer;
    turn = MathUtils.clamp(turn, -1, 1);
    readGamepad(turn);
    return {
      turn: gamepadTurn.used ? MathUtils.clamp(turn + gamepadTurn.turn, -1, 1) : turn,
      thrust: keys.has("KeyW") || keys.has("ArrowUp") || actions.thrust || gamepadTurn.thrust,
      fire: keys.has("Space") || actions.fire || gamepadTurn.fire,
    };
  }

  const gamepadTurn = { used: false, turn: 0, thrust: false, fire: false, hyper: false, prevHyper: false };

  function readGamepad(baseTurn: number) {
    gamepadTurn.used = false;
    gamepadTurn.turn = 0;
    gamepadTurn.thrust = false;
    gamepadTurn.fire = false;
    gamepadTurn.hyper = false;
    let pads: Array<Gamepad | null> = [];
    try {
      pads = navigator.getGamepads?.() ? Array.from(navigator.getGamepads()) : [];
    } catch {
      return baseTurn;
    }
    for (const pad of pads) {
      if (!pad) continue;
      const pressed = pad.buttons.some((button) => button.pressed);
      if (pressed) gamepadArmed = true;
      if (!gamepadArmed) continue;
      const axis = pad.axes[0] ?? 0;
      if (Math.abs(axis) > 0.22) gamepadTurn.turn += -axis;
      if (pad.buttons[14]?.pressed) gamepadTurn.turn += 1;
      if (pad.buttons[15]?.pressed) gamepadTurn.turn -= 1;
      const stickY = pad.axes[1] ?? 0;
      gamepadTurn.thrust =
        (pad.buttons[7]?.value ?? 0) > 0.2 || pad.buttons[12]?.pressed === true || stickY < -0.45;
      gamepadTurn.fire = pad.buttons[0]?.pressed === true || pad.buttons[5]?.pressed === true;
      gamepadTurn.hyper = pad.buttons[1]?.pressed === true;
      gamepadTurn.used = true;
    }
    if (gamepadTurn.hyper && !gamepadTurn.prevHyper) tryHyper();
    gamepadTurn.prevHyper = gamepadTurn.hyper;
    return baseTurn;
  }

  function integrateRocks(dt: number) {
    for (const rock of rocks) {
      if (!rock.alive) continue;
      rock.x = wrapCoord(rock.x + rock.vx * dt);
      rock.z = wrapCoord(rock.z + rock.vz * dt);
      rock.view.body.rotation.x += dt * (0.35 + (rock.gen + 1) * 0.22);
      rock.view.body.rotation.y += dt * (0.5 + rock.radius * 0.05);
      rock.view.body.rotation.z += dt * 0.28;
    }
  }

  function integrateSparks(dt: number) {
    for (const spark of sparks) {
      if (spark.life <= 0) continue;
      spark.life -= dt;
      spark.sprite.position.x += spark.vx * dt;
      spark.sprite.position.y += spark.vy * dt;
      spark.sprite.position.z += spark.vz * dt;
      spark.vy -= dt * 1.4;
      const k = Math.max(0, spark.life / spark.max);
      const mat = spark.sprite.material as SpriteMaterial;
      mat.opacity = k;
      spark.sprite.scale.setScalar(0.35 + (1 - k) * 1.35);
      if (spark.life <= 0) spark.sprite.visible = false;
    }
  }

  function step(dt: number) {
    simTime += dt;
    integrateRocks(dt);
    integrateSparks(dt);

    if (phase !== "play") {
      if (ufo) {
        ufo.x += ufo.vx * dt;
        ufo.z = wrapCoord(ufo.z + ufo.vz * dt);
      }
      return;
    }

    if (bannerT > 0) {
      bannerT -= dt;
      if (bannerT <= 0) {
        banner = null;
        emit();
      }
    }

    if (between) {
      waveGap -= dt;
      if (waveGap <= 0) {
        wave += 1;
        spawnWave();
      }
    } else if (rocks.every((rock) => !rock.alive) || rocks.length === 0) {
      between = true;
      waveGap = 1.45;
      removeUfo();
      banner = "Clear";
      bannerT = 1.15;
      audio.wave();
      emit();
    }

    if (!between && !ufo) {
      ufoTimer -= dt;
      if (ufoTimer <= 0) spawnUfo();
    }

    if (ufo) {
      ufo.age += dt;
      ufo.x += ufo.vx * dt;
      ufo.dirT -= dt;
      if (ufo.dirT <= 0) {
        ufo.dirT = 0.55 + Math.random() * 0.9;
        ufo.vz = (Math.random() * 2 - 1) * Math.abs(ufo.vx) * 0.7;
      }
      ufo.z = wrapCoord(ufo.z + ufo.vz * dt);
      ufo.fireT -= dt;
      if (ufo.fireT <= 0) {
        ufo.fireT = ufo.kind === "large" ? 1.15 : 0.68;
        fireUfo();
      }
      const fast = ufo.kind === "small";
      const high = Math.floor(simTime * (fast ? 9 : 5.5)) % 2 === 0;
      audio.ufo(true);
      ufo.view.ring.rotation.z += dt * 1.8;
      audio.ufoTone(high ? (fast ? 740 : 540) : fast ? 460 : 350);
      if ((ufo.vx > 0 && ufo.x > HALF + 3) || (ufo.vx < 0 && ufo.x < -HALF - 3) || ufo.age > 16) {
        removeUfo();
      }
    } else {
      audio.ufo(false);
    }

    const input = ship.dead ? { turn: 0, thrust: false, fire: false } : readInput();
    if (!ship.dead) {
      ship.yaw += input.turn * TURN * dt;
      const fx = -Math.sin(ship.yaw);
      const fz = -Math.cos(ship.yaw);
      if (input.thrust) {
        ship.vx += fx * ACCEL * dt;
        ship.vz += fz * ACCEL * dt;
        const speed = Math.hypot(ship.vx, ship.vz);
        if (speed > MAX_SPEED) {
          ship.vx = (ship.vx / speed) * MAX_SPEED;
          ship.vz = (ship.vz / speed) * MAX_SPEED;
        }
      }
      ship.x = wrapCoord(ship.x + ship.vx * dt);
      ship.z = wrapCoord(ship.z + ship.vz * dt);
      if (ship.cool > 0) ship.cool -= dt;
      if (ship.hyperCool > 0) ship.hyperCool -= dt;
      if (ship.invuln > 0) ship.invuln -= dt;
      if (input.fire) tryFire();
      thrusting = input.thrust;
      if (input.thrust) {
        sparkT -= dt;
        if (sparkT <= 0) {
          sparkT = 0.035;
          burst(ship.x + Math.sin(ship.yaw) * 2.05, ship.z + Math.cos(ship.yaw) * 2.05, true, 1, 5, 0.18);
        }
      }
    } else {
      thrusting = false;
      if (respawnT > 0) respawnT -= dt;
      else if (ending || lives <= 0) {
        phase = "over";
        removeUfo();
        audio.thrust(false);
        if (score > best) {
          best = score;
          persist();
        }
        emit();
      } else {
        respawnWait += dt;
        if (centerClear() || respawnWait > 2.4) respawn();
      }
    }

    for (const bullet of bullets) {
      if (!bullet.alive) continue;
      bullet.age += dt;
      bullet.x = wrapCoord(bullet.x + bullet.vx * dt);
      bullet.z = wrapCoord(bullet.z + bullet.vz * dt);
      if (bullet.age > BULLET_LIFE) bullet.alive = false;
    }

    for (const bullet of bullets) {
      if (!bullet.alive) continue;
      if (ufo && bullet.owner === "player") {
        if (dist2(bullet.x, bullet.z, ufo.x, ufo.z) < (ufo.radius + 0.45) ** 2) {
          bullet.alive = false;
          killUfo(true);
        }
      }
      if (!bullet.alive) continue;
      for (const rock of rocks) {
        if (!rock.alive) continue;
        if (dist2(bullet.x, bullet.z, rock.x, rock.z) < (rock.radius + 0.4) ** 2) {
          bullet.alive = false;
          destroyRock(rock, bullet.owner);
          break;
        }
      }
      if (!bullet.alive || ship.dead || ship.invuln > 0) continue;
      const grace = bullet.owner === "player" ? 0.1 : 0;
      if (bullet.age > grace && dist2(bullet.x, bullet.z, ship.x, ship.z) < (SHIP_R + 0.25) ** 2) {
        bullet.alive = false;
        killShip();
      }
    }

    if (!ship.dead && ship.invuln <= 0) {
      for (const rock of rocks) {
        if (!rock.alive) continue;
        if (dist2(ship.x, ship.z, rock.x, rock.z) < (rock.radius + SHIP_R) ** 2) {
          killShip();
          break;
        }
      }
      if (ufo && !ship.dead && dist2(ship.x, ship.z, ufo.x, ufo.z) < (ufo.radius + SHIP_R) ** 2) {
        killShip();
      }
    }

    if (ufo) {
      for (const rock of rocks) {
        if (!rock.alive) continue;
        if (dist2(ufo.x, ufo.z, rock.x, rock.z) < (rock.radius + ufo.radius) ** 2) {
          burst(ufo.x, ufo.z, true, 14, 9, 0.35);
          audio.explode(false);
          removeUfo();
          break;
        }
      }
    }

    for (let i = rocks.length - 1; i >= 0; i--) {
      const rock = rocks[i];
      if (!rock || rock.alive) continue;
      dropRock(rock);
      rocks.splice(i, 1);
    }

    const mass = currentMass();
    const ratio = waveMass > 0 ? Math.min(1, mass / waveMass) : 1;
    beatEvery = 0.2 + ratio * 0.92;
    beatAcc += dt;
    if (beatAcc >= beatEvery) {
      beatAcc = 0;
      audio.beat(ratio < 0.45);
    }
    audio.thrust(thrusting && !ship.dead);
  }

  function syncMeshes() {
    for (const rock of rocks) {
      layout(rock.view.root, rock.view.ghosts, rock.x, rock.z, rock.radius + 0.8, rock.alive);
      for (const ghost of rock.view.ghosts) {
        const body = ghost.getObjectByName("body");
        if (body) body.quaternion.copy(rock.view.body.quaternion);
      }
    }

    const showShip = phase === "play" && !ship.dead;
    shipView.root.rotation.y = ship.yaw;
    shipView.bank.rotation.z = MathUtils.damp(shipView.bank.rotation.z, showShip ? -readTurnSign() * 0.4 : 0, 8, 1 / 60);
    layout(shipView.root, shipView.ghosts, ship.x, ship.z, 3.4, showShip);
    const blink = ship.invuln <= 0 || Math.sin(simTime * 26) > 0;
    shipView.bank.visible = blink;
    shipView.ring.visible = showShip && ship.invuln > 0;
    const flameOn = thrustVis > 0.25;
    for (const flame of shipView.flames) {
      flame.visible = flameOn;
      flame.scale.setScalar(0.65 + thrustVis * 0.7 + Math.sin(simTime * 46) * 0.12);
    }
    for (const ghost of shipView.ghosts) {
      ghost.rotation.y = ship.yaw;
      const bank = ghost.children[0];
      if (bank) {
        bank.visible = blink;
        bank.quaternion.copy(shipView.bank.quaternion);
        bank.traverse((obj) => {
          if (obj.name === "flame") {
            obj.visible = flameOn;
            obj.scale.copy(shipView.flames[0]?.scale ?? obj.scale);
          }
        });
      }
    }

    if (ufo) {
      layout(ufo.view.root, ufo.view.ghosts, ufo.x, ufo.z, ufo.radius + 1.2, true);
      for (const ghost of ufo.view.ghosts) {
        const ring = ghost.getObjectByName("ring");
        if (ring) ring.rotation.z = ufo.view.ring.rotation.z;
      }
    }

    for (const bullet of bullets) {
      const view = bullet.view;
      view.root.visible = bullet.alive;
      if (!bullet.alive) {
        view.ghost.visible = false;
        continue;
      }
      view.root.position.x = bullet.x;
      view.root.position.z = bullet.z;
      view.root.rotation.y = Math.atan2(bullet.vx, bullet.vz);
      const off = offsets(bullet.x, bullet.z, 1.4);
      const pick = off[off.length - 1];
      view.ghost.visible = !!pick;
      if (pick) {
        view.ghost.position.x = bullet.x + pick[0];
        view.ghost.position.z = bullet.z + pick[1];
        view.ghost.rotation.y = view.root.rotation.y;
      }
    }
  }

  function readTurnSign() {
    let turn = 0;
    if (keys.has("KeyA") || keys.has("ArrowLeft") || actions.left) turn += 1;
    if (keys.has("KeyD") || keys.has("ArrowRight") || actions.right) turn -= 1;
    if (tiltOn) turn += tiltSteer;
    return MathUtils.clamp(turn, -1, 1);
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 2 || h < 2) return;
    const narrow = w < 820;
    const dpr = Math.min(window.devicePixelRatio || 1, narrow ? 1.6 : 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    const half = HALF + 4;
    const aspect = w / h;
    if (aspect >= 1) {
      camera.top = half;
      camera.bottom = -half;
      camera.left = -half * aspect;
      camera.right = half * aspect;
    } else {
      camera.left = -half;
      camera.right = half;
      camera.top = half / aspect;
      camera.bottom = -half / aspect;
    }
    camera.updateProjectionMatrix();
    const deck = narrow ? 150 : 0;
    const hud = 92;
    const biasPx = (deck - hud) / 2;
    viewShiftZ = (biasPx / h) * (camera.top - camera.bottom);
  }

  function render(delta: number) {
    shakeAmt *= Math.exp(-3.5 * delta);
    const mag = reduceMotion ? 0 : shakeAmt;
    const sx = (Math.random() - 0.5) * mag;
    const sz = (Math.random() - 0.5) * mag;
    const z = viewShiftZ + sz;
    camera.up.set(0, 0, -1);
    camera.position.set(sx, 90, z);
    camera.lookAt(sx, 0, z);
    hurt *= Math.exp(-5.5 * delta);
    rootEl.style.setProperty("--hurt", hurt.toFixed(3));
    thrustVis = MathUtils.damp(thrustVis, thrusting ? 1 : 0, 10, delta);
    engineLight.position.set(ship.x, 1.6, ship.z);
    engineLight.intensity = thrustVis * 14;
    if (!reduceMotion) stars.rotation.y += delta * 0.01;
    syncMeshes();
    renderer.render(scene, camera);
  }

  function frame(time: number) {
    timer.update(time);
    const delta = Math.min(timer.getDelta(), 0.1);
    if (hitStop > 0) {
      hitStop = Math.max(0, hitStop - delta);
      acc.v = 0;
      render(delta);
      return;
    }
    if (phase === "pause") {
      acc.v = 0;
      render(delta);
      return;
    }
    acc.v += delta;
    let steps = 0;
    while (acc.v >= STEP && steps < 5) {
      step(STEP);
      acc.v -= STEP;
      steps += 1;
    }
    render(delta);
  }

  function keepAwake() {
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;
    void nav.wakeLock
      .request("screen")
      .then((sentinel) => {
        wakeLock = sentinel;
      })
      .catch(() => {
        wakeLock = null;
      });
  }

  function start() {
    audio.unlock();
    clearRocks();
    for (const bullet of bullets) bullet.alive = false;
    removeUfo();
    score = 0;
    lives = 3;
    wave = 1;
    nextLife = 10000;
    ending = false;
    between = false;
    banner = null;
    ship.dead = false;
    ship.x = 0;
    ship.z = 0;
    ship.vx = 0;
    ship.vz = 0;
    ship.yaw = 0;
    ship.invuln = 2.1;
    ship.cool = 0;
    ship.hyperCool = 0;
    phase = "play";
    spawnWave();
    keepAwake();
    haptic("tick");
    emit();
  }

  function togglePause() {
    if (phase === "play") {
      phase = "pause";
      audio.thrust(false);
      thrusting = false;
      emit();
    } else if (phase === "pause") {
      phase = "play";
      emit();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
    audio.unlock();
    if (event.repeat) return;
    if ((phase === "attract" || phase === "over") && (event.code === "Enter" || event.code === "Space")) {
      start();
      return;
    }
    if (phase === "pause" && (event.code === "Enter" || event.code === "KeyP" || event.code === "Escape")) {
      phase = "play";
      emit();
      return;
    }
    if (phase === "play" && (event.code === "KeyP" || event.code === "Escape")) {
      togglePause();
      return;
    }
    keys.add(event.code);
    if (event.code === "Space") tryFire();
    if (event.code === "KeyH" || event.code === "ShiftLeft" || event.code === "ShiftRight") tryHyper();
  }

  function onKeyUp(event: KeyboardEvent) {
    keys.delete(event.code);
  }

  function onBlur() {
    keys.clear();
    actions.left = false;
    actions.right = false;
    actions.thrust = false;
    actions.fire = false;
    audio.thrust(false);
    thrusting = false;
  }

  function onVis() {
    if (document.visibilityState === "hidden") {
      if (phase === "play") togglePause();
      audio.thrust(false);
    } else {
      audio.resume();
      keepAwake();
    }
  }

  function onTouchMove(event: TouchEvent) {
    event.preventDefault();
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);
  rootEl.addEventListener("touchmove", onTouchMove, { passive: false });
  window.visualViewport?.addEventListener("resize", resize);

  for (let i = 0; i < 6; i++) {
    const gen = (i % 3) as 0 | 1 | 2;
    const point = edgePoint();
    const angle = Math.random() * Math.PI * 2;
    const speed = ROCK_SPEED[gen] * 0.55;
    spawnRock(gen, point.x, point.z, Math.sin(angle) * speed, Math.cos(angle) * speed);
  }

  resize();
  emit();
  renderer.setAnimationLoop(frame);

  const api: GameApi = {
    start,
    resume: () => {
      if (phase === "pause") {
        phase = "play";
        emit();
      }
    },
    togglePause,
    unlockAudio: () => audio.unlock(),
    setAction: (name: ActionName, down: boolean) => {
      actions[name] = down;
      if (!down) return;
      if (name === "fire") tryFire();
      else haptic("tick");
    },
    tapHyper: () => tryHyper(),
    setSound: (on: boolean) => {
      soundOn = on;
      audio.setMuted(!on);
      persist();
      emit();
    },
    setHaptics: (on: boolean) => {
      hapticsOn = on;
      setHapticsEnabled(on);
      persist();
      emit();
      if (on) haptic("tick");
    },
    setTiltEnabled: (on: boolean) => {
      tiltOn = on;
      if (!on) tiltSteer = 0;
      emit();
    },
    setTiltSteer: (value: number) => {
      tiltSteer = tiltOn ? MathUtils.clamp(value, -1, 1) : 0;
    },
    dispose: () => {
      popupGen += 1;
      renderer.setAnimationLoop(null);
      ro.disconnect();
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      rootEl.removeEventListener("touchmove", onTouchMove);
      window.visualViewport?.removeEventListener("resize", resize);
      audio.dispose();
      clearRocks();
      removeUfo();
      popups.replaceChildren();
      scene.traverse((obj) => {
        const mesh = obj as {
          geometry?: { dispose: () => void; userData: Record<string, unknown> };
          material?:
            | { dispose: () => void; userData: Record<string, unknown>; map?: { dispose: () => void } | null }
            | Array<{ dispose: () => void; userData: Record<string, unknown>; map?: { dispose: () => void } | null }>;
        };
        if (mesh.geometry && mesh.geometry.userData.persist !== true) mesh.geometry.dispose();
        if (!mesh.material) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of list) {
          if (mat.userData.persist === true) continue;
          mat.map?.dispose();
          mat.dispose();
        }
      });
      renderer.dispose();
      void wakeLock?.release?.();
      if (window.__controlsTest?.getYaw === probe.getYaw) delete window.__controlsTest;
    },
  };

  const probe = {
    getYaw: () => ship.yaw,
    getSpeed: () => Math.hypot(ship.vx, ship.vz),
    setSteer: (value: number) => {
      steerOverride = value;
    },
    setKeys: (codes: string[]) => {
      keys.clear();
      for (const code of codes) keys.add(code);
    },
  };
  window.__controlsTest = probe;

  return api;
}
