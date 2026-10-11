import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  type Material,
  type Object3D,
} from "three";

const ICE = 0x6ae4ff;
const EMBER = 0xff9a3c;
const HULL = 0xd5dee8;
const VOID = 0x10151c;

export type ShipView = {
  root: Group;
  ghosts: Group[];
  bank: Group;
  body: Mesh;
  ring: Mesh;
  flames: Object3D[];
};

export type RockView = {
  root: Group;
  ghosts: Group[];
  body: Mesh;
  geo: BufferGeometry;
};

export type UfoView = {
  root: Group;
  ghosts: Group[];
  ring: Mesh;
};

export type BulletView = {
  root: Group;
  ghost: Group;
  mesh: Mesh;
};

export function makeGlowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas unavailable");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function makeShadowTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas unavailable");
  const grad = g.createRadialGradient(64, 64, 8, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.45)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

export function makeField(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Canvas unavailable");
  g.clearRect(0, 0, 512, 512);
  const pad = 10;
  g.strokeStyle = "rgba(106, 228, 255, 0.55)";
  g.lineWidth = 3;
  g.strokeRect(pad, pad, 512 - pad * 2, 512 - pad * 2);
  g.strokeStyle = "rgba(106, 228, 255, 0.1)";
  g.lineWidth = 1;
  const cells = 8;
  for (let i = 1; i < cells; i++) {
    const p = pad + ((512 - pad * 2) * i) / cells;
    g.beginPath();
    g.moveTo(p, pad);
    g.lineTo(p, 512 - pad);
    g.stroke();
    g.beginPath();
    g.moveTo(pad, p);
    g.lineTo(512 - pad, p);
    g.stroke();
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    opacity: 0.9,
  });
  const mesh = new Mesh(new PlaneGeometry(size, size), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  return mesh;
}

export function makeStars() {
  const count = 640;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 180;
    positions[i * 3 + 1] = 4 + Math.random() * 36;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 180;
    const t = 0.55 + Math.random() * 0.45;
    colors[i * 3] = t;
    colors[i * 3 + 1] = t;
    colors[i * 3 + 2] = Math.min(1, t + 0.08);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const mat = new PointsMaterial({
    size: 2.2,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  return new Points(geo, mat);
}

function hullMaterial() {
  return new MeshStandardMaterial({
    color: HULL,
    metalness: 0.82,
    roughness: 0.28,
    flatShading: true,
    emissive: new Color(0x0c2833),
    emissiveIntensity: 0.45,
    side: DoubleSide,
  });
}

function glassMaterial(emissive: number) {
  return new MeshStandardMaterial({
    color: VOID,
    metalness: 0.15,
    roughness: 0.08,
    emissive: new Color(emissive),
    emissiveIntensity: 0.85,
  });
}

export function makeShip(): ShipView {
  const root = new Group();
  const bank = new Group();
  bank.position.y = 1.15;
  root.add(bank);

  const shape = dartGeometry();
  const body = new Mesh(shape, hullMaterial());
  body.name = "body";
  bank.add(body);

  const canopy = new Mesh(new SphereGeometry(0.42, 16, 12), glassMaterial(ICE));
  canopy.scale.set(0.62, 0.38, 1.05);
  canopy.position.set(0, 0.32, -0.55);
  bank.add(canopy);

  const nose = new Mesh(
    new SphereGeometry(0.12, 8, 8),
    new MeshBasicMaterial({ color: ICE, toneMapped: false }),
  );
  nose.position.set(0, 0.06, -2.55);
  bank.add(nose);

  const flames: Object3D[] = [];
  for (const x of [-0.46, 0.46]) {
    const nozzle = new Mesh(
      new CylinderGeometry(0.1, 0.16, 0.28, 8),
      new MeshStandardMaterial({
        color: 0x1a120c,
        roughness: 0.45,
        metalness: 0.4,
        emissive: new Color(EMBER),
        emissiveIntensity: 0.35,
      }),
    );
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(x, -0.02, 1.85);
    bank.add(nozzle);

    const flame = new Mesh(
      new ConeGeometry(0.18, 0.95, 8),
      new MeshBasicMaterial({
        color: EMBER,
        transparent: true,
        opacity: 0.92,
        blending: AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    flame.rotation.x = Math.PI / 2;
    flame.position.set(x, -0.02, 2.45);
    flame.visible = false;
    flame.name = "flame";
    bank.add(flame);
    flames.push(flame);
  }

  const ring = new Mesh(
    new TorusGeometry(2.35, 0.035, 8, 32),
    new MeshBasicMaterial({
      color: ICE,
      transparent: true,
      opacity: 0.75,
      toneMapped: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  ring.visible = false;
  ring.name = "ring";
  root.add(ring);

  const ghosts = [0, 1, 2].map(() => cloneShipGhost(bank));
  return { root, ghosts, bank, body, ring, flames };
}

function cloneShipGhost(bank: Group) {
  const ghost = new Group();
  const bankClone = bank.clone();
  ghost.add(bankClone);
  ghost.visible = false;
  return ghost;
}

function dartGeometry() {
  const v = [
    [0, 0.05, -2.7],
    [0, 0.48, -0.35],
    [0, -0.32, -0.15],
    [-1.6, 0.02, 1.2],
    [1.6, 0.02, 1.2],
    [0, 0.18, 2.15],
    [0, -0.22, 1.75],
  ];
  const faces = [
    [0, 3, 1],
    [0, 1, 4],
    [1, 3, 5],
    [1, 5, 4],
    [0, 2, 3],
    [0, 4, 2],
    [2, 6, 3],
    [2, 4, 6],
    [3, 6, 5],
    [4, 5, 6],
    [5, 3, 6],
    [5, 6, 4],
  ];
  const positions: number[] = [];
  for (const f of faces) {
    for (const i of f) positions.push(...(v[i] as number[]));
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

const rockMat = new MeshStandardMaterial({
  color: 0xffffff,
  vertexColors: true,
  roughness: 0.86,
  metalness: 0.08,
  flatShading: true,
});
rockMat.userData.persist = true;

export function makeRock(seed: number, radius: number): RockView {
  const geo = rockGeometry(seed, radius);
  const body = new Mesh(geo, rockMat);
  body.name = "body";
  body.position.y = radius * 0.72;
  const root = new Group();
  root.add(body);
  const ghosts = [0, 1, 2].map(() => {
    const g = new Group();
    const mesh = new Mesh(geo, rockMat);
    mesh.name = "body";
    mesh.position.y = radius * 0.72;
    g.add(mesh);
    g.visible = false;
    return g;
  });
  return { root, ghosts, body, geo };
}

function rockGeometry(seed: number, radius: number) {
  const geo = new IcosahedronGeometry(radius, 1);
  const pos = geo.attributes.position;
  if (!pos) return geo;
  const color = new Float32Array(pos.count * 3);
  let s = seed % 2147483646;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const wobble = 0.78 + rand() * 0.42;
    pos.setXYZ(i, (x / len) * radius * wobble, (y / len) * radius * wobble, (z / len) * radius * wobble);
    const ice = rand() > 0.84;
    const h = wobble;
    color[i * 3] = ice ? 0.55 + h * 0.15 : 0.34 + h * 0.22;
    color[i * 3 + 1] = ice ? 0.75 + h * 0.1 : 0.38 + h * 0.22;
    color[i * 3 + 2] = ice ? 0.82 : 0.44 + h * 0.22;
  }
  geo.setAttribute("color", new Float32BufferAttribute(color, 3));
  geo.computeVertexNormals();
  return geo;
}

export function makeUfo(kind: "large" | "small"): UfoView {
  const radius = kind === "large" ? 2.55 : 1.42;
  const root = new Group();
  const hull = new Mesh(
    new CylinderGeometry(radius, radius, kind === "large" ? 0.42 : 0.28, 20),
    new MeshStandardMaterial({
      color: kind === "large" ? HULL : 0x2a241f,
      metalness: 0.75,
      roughness: 0.32,
      emissive: new Color(kind === "large" ? 0x123038 : 0x2a1408),
      emissiveIntensity: 0.4,
    }),
  );
  hull.position.y = 1.1;
  root.add(hull);

  const dome = new Mesh(
    new SphereGeometry(radius * 0.38, 16, 12),
    glassMaterial(kind === "large" ? ICE : EMBER),
  );
  dome.scale.set(1, 0.55, 1);
  dome.position.y = 1.28;
  root.add(dome);

  const ring = new Mesh(
    new TorusGeometry(radius * 1.18, kind === "large" ? 0.06 : 0.045, 8, 28),
    new MeshBasicMaterial({
      color: kind === "large" ? ICE : EMBER,
      toneMapped: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.1;
  ring.name = "ring";
  root.add(ring);

  const ghosts = [0, 1, 2].map(() => {
    const g = root.clone();
    g.visible = false;
    return g;
  });
  return { root, ghosts, ring };
}

export function makeBullet(glow: CanvasTexture): BulletView {
  const mat = new MeshBasicMaterial({
    color: ICE,
    toneMapped: false,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new Mesh(new CylinderGeometry(0.09, 0.09, 1.15, 6), mat);
  mesh.rotation.x = Math.PI / 2;
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glow,
      color: ICE,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.scale.setScalar(1.5);
  const root = new Group();
  root.add(mesh);
  root.add(sprite);
  root.visible = false;
  root.position.y = 1.35;
  const ghost = root.clone();
  return { root, ghost, mesh };
}

export function makeSpark(glow: CanvasTexture) {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glow,
      color: EMBER,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
    }),
  );
  sprite.visible = false;
  sprite.position.y = 1.2;
  return sprite;
}

export function retintBullet(view: BulletView, color: number) {
  const meshMat = view.mesh.material as MeshBasicMaterial;
  meshMat.color.setHex(color);
  const sprite = view.root.children[1] as Sprite | undefined;
  if (sprite) (sprite.material as SpriteMaterial).color.setHex(color);
  const ghostMesh = view.ghost.children[0] as Mesh | undefined;
  const ghostMat = ghostMesh?.material;
  if (ghostMat && !Array.isArray(ghostMat) && "color" in ghostMat) {
    (ghostMat as MeshBasicMaterial).color.setHex(color);
  }
  const ghostSprite = view.ghost.children[1] as Sprite | undefined;
  if (ghostSprite) (ghostSprite.material as Material & { color?: Color }).color?.setHex(color);
}
