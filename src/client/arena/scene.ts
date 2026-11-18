// The 3D arena: four squircle platforms, a dock, and a token per player, driven
// straight from three.js (no react-three-fiber). Board3D.tsx owns the canvases and
// calls set() with each snapshot; this file owns the render loop.
//
// LOOK (BRAND.md): platforms are matte, one piece, never plastic and never
// self-lit. The only mark on the right answer is a thin mint ring. Tokens are
// billboarded canvas sprites with a blob shadow and no ring. The camera holds one
// angle and never turns sideways or rolls: framing shifts with setViewOffset.
//
// BUDGET: at most 40 tokens, one 2048 shadow map from the key light.

import { Kawarp } from "@kawarp/core";
import {
  ACESFilmicToneMapping,
  type BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  Path,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  Shape,
  ShapeGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Object3D,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BRACKETS, LIVES, MAX_PLAYERS, ZONE_COUNT } from "../../shared/config";
import type { StateMsg } from "../../shared/protocol";
import { avatarColor, FONT, initial, platformColor, reducedMotion, token } from "../common/brand";
import { GLYPHS, ICON_GRID } from "../common/icons";
import { bar, fitGrid, gridCell, standings, superellipse, type Positions, type RevealStage, type Spot, type Standing } from "./layout";

export interface SceneInput {
  state: StateMsg | null;
  positions: Positions;
  stage: RevealStage;
}

// ---- geometry, in world units

const S = 3.4; // platform side
const H = 0.42; // side wall height
const EDGE = 0.2; // the soft rounded edge (a deep bevel)
const TOP = H + EDGE; // walking surface
const GAP = 0.95; // the dead-zone gap between platforms
const P = S / 2 + GAP / 2;
const SPOTS: ReadonlyArray<readonly [number, number]> = [
  [-P, -P],
  [P, -P],
  [-P, P],
  [P, P],
];
// Close behind the front platforms, so waiting tokens stay in frame above the host dock.
const DOCK = { w: 10.2, d: 1.3, z: 4.7, h: 0.16, edge: 0.12 };
const DOCK_TOP = DOCK.h + DOCK.edge;
const FLOOR_Y = -12;
// On a platform, relative to its center. A sprite faces the camera, so it leans
// back over the ground behind it: the label sits far back and tokens far forward
// to keep the two apart.
const LABEL_Z = -1.05;
const STAND_Z = 1.3;
const MARK_SIZE = 2.3;
const MARK_Z = 0.2;

// A token sprite: hearts on top, the token, a name pill across its foot.
const TOKEN_W = 1.0;
const TOKEN_H = 1.1;
const TOKEN_PX = { w: 256, h: 280, cy: 136, r: 90 };
// From the foot of the sprite up to the middle of the face, per unit of scale.
const FACE_UP = ((TOKEN_PX.h - TOKEN_PX.cy) / TOKEN_PX.h - 0.02) * TOKEN_H;

// Light levels, kept low: too much light turns the platform colors pale.
const LIGHT = { environment: 0.4, sky: 0.45, key: 2.4, rim: 1.6 };

const SNAP = 128; // backdrop snapshot size, px
const LOBBY_SNAP_MS = 3000;
const REVEAL_SNAP_MS = 600;

interface Shot {
  pos: Vector3;
  look: Vector3;
  off: number; // horizontal view offset, as a fraction of the width
}

interface Platform {
  group: Group;
  label: Mesh<PlaneGeometry, MeshBasicMaterial>;
  labelKey: string;
  mark: Mesh<PlaneGeometry, MeshBasicMaterial>;
  x: number;
  z: number;
  y: number;
  vy: number;
  falling: boolean;
  spin: number;
}

interface TokenSprite {
  pid: string;
  order: number;
  sprite: Sprite;
  material: SpriteMaterial;
  shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture | null;
  drawn: string;
  on: Spot;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  size: number; // layout scale: smaller when a spot is crowded
  pop: number; // 0 to 1, eased
  falling: boolean;
  vy: number;
  spin: number;
}

function shapeOf(points: Array<[number, number]>): Shape {
  const shape = new Shape();
  points.forEach(([x, y], k) => (k ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  return shape;
}

// One extruded piece with a soft rounded edge, lying flat with its base at y = -edge.
function slab(shape: Shape, height: number, edge: number, segments: number): BufferGeometry {
  const extruded = new ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: true,
    bevelThickness: edge,
    bevelSize: edge,
    bevelSegments: segments,
    curveSegments: 1,
  });
  extruded.rotateX(-Math.PI / 2);
  // Extrusion shades each face flat, which shows as steps round the edge. Welding
  // the vertices and recomputing normals makes it one smooth piece.
  extruded.deleteAttribute("normal");
  extruded.deleteAttribute("uv");
  const geometry = mergeVertices(extruded, 1e-4);
  geometry.computeVertexNormals();
  extruded.dispose();
  return geometry;
}

// The answer ring: the platform's own outline pushed outward along its normals, so
// the gap and the width stay even all the way round (a scaled squircle would not).
function hugRing(gap: number, width: number): ShapeGeometry {
  const side = S - 2 * EDGE;
  const toV = (points: Array<[number, number]>) => points.map(([x, y]) => new Vector2(x, y));
  const shape = new Shape(toV(superellipse(side, side, 5, EDGE + gap + width, 160)));
  shape.holes.push(new Path(toV(superellipse(side, side, 5, EDGE + gap, 160))));
  const geometry = new ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Toward white (amount > 0) or black (amount < 0).
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const to = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (v: number) => Math.round(v + (to - v) * k);
  return `rgb(${mix(n >> 16)},${mix((n >> 8) & 255)},${mix(n & 255)})`;
}

// Render targets hold linear light; the backdrop wants what the screen shows.
const TO_SRGB = Uint8Array.from({ length: 256 }, (_, i) => {
  const v = i / 255;
  return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
});

export class ArenaScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(38, 16 / 9, 0.1, 200);
  private readonly reduce = reducedMotion();
  private readonly black = new Color(token("--color-bg"));
  private readonly platforms: Platform[] = [];
  private readonly tokens = new Map<string, TokenSprite>();
  private readonly ring: Mesh<ShapeGeometry, MeshBasicMaterial>;
  private readonly dock: Mesh;
  private readonly floor: Mesh;
  private readonly shadowTexture: CanvasTexture;
  private readonly shadowGeometry: PlaneGeometry;
  private readonly heart = new Path2D(GLYPHS.heart_fill.d);

  private readonly camPos = new Vector3(0, 7.6, 16.6);
  private readonly camLook = new Vector3(0, 0, 1.8);
  private camOff = 0;
  private width = 1;
  private height = 1;

  private input: SceneInput = { state: null, positions: new Map(), stage: 0 };
  private placed: Standing[] = [];
  private fontsReady = false;
  private frame = 0;
  private last = performance.now();
  private disposed = false;
  private tokenOrder = 0;

  // Backdrop (BRAND.md, Backgrounds): the board's own snapshot, blurred and warped.
  private kawarp: Kawarp | null = null;
  private kawarpTime = 0;
  private readonly snapTarget = new WebGLRenderTarget(SNAP, SNAP);
  private readonly snapPixels = new Uint8Array(SNAP * SNAP * 4);
  private readonly snapCamera = new OrthographicCamera(-1, 1, 1, -1, 1, 100);
  private snapKey = "";
  private snapAt = 0;
  private revealAt = 0;
  private revealKey = "";

  // Throws when WebGL is unavailable; Board3D shows the way to /host/2d instead.
  constructor(canvas: HTMLCanvasElement, backdrop: HTMLCanvasElement | null) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    const renderer = this.renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    // Low enough that the platform colors stay vivid under tone mapping.
    renderer.toneMappingExposure = 0.85;
    renderer.setClearColor(this.black, 0);
    renderer.shadowMap.enabled = true;

    // Soft studio light: a room environment at low intensity, a warm key, a cool rim.
    const pmrem = new PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = LIGHT.environment;
    pmrem.dispose();
    this.scene.add(new HemisphereLight(token("--light-sky"), token("--light-ground"), LIGHT.sky));
    const key = new DirectionalLight(token("--light-key"), LIGHT.key);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 2, far: 40 });
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    this.scene.add(key);
    const rim = new DirectionalLight(token("--light-rim"), LIGHT.rim);
    rim.position.set(-8, 6, -10);
    this.scene.add(rim);

    // Platforms.
    const slabGeometry = slab(shapeOf(superellipse(S - 2 * EDGE, S - 2 * EDGE, 5, 0, 160)), H, EDGE, 8);
    for (let i = 0; i < ZONE_COUNT; i++) {
      const [x, z] = SPOTS[i]!;
      const group = new Group();
      group.position.set(x, 0, z);
      const body = new Mesh(
        slabGeometry,
        // No emissive: self-glow turns the colors pale under tone mapping.
        new MeshStandardMaterial({ color: new Color(platformColor(i)), roughness: 0.58, metalness: 0, envMapIntensity: 0.3 }),
      );
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      // The bracket: the platform's mark, big and in the middle, as on its phone box.
      const mark = new Mesh(
        new PlaneGeometry(MARK_SIZE, MARK_SIZE),
        new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.set(0, TOP + 0.008, MARK_Z);
      mark.visible = false;
      group.add(mark);
      // The answer lies on the back half; tokens stand on the front half.
      const label = new Mesh(
        new PlaneGeometry(3.0, 0.75),
        new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
      );
      label.rotation.x = -Math.PI / 2;
      label.position.set(0, TOP + 0.01, LABEL_Z);
      label.visible = false;
      group.add(label);
      this.scene.add(group);
      this.platforms.push({ group, label, labelKey: "", mark, x, z, y: 0, vy: 0, falling: false, spin: i % 2 ? 1 : -1 });
    }

    this.ring = new Mesh(
      hugRing(0.1, 0.16),
      new MeshBasicMaterial({
        color: new Color(token("--color-live")),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    );
    // At the top of the side wall, so it reads as a ring around the platform.
    this.ring.position.y = H;
    this.platforms[0]!.group.add(this.ring);

    this.dock = new Mesh(
      // A bar, not a stretched squircle: see layout.ts.
      slab(shapeOf(bar(DOCK.w, DOCK.d, 5, 160)), DOCK.h, DOCK.edge, 4),
      new MeshStandardMaterial({ color: new Color(token("--color-line")), roughness: 0.8, envMapIntensity: 0.4 }),
    );
    this.dock.position.set(0, 0, DOCK.z);
    this.dock.receiveShadow = true;
    this.scene.add(this.dock);

    // A faint far floor, so a falling platform has somewhere to go.
    const floorCanvas = document.createElement("canvas");
    floorCanvas.width = floorCanvas.height = 256;
    const fg = floorCanvas.getContext("2d")!;
    const fade = fg.createRadialGradient(128, 128, 0, 128, 128, 128);
    fade.addColorStop(0, token("--color-surface2"));
    fade.addColorStop(1, token("--clear"));
    fg.fillStyle = fade;
    fg.fillRect(0, 0, 256, 256);
    const floorTexture = new CanvasTexture(floorCanvas);
    floorTexture.colorSpace = SRGBColorSpace;
    this.floor = new Mesh(
      new CircleGeometry(26, 48),
      new MeshBasicMaterial({ map: floorTexture, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = FLOOR_Y;
    this.scene.add(this.floor);

    // Blob shadow under each token (tokens are sprites; they cast no real shadow).
    const blob = document.createElement("canvas");
    blob.width = blob.height = 128;
    const bg = blob.getContext("2d")!;
    const soft = bg.createRadialGradient(64, 64, 0, 64, 64, 64);
    soft.addColorStop(0, token("--shadow-deep"));
    soft.addColorStop(1, token("--clear"));
    bg.fillStyle = soft;
    bg.fillRect(0, 0, 128, 128);
    this.shadowTexture = new CanvasTexture(blob);
    this.shadowGeometry = new PlaneGeometry(1.1, 0.6);
    this.shadowGeometry.rotateX(-Math.PI / 2);

    this.snapCamera.up.set(0, 0, -1);
    if (backdrop && !matchMedia("(prefers-contrast: more)").matches) {
      try {
        this.kawarp = new Kawarp(backdrop, { saturation: 1.3, transitionDuration: this.reduce ? 0 : 1000 });
      } catch {
        this.kawarp = null; // no WebGL for the backdrop: it stays solid black
      }
    }

    // Canvas text needs the font before the first draw.
    const fonts = [`700 98px ${FONT}`, `800 132px ${FONT}`, `600 36px ${FONT}`];
    void Promise.race([
      Promise.all(fonts.map((font) => document.fonts.load(font))),
      new Promise((resolve) => setTimeout(resolve, 2500)),
    ])
      .catch(() => undefined)
      .then(() => {
        if (this.disposed) return;
        this.fontsReady = true;
        this.sync();
      });

    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.frame = requestAnimationFrame(this.tick);
  }

  set(input: SceneInput): void {
    this.input = input;
    this.sync();
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.applyOffset();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    for (const token of this.tokens.values()) this.removeToken(token);
    this.tokens.clear();
    this.kawarp?.dispose();
    this.snapTarget.dispose();
    this.renderer.dispose();
  }

  // ---- state in

  private sync(): void {
    const { state, positions, stage } = this.input;
    this.placed = state ? standings(state, positions, stage) : [];
    this.syncLabels();
    this.syncTokens();
    const key = state?.phase === "reveal" ? `reveal:${state.questionNumber}` : "";
    if (key !== this.revealKey) {
      this.revealKey = key;
      this.revealAt = performance.now();
    }
    if (state?.phase === "reveal" && state.correct !== undefined) {
      const home = this.platforms[state.correct]?.group;
      if (home && this.ring.parent !== home) home.add(this.ring);
    }
  }

  private syncLabels(): void {
    if (!this.fontsReady) return;
    const answers = this.input.state?.question?.answers;
    this.platforms.forEach((platform, i) => {
      if (!platform.mark.visible) {
        platform.mark.material.map = this.texture(this.drawMark(BRACKETS[i]!));
        platform.mark.material.needsUpdate = true;
        platform.mark.visible = true;
      }
      const answer = answers?.[i] ?? "";
      const key = `${i}:${answer}`;
      if (key === platform.labelKey) return;
      platform.labelKey = key;
      const material = platform.label.material;
      material.map?.dispose();
      material.map = answer ? this.texture(this.drawLabel(answer)) : null;
      material.needsUpdate = true;
      // With no question the platform is clean: just its mark.
      platform.label.visible = answer !== "";
    });
  }

  private syncTokens(): void {
    const seen = new Set<string>();
    for (const standing of this.placed) {
      const p = standing.player;
      seen.add(p.pid);
      const at = this.spotFor(standing);
      let sprite = this.tokens.get(p.pid);
      if (!sprite) {
        if (this.tokens.size >= MAX_PLAYERS) continue;
        sprite = this.addToken(p.pid);
        sprite.x = at.x;
        sprite.z = at.z;
      }
      sprite.on = standing.spot;
      sprite.tx = at.x;
      sprite.tz = at.z;
      sprite.size = at.size;

      if (standing.falling && !sprite.falling) {
        sprite.falling = true;
        sprite.vy = 2.2;
      } else if (!standing.falling && sprite.falling) {
        // Respawn: straight back onto its spot, popping in.
        sprite.falling = false;
        sprite.spin = 0;
        sprite.material.rotation = 0;
        sprite.x = at.x;
        sprite.z = at.z;
        sprite.pop = 0;
      }

      const drawn = `${p.name}|${p.color}|${standing.lives}|${standing.ghost}`;
      if (this.fontsReady && drawn !== sprite.drawn) {
        sprite.drawn = drawn;
        this.drawToken(sprite, p.name, p.color, standing.lives, standing.ghost);
      }
    }
    for (const [pid, sprite] of this.tokens) {
      if (seen.has(pid)) continue;
      this.removeToken(sprite);
      this.tokens.delete(pid);
    }
  }

  // Where a standing is in the world, and how much it shrinks when crowded.
  private spotFor(standing: Standing): { x: number; z: number; size: number } {
    const { spot, index, count } = standing;
    if (spot === "dock") {
      // A few tokens spread out; a crowd packs into staggered rows and shrinks.
      const grid = fitGrid(count, DOCK.w - 1, DOCK.d, 0.98, 0.8);
      const cell = gridCell(index, count, grid);
      const spread = grid.rows === 1 ? Math.min(1.55, (DOCK.w - 1) / count) : 0.98 * grid.scale;
      const row = Math.floor(index / grid.cols);
      const stagger = grid.rows > 1 && row % 2 === 1 ? 0.5 : 0;
      return {
        x: (cell.col + stagger) * spread,
        z: DOCK.z + cell.row * 0.8 * grid.scale,
        size: grid.scale,
      };
    }
    // The front half of the platform, clear of the label on the back half.
    const platform = this.platforms[spot]!;
    const grid = fitGrid(count, 3.0, 1.4, 0.95, 1.25);
    const cell = gridCell(index, count, grid);
    return {
      x: platform.x + cell.col * 0.95 * grid.scale,
      z: platform.z + STAND_Z + cell.row * 1.25 * grid.scale,
      size: grid.scale,
    };
  }

  private addToken(pid: string): TokenSprite {
    const material = new SpriteMaterial({ transparent: true, depthWrite: false, toneMapped: false });
    const sprite = new Sprite(material);
    sprite.center.set(0.5, 0.02);
    sprite.visible = false;
    const shadow = new Mesh(
      this.shadowGeometry,
      new MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false }),
    );
    this.scene.add(sprite, shadow);
    const created: TokenSprite = {
      pid,
      order: this.tokenOrder++,
      sprite,
      material,
      shadow,
      canvas: document.createElement("canvas"),
      texture: null,
      drawn: "",
      on: "dock",
      x: 0,
      y: DOCK_TOP,
      z: DOCK.z,
      tx: 0,
      tz: DOCK.z,
      size: 1,
      pop: 0,
      falling: false,
      vy: 0,
      spin: 0,
    };
    this.tokens.set(pid, created);
    return created;
  }

  private removeToken(sprite: TokenSprite): void {
    this.scene.remove(sprite.sprite, sprite.shadow);
    sprite.texture?.dispose();
    sprite.material.dispose();
    sprite.shadow.material.dispose();
  }

  // ---- canvas textures

  private texture(canvas: HTMLCanvasElement): CanvasTexture {
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return texture;
  }

  private drawLabel(answer: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 256;
    const g = canvas.getContext("2d")!;
    g.fillStyle = token("--color-ink");
    g.globalAlpha = 0.86;
    g.textAlign = "center";
    g.textBaseline = "middle";
    // Shrink long answers to fit the platform.
    let size = 132;
    g.font = `800 ${size}px ${FONT}`;
    const width = g.measureText(answer).width;
    if (width > 990) {
      size = (size * 990) / width;
      g.font = `800 ${size}px ${FONT}`;
    }
    g.fillText(answer, 512, 134);
    return canvas;
  }

  // Quiet enough to sit under the tokens that stand over it.
  private drawMark(bracket: string): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const g = canvas.getContext("2d")!;
    g.fillStyle = token("--color-ink");
    g.globalAlpha = 0.26;
    g.textAlign = "center";
    g.textBaseline = "middle";
    let size = 330;
    g.font = `800 ${size}px ${FONT}`;
    const width = g.measureText(bracket).width;
    if (width > 470) {
      size = (size * 470) / width;
      g.font = `800 ${size}px ${FONT}`;
    }
    g.fillText(bracket, 256, 262);
    return canvas;
  }

  private drawToken(sprite: TokenSprite, name: string, color: number, lives: number, ghost: boolean): void {
    const canvas = sprite.canvas;
    canvas.width = TOKEN_PX.w;
    canvas.height = TOKEN_PX.h;
    const g = canvas.getContext("2d")!;
    const fill = avatarColor(color);
    g.textAlign = "center";
    g.textBaseline = "middle";

    for (let i = 0; i < LIVES; i++) {
      g.save();
      g.translate(85 + i * 30, 0);
      g.scale(26 / ICON_GRID, 26 / ICON_GRID);
      g.globalAlpha = i < lives ? 1 : 0.28;
      g.fillStyle = token("--color-stakes");
      g.fill(this.heart);
      g.restore();
    }

    const { cy, r } = TOKEN_PX;
    // Out of lives: the token fades in its own color (graphite is a player color).
    g.globalAlpha = ghost ? 0.32 : 1;
    // Matte, like a contact's monogram bubble: no gloss and no shading, only the
    // faint top-to-bottom tone brand.css gives every token.
    const matte = g.createLinearGradient(0, cy - r, 0, cy + r);
    matte.addColorStop(0, shade(fill, 0.14));
    matte.addColorStop(1, fill);
    // No ring: a soft shadow separates the token from a platform of its own color.
    g.save();
    g.shadowColor = token("--shadow");
    g.shadowBlur = 16;
    g.shadowOffsetY = 6;
    g.beginPath();
    g.arc(128, cy, r, 0, Math.PI * 2);
    g.fillStyle = matte;
    g.fill();
    g.restore();
    g.fillStyle = token("--color-text");
    g.font = `700 98px ${FONT}`;
    g.fillText(initial(name), 128, cy + 5);
    g.globalAlpha = 1;

    let size = 36;
    g.font = `600 ${size}px ${FONT}`;
    let textWidth = g.measureText(name).width;
    if (textWidth > 214) {
      size = Math.max(24, (size * 214) / textWidth);
      g.font = `600 ${size}px ${FONT}`;
      textWidth = Math.min(214, g.measureText(name).width);
    }
    const pill = textWidth + 34;
    g.globalAlpha = 0.9;
    g.fillStyle = token("--color-surface");
    roundRect(g, 128 - pill / 2, 226, pill, 48, 24);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = token("--color-text");
    g.fillText(name, 128, 251, 214);

    if (!sprite.texture) {
      sprite.texture = this.texture(canvas);
      sprite.material.map = sprite.texture;
      sprite.material.needsUpdate = true;
    } else {
      sprite.texture.needsUpdate = true;
    }
    sprite.sprite.visible = true;
  }

  // ---- the frame loop

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.step(dt, now / 1000);
    this.updateBackdrop(now);
    this.renderer.render(this.scene, this.camera);
    if (this.kawarp) {
      // Driven from this loop, not Kawarp's own, so it pauses with the stage.
      // Under reduced motion the warp stays still.
      this.kawarpTime += this.reduce ? 0 : dt;
      this.kawarp.renderFrame(this.kawarpTime);
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  private ease(dt: number, rate: number): number {
    return this.reduce ? 1 : 1 - Math.exp(-dt * rate);
  }

  private step(dt: number, t: number): void {
    const { state, stage } = this.input;
    const phase = state?.phase ?? "lobby";
    const reveal = phase === "reveal";
    const dropping = reveal && stage >= 1 && state?.floorHeld === false;

    // Drop: wrong platforms fall away under gravity. They rise again for the next question.
    this.platforms.forEach((platform, i) => {
      const shouldFall = dropping && i !== state?.correct;
      if (shouldFall && !platform.falling) {
        platform.falling = true;
        platform.vy = 0;
      } else if (!shouldFall && platform.falling) {
        platform.falling = false;
        platform.vy = 0;
        platform.group.rotation.set(0, 0, 0);
        platform.group.visible = true;
        platform.y = this.reduce ? 0 : -6;
      }
      if (platform.falling) {
        platform.vy -= 16 * dt;
        platform.y += platform.vy * dt;
        platform.group.rotation.z += platform.spin * dt * 0.35;
        platform.group.rotation.x += dt * 0.2;
        if (platform.y < -40) platform.group.visible = false;
      } else {
        platform.y += (0 - platform.y) * this.ease(dt, 3.2);
      }
      platform.group.position.y = platform.y;
    });

    // The ring: steady, no pulse.
    const ringMaterial = this.ring.material;
    const ringOn = reveal && performance.now() - this.revealAt > 250 ? 1 : 0;
    ringMaterial.opacity += (ringOn - ringMaterial.opacity) * this.ease(dt, 6);
    this.ring.visible = ringMaterial.opacity > 0.01;

    for (const sprite of this.tokens.values()) {
      if (sprite.falling) {
        // Fall: off the board with a spin.
        sprite.vy -= 20 * dt;
        sprite.y += sprite.vy * dt;
        sprite.spin += dt * 5;
        sprite.material.rotation = sprite.spin * 0.6;
        sprite.shadow.visible = false;
      } else {
        // Hop: ease to the spot, lifting with the distance still to go.
        const dx = sprite.tx - sprite.x;
        const dz = sprite.tz - sprite.z;
        const k = this.ease(dt, 3);
        sprite.x += dx * k;
        sprite.z += dz * k;
        const hop = this.reduce ? 0 : Math.min(0.9, Math.hypot(dx, dz) * 0.35);
        const bob = this.reduce ? 0 : Math.abs(Math.sin(t * 2.4 + sprite.order)) * 0.06;
        const base = sprite.on === "dock" ? DOCK_TOP : this.platforms[sprite.on]!.y + TOP + 0.006;
        sprite.y = base + hop + bob;
        sprite.shadow.visible = sprite.pop > 0.05 && sprite.sprite.visible;
        sprite.shadow.position.set(sprite.x, base + 0.004, sprite.z);
        const squash = (1 - Math.min(0.6, hop)) * sprite.size;
        sprite.shadow.scale.set(squash, 1, squash);
      }
      // Respawn and join: a pop-in.
      sprite.pop += (1 - sprite.pop) * this.ease(dt, 7);
      sprite.sprite.position.set(sprite.x, sprite.y, sprite.z);
      sprite.sprite.scale.set(TOKEN_W * sprite.pop * sprite.size, TOKEN_H * sprite.pop * sprite.size, 1);
    }

    const shot = this.shotFor(phase, state?.correct);
    const k = this.ease(dt, 1.8);
    this.camPos.lerp(shot.pos, k);
    this.camLook.lerp(shot.look, k);
    this.camOff += (shot.off - this.camOff) * k;
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.applyOffset();
  }

  // Three shots from one angle. In each, the position and the look target share
  // an x, so the board stays square to the screen.
  private readonly shotLobby: Shot = { pos: new Vector3(0, 7.6, 16.6), look: new Vector3(0, 0, 1.8), off: -0.13 };
  // Framed so the back labels clear the question card and the dock clears the host controls.
  private readonly shotQuestion: Shot = { pos: new Vector3(0, 10.73, 12.65), look: new Vector3(0, 0, -0.14), off: 0 };
  private readonly shotOver: Shot = { pos: new Vector3(0, 7.6, 16.6), look: new Vector3(0, 0, 1.8), off: 0 };
  private readonly shotReveal: Shot = { pos: new Vector3(), look: new Vector3(), off: 0 };

  private shotFor(phase: string, correct: number | undefined): Shot {
    if (phase === "lobby") return this.shotLobby;
    if (phase === "over") return this.shotOver;
    if (phase === "reveal" && correct !== undefined) {
      // A close-up on the right platform.
      const platform = this.platforms[correct]!;
      this.shotReveal.pos.set(platform.x, 7.6, platform.z + 7.575);
      this.shotReveal.look.set(platform.x, 0, platform.z - 0.725);
      return this.shotReveal;
    }
    return this.shotQuestion;
  }

  private applyOffset(): void {
    this.camera.setViewOffset(this.width, this.height, this.camOff * this.width, 0, this.width, this.height);
  }

  // ---- backdrop

  private updateBackdrop(now: number): void {
    if (!this.kawarp || !this.fontsReady) return;
    const state = this.input.state;
    if (!state) return;

    let key = this.snapKey;
    let take: (() => void) | null = null;
    const sprites = [...this.tokens.values()];
    const tokenParts: Object3D[] = sprites.flatMap((s) => [s.sprite, s.shadow]);

    if (state.phase === "lobby" || state.phase === "over") {
      // The newest player's token face (the winner's, once the game is over).
      const pid = state.phase === "over" ? state.winners[0]?.pid : state.players.at(-1)?.pid;
      const face = pid ? this.tokens.get(pid) : undefined;
      if (!face || !face.texture || face.pop < 0.9 || face.falling) return;
      key = `${state.phase}:${pid}:${face.drawn}`;
      // Blurring many tokens together turns to mud, so one face, and not too often.
      if (key !== this.snapKey && this.snapKey.startsWith(state.phase) && now - this.snapAt < LOBBY_SNAP_MS) return;
      const half = 0.25 * face.size;
      take = () => this.snapshot(face.x, face.z - FACE_UP * face.size, half, [this.dock, this.floor]);
    } else if (state.phase === "question") {
      // The four platforms with their labels, once, when the question starts.
      key = `question:${state.questionNumber}`;
      take = () => this.snapshot(0, 0, 4.0, [this.dock, this.floor, this.ring, ...tokenParts]);
    } else if (state.phase === "reveal" && state.correct !== undefined) {
      // The right platform alone, so the whole screen takes the answer's color.
      if (now - this.revealAt < REVEAL_SNAP_MS) return;
      key = `reveal:${state.questionNumber}`;
      const platform = this.platforms[state.correct]!;
      take = () => this.snapshot(platform.x, platform.z, 1.45, [this.floor, this.ring, ...tokenParts]);
    }
    if (!take || key === this.snapKey) return;
    this.snapKey = key;
    this.snapAt = now;
    take();
  }

  // A small top-down picture of part of the board: its "artwork".
  private snapshot(cx: number, cz: number, half: number, hide: Object3D[]): void {
    const hidden = hide.filter((object) => object.visible);
    for (const object of hidden) object.visible = false;
    const camera = this.snapCamera;
    Object.assign(camera, { left: -half, right: half, top: half, bottom: -half });
    camera.updateProjectionMatrix();
    camera.position.set(cx, 50, cz);
    camera.lookAt(cx, 0, cz);

    const renderer = this.renderer;
    renderer.setRenderTarget(this.snapTarget);
    renderer.setClearColor(this.black, 1);
    renderer.render(this.scene, camera);
    renderer.readRenderTargetPixels(this.snapTarget, 0, 0, SNAP, SNAP, this.snapPixels);
    renderer.setRenderTarget(null);
    renderer.setClearColor(this.black, 0);
    for (const object of hidden) object.visible = true;

    const pixels = this.snapPixels;
    for (let i = 0; i < pixels.length; i += 4) {
      pixels[i] = TO_SRGB[pixels[i]!]!;
      pixels[i + 1] = TO_SRGB[pixels[i + 1]!]!;
      pixels[i + 2] = TO_SRGB[pixels[i + 2]!]!;
    }
    this.kawarp?.loadImageData(pixels, SNAP, SNAP);
  }
}
