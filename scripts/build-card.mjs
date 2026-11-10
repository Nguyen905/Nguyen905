// Builds the profile images as static SVGs from public GitHub data:
//   dist/profile-card[-dark].svg   name, stats and top languages
//   dist/dragon-city[-dark].svg    a voxel dragon burning the contribution skyline
//
// No dependencies. Needs Node 18+.
//   GH_LOGIN=<user> GH_TOKEN=<token> node scripts/build-card.mjs
//   FIXTURE=sample.json node scripts/build-card.mjs   (offline preview)

import { mkdir, readFile, writeFile } from "node:fs/promises";

const OUT_DIR = process.env.OUT_DIR ?? "dist";

const QUERY = `query ($login: String!) {
  user(login: $login) {
    login
    bio
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount weekday } }
      }
    }
  }
}`;

const THEMES = {
  light: {
    ink: "#1f2328",
    muted: "#59636e",
    box: "#8250df",
    extrude: "#c9b3f2",
    empty: "#ebedf0",
    char: "#3b2a26",
    shadow: 0.2,
    languageRamp: ["#216e39", "#30a14e", "#40c463", "#9be9a8"],
    cityRamp: ["#9be9a8", "#40c463", "#30a14e", "#216e39"],
  },
  dark: {
    ink: "#e6edf3",
    muted: "#9198a1",
    box: "#a371f7",
    extrude: "#5a3e9b",
    empty: "#21262d",
    char: "#5a3f33",
    shadow: 0.55,
    languageRamp: ["#39d353", "#26a641", "#006d32", "#0e4429"],
    cityRamp: ["#0e4429", "#006d32", "#26a641", "#39d353"],
  },
};

const n = (value) => +value.toFixed(1);
const shade = (hex, k) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k).toString(16).padStart(2, "0")).join("");
const poly = (points) => "M" + points.map(([x, y]) => `${n(x)} ${n(y)}`).join("L") + "Z";
const escapeXml = (value) => String(value).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plural = (count, one, many) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

// ---------------------------------------------------------------- data

async function loadUser() {
  if (process.env.FIXTURE) return JSON.parse(await readFile(process.env.FIXTURE, "utf8"));

  const { GH_LOGIN: login, GH_TOKEN: token } = process.env;
  if (!login || !token) throw new Error("Set GH_LOGIN and GH_TOKEN, or FIXTURE.");

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-card-builder",
    },
    body: JSON.stringify({ query: QUERY, variables: { login } }),
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}.`);

  const { data, errors } = await response.json();
  if (errors?.length) throw new Error(errors.map((e) => e.message).join("; "));
  if (!data?.user) throw new Error(`User ${login} was not found.`);
  return data.user;
}

function summarize(user) {
  const repos = user.repositories.nodes;
  const calendar = user.contributionsCollection.contributionCalendar;

  let streak = 0;
  let longestStreak = 0;
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) {
      streak = day.contributionCount > 0 ? streak + 1 : 0;
      longestStreak = Math.max(longestStreak, streak);
    }
  }

  const sizes = new Map();
  for (const repo of repos) {
    for (const { size, node } of repo.languages.edges) {
      sizes.set(node.name, (sizes.get(node.name) ?? 0) + size);
    }
  }
  const totalSize = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const languages = [...sizes]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name, size]) => ({ name, cells: Math.max(1, Math.round((size / totalSize) * 10)) }));

  return {
    login: user.login,
    bio: user.bio?.trim().replace(/\s+/g, " ").slice(0, 60) ?? "",
    contributions: calendar.totalContributions,
    longestStreak,
    stars: repos.reduce((sum, repo) => sum + repo.stargazerCount, 0),
    repoCount: user.repositories.totalCount,
    languages,
    days: calendar.weeks.flatMap((week, c) =>
      week.contributionDays.map((day) => ({ c, r: day.weekday, count: day.contributionCount })),
    ),
    weekCount: calendar.weeks.length,
  };
}

// ---------------------------------------------------------------- profile card

function renderCard(stats, theme) {
  const WIDTH = 880;
  const BOX_RIGHT = 570;
  const BOX_TOP = 16.5;
  const PAD = 24;
  const WORD_LEFT = 24;
  const TEXT_LEFT = 28; // lines up with the first letter, which has side bearing
  const chars = stats.login.length;

  // The name always fits inside the box, extrusion included. Monospace glyphs are 0.6em wide.
  const fontSize = Math.min(120, (BOX_RIGHT - WORD_LEFT - PAD - 8) / chars / 0.6);
  const depth = Math.max(3, Math.min(8, Math.round(fontSize / 12)));
  const wordLength = Math.round(fontSize * 0.6 * chars);
  const wordY = Math.round(BOX_TOP + PAD + fontSize * 0.74);
  const belowWord = wordY + Math.round(fontSize * 0.24);

  const lines = [
    plural(stats.contributions, "contribution", "contributions") + " in the last year",
    plural(stats.longestStreak, "day", "days") + " in the longest streak",
    plural(stats.stars, "star", "stars") + " across " + plural(stats.repoCount, "public repository", "public repositories"),
  ];

  const bioY = belowWord + 32;
  const textTop = stats.bio ? bioY + 34 : belowWord + 36;
  const height = textTop + (lines.length - 1) * 30 + 40;

  const wordAttrs = `font-size="${fontSize.toFixed(2)}" textLength="${wordLength}" lengthAdjust="spacingAndGlyphs"`;
  const word = escapeXml(stats.login);
  const extrusion = Array.from({ length: depth }, (_, i) => {
    const d = depth - i;
    return `<text class="word" style="fill:${theme.extrude}" x="${WORD_LEFT + d}" y="${n(wordY + d * 0.6)}" ${wordAttrs}>${word}</text>`;
  }).join("");

  const sentence = lines
    .map((line, i) => `<text class="line" x="${TEXT_LEFT}" y="${textTop + i * 30}">${escapeXml(line)}</text>`)
    .join("\n  ");

  const bio = stats.bio ? `<text class="bio" x="${TEXT_LEFT}" y="${bioY}">${escapeXml(stats.bio)}</text>` : "";

  const languages = stats.languages
    .map(({ name, cells }, row) => {
      const y = textTop - 14 + row * 24;
      const squares = Array.from({ length: 10 }, (_, i) => {
        const fill = i < cells ? theme.languageRamp[row] : theme.empty;
        return `<rect x="${716 + i * 15}" y="${y}" width="11" height="11" rx="2" fill="${fill}"/>`;
      }).join("");
      return `<text class="lang" x="628" y="${y + 10}">${escapeXml(name)}</text>${squares}`;
    })
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" role="img" aria-label="${escapeXml(`${stats.login}: ${lines.join(", ")}`)}">
  <style>
    text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif; }
    .word { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace; font-weight: 800; fill: ${theme.ink}; }
    .line { font-size: 21px; fill: ${theme.ink}; }
    .bio { font-size: 18px; fill: ${theme.muted}; }
    .lang { font-size: 14px; fill: ${theme.muted}; }
  </style>
  <rect x="0.5" y="${BOX_TOP}" width="${BOX_RIGHT}" height="${height - 33}" fill="none" stroke="${theme.box}" stroke-width="1.5"/>
  ${extrusion}<text class="word" x="${WORD_LEFT}" y="${wordY}" ${wordAttrs}>${word}</text>
  ${bio}
  ${sentence}
  ${languages}
</svg>
`;
}

// ---------------------------------------------------------------- voxel dragon

const FACE_SHADE = { t: 1, f: 0.74, s: 0.54 };
const VOXEL = 3;
// x runs towards the head, y towards the viewer, z up.
const project = (x, y, z) => [x * VOXEL * 0.986 + y * VOXEL * -0.58, x * VOXEL * 0.167 + y * VOXEL * 0.377 - z * VOXEL];
const COLOR = {
  scale: "#a3202a",
  scaleDark: "#761521",
  ridge: "#4a0d16",
  belly: "#d9a441",
  bellyDark: "#b07e2c",
  horn: "#efe3c4",
  hornTip: "#5b4632",
  eye: "#fff06a",
  mouth: "#ff8a1f",
  tooth: "#fbf6e8",
  wing: "#951f2a",
  wingDark: "#741823",
  bone: "#3d0c14",
  claw: "#22171a",
};

const key = (x, y, z) => `${x},${y},${z}`;

function sweep(voxels, points, paint, depthRatio = 0.8) {
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z, (b.y ?? 0) - (a.y ?? 0)) * 4);
    for (let s = 0; s <= steps; s++) {
      const u = s / steps;
      const cx = a.x + (b.x - a.x) * u;
      const cz = a.z + (b.z - a.z) * u;
      const cy = (a.y ?? 0) + ((b.y ?? 0) - (a.y ?? 0)) * u;
      const r = a.r + (b.r - a.r) * u;
      const ry = Math.max(0.5, r * depthRatio);
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        for (let z = Math.floor(cz - r); z <= cz + r; z++)
          for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
            if (((x + 0.5 - cx) / r) ** 2 + ((z + 0.5 - cz) / r) ** 2 + ((y + 0.5 - cy) / ry) ** 2 > 1) continue;
            voxels.set(key(x, y, z), typeof paint === "function" ? paint({ x, y, z, dz: z + 0.5 - cz, r }) : paint);
          }
    }
  }
}

// Highest or lowest occupied cell along one axis, or undefined.
function extreme(voxels, fixed, axis, pick) {
  let best;
  for (let v = -40; v <= 60; v++) {
    const at = { ...fixed, [axis]: v };
    if (voxels.has(key(at.x, at.y, at.z))) best = best === undefined ? v : pick(best, v);
  }
  return best;
}

const skin = ({ x, y, z, dz, r }) => {
  if (dz < -0.4 * r) return x % 3 === 0 ? COLOR.bellyDark : COLOR.belly;
  return (x * 7 + y * 3 + z * 5) % 11 === 0 ? COLOR.scaleDark : COLOR.scale;
};

const SPINE = [
  { x: -50, z: 16, r: 0.7 }, { x: -44, z: 11, r: 1 }, { x: -37, z: 6, r: 1.5 }, { x: -29, z: 3, r: 2.2 },
  { x: -21, z: 1, r: 3.2 }, { x: -13, z: 0, r: 4.6 }, { x: -5, z: 0, r: 6.2 }, { x: 3, z: 1.5, r: 7 },
  { x: 9, z: 4, r: 6.2 }, { x: 14, z: 9, r: 4.8 }, { x: 17, z: 15, r: 4.2 }, { x: 20, z: 20, r: 4 },
  { x: 23, z: 23, r: 4 },
];

function buildDragonBody() {
  const voxels = new Map();
  const put = (x, y, z, color) => voxels.set(key(x, y, z), color);

  sweep(voxels, SPINE, skin);

  // Head: skull, open jaws, teeth and a glowing mouth.
  sweep(voxels, [{ x: 22, z: 23, r: 4 }, { x: 27, z: 25, r: 4.8 }], skin);
  const upper = new Map();
  const lower = new Map();
  sweep(upper, [{ x: 27, z: 25, r: 4 }, { x: 32, z: 24, r: 2.9 }, { x: 37.5, z: 23, r: 2.2 }], skin, 0.75);
  sweep(lower, [{ x: 25, z: 20.5, r: 2.6 }, { x: 30, z: 18, r: 1.9 }, { x: 35.5, z: 15.2, r: 1.2 }], skin, 0.75);

  const extras = new Map();
  for (const y of [-1, 0]) {
    for (let x = 27; x <= 36; x++) {
      const top = extreme(lower, { x, y }, "z", Math.max);
      const bottom = extreme(upper, { x, y }, "z", Math.min);
      if (top === undefined || bottom === undefined) continue;
      for (let z = top + 1; z < bottom; z++) extras.set(key(x, y, z), COLOR.mouth);
    }
  }
  for (const y of [-1, 1]) {
    for (const x of [29, 31, 33, 35]) {
      const bottom = extreme(upper, { x, y }, "z", Math.min);
      if (bottom !== undefined) extras.set(key(x, y, bottom - 1), COLOR.tooth);
    }
    for (const x of [28, 30, 32, 34]) {
      const top = extreme(lower, { x, y }, "z", Math.max);
      if (top !== undefined) extras.set(key(x, y, top + 1), COLOR.tooth);
    }
  }
  for (const map of [upper, lower, extras]) for (const [k, color] of map) voxels.set(k, color);
  for (const y of [-1, 1]) {
    const top = extreme(voxels, { x: 36, y }, "z", Math.max);
    if (top !== undefined) put(36, y, top, COLOR.ridge);
  }

  // A glowing eye under a heavy brow, on the side facing the viewer.
  const eyeY = extreme(voxels, { x: 29, z: 26 }, "y", Math.max);
  for (const x of [28, 29]) put(x, extreme(voxels, { x, z: 26 }, "y", Math.max), 26, COLOR.eye);
  for (const [x, z] of [[26, 28], [27, 27], [28, 27], [29, 27], [30, 27]]) {
    put(x, extreme(voxels, { x, z }, "y", Math.max) + 1, z, COLOR.ridge);
  }

  // Swept-back horns and cheek spikes.
  for (const side of [-1, 1]) {
    sweep(voxels, [
      { x: 25, y: 2.8 * side, z: 28.5, r: 1.6 }, { x: 21, y: 3.4 * side, z: 32, r: 1.2 },
      { x: 16, y: 3.8 * side, z: 34, r: 0.9 },
    ], COLOR.horn, 1);
    sweep(voxels, [{ x: 16, y: 3.8 * side, z: 34, r: 0.9 }, { x: 10, y: 4 * side, z: 34.5, r: 0.5 }], COLOR.hornTip, 1);
    sweep(voxels, [{ x: 24, y: 3.8 * side, z: 25.5, r: 1.1 }, { x: 20, y: 5 * side, z: 26.5, r: 0.8 }, { x: 16, y: 5.3 * side, z: 26.5, r: 0.45 }], COLOR.horn, 1);
    sweep(voxels, [{ x: 26, y: 3.4 * side, z: 21, r: 0.8 }, { x: 23, y: 4.6 * side, z: 19.5, r: 0.5 }], COLOR.horn, 1);
  }

  // Spikes along the back, leaning towards the tail, with bone-coloured tips.
  for (let x = -46; x <= 21; x += 2) {
    const i = SPINE.findIndex((p, j) => SPINE[j + 1] && p.x <= x && x <= SPINE[j + 1].x);
    const [a, b] = [SPINE[i], SPINE[i + 1]];
    const u = (x - a.x) / (b.x - a.x);
    const r = a.r + (b.r - a.r) * u;
    const top = Math.round(a.z + (b.z - a.z) * u + r);
    const height = Math.max(1, Math.round(Math.min(5, r * 0.8)));
    for (let k = 0; k < height; k++) {
      put(x - Math.floor(k / 2), 0, top + k, k === height - 1 && height > 2 ? COLOR.horn : COLOR.ridge);
    }
  }

  // Spade at the end of the tail.
  for (let x = -57; x <= -49; x++)
    for (let z = 15; z <= 21; z++)
      if (Math.abs(x + 53) / 4 + Math.abs(z - 18) / 3 <= 1) put(x, 0, z, COLOR.ridge);

  // Front legs reach forward, hind legs tuck under the body.
  for (const side of [-1, 1]) {
    const y = 4.5 * side;
    sweep(voxels, [{ x: 8, y, z: 1, r: 2.6 }, { x: 10, y, z: -4, r: 1.9 }, { x: 13, y, z: -7, r: 1.4 }], COLOR.scale, 1);
    for (const dy of [-0.9, 0.9]) {
      sweep(voxels, [{ x: 13, y: y + dy, z: -7, r: 0.9 }, { x: 16, y: y + dy, z: -9, r: 0.5 }], COLOR.claw, 1);
    }
    const hy = 5 * side;
    sweep(voxels, [{ x: -7, y: hy, z: -1, r: 3.3 }, { x: -5, y: hy, z: -5, r: 2.4 }], COLOR.scale, 1);
    sweep(voxels, [{ x: -5, y: hy, z: -5, r: 1.8 }, { x: -9, y: hy, z: -8, r: 1.3 }], COLOR.scale, 1);
    for (const dy of [-0.9, 0.9]) {
      sweep(voxels, [{ x: -9, y: hy + dy, z: -8.5, r: 0.9 }, { x: -6, y: hy + dy, z: -10, r: 0.5 }], COLOR.claw, 1);
    }
  }

  return { voxels, eye: [28.5, eyeY + 1, 26.5], mouth: [37.5, 0, 19.5] };
}

function buildDragonWing(root, spread) {
  // The membrane leans away from the body as it rises, so the wings fan out in depth.
  const yAt = (z) => root + Math.round(z * spread);
  const outline = [[7, 0], [16, 24], [10, 40], [0, 28], [-6, 36], [-12, 23], [-20, 29], [-22, 15], [-32, 18], [-20, 5], [-12, 0]];
  const inside = (px, pz) => {
    let hit = false;
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const [xi, zi] = outline[i];
      const [xj, zj] = outline[j];
      if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) hit = !hit;
    }
    return hit;
  };
  const wrist = [16, 24];
  const bones = [[[7, 0], wrist], [wrist, [10, 40]], [wrist, [-6, 36]], [wrist, [-20, 29]], [wrist, [-32, 18]]];
  const boneDistance = (px, pz) =>
    Math.min(...bones.map(([[ax, az], [bx, bz]]) => {
      const dx = bx - ax;
      const dz = bz - az;
      const u = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)));
      return Math.hypot(px - ax - dx * u, pz - az - dz * u);
    }));

  const voxels = new Map();
  for (let x = -34; x <= 20; x++)
    for (let z = 0; z <= 42; z++) {
      if (!inside(x + 0.5, z + 0.5)) continue;
      const d = boneDistance(x + 0.5, z + 0.5);
      voxels.set(key(x, yAt(z), z), d < 0.9 ? COLOR.bone : d < 3 ? COLOR.wing : COLOR.wingDark);
    }
  sweep(voxels, [{ x: 16, y: yAt(24), z: 24, r: 0.9 }, { x: 19, y: yAt(28), z: 28, r: 0.5 }], COLOR.claw, 1);
  return voxels;
}

function renderVoxels(voxels, dim = 1) {
  const cells = [...voxels].map(([k, color]) => [...k.split(",").map(Number), color]);
  cells.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));

  const corners = {
    t: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    f: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
    s: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  };
  const neighbour = { t: [0, 0, 1], f: [0, 1, 0], s: [1, 0, 0] };
  const runs = [];
  const styles = new Map();
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };

  for (const [x, y, z, color] of cells) {
    for (const face of ["s", "f", "t"]) {
      const [a, b, c] = neighbour[face];
      if (voxels.has(key(x + a, y + b, z + c))) continue;
      const name = `v${color.slice(1)}${face}${dim === 1 ? "" : "d"}`;
      const fill = shade(color, FACE_SHADE[face] * dim);
      styles.set(name, `.${name}{fill:${fill};stroke:${fill};stroke-width:.35}`);
      const points = corners[face].map(([i, j, k]) => project(x + i, y + j, z + k));
      for (const [px, py] of points) {
        bounds.minX = Math.min(bounds.minX, px);
        bounds.maxX = Math.max(bounds.maxX, px);
        bounds.minY = Math.min(bounds.minY, py);
        bounds.maxY = Math.max(bounds.maxY, py);
      }
      const d = poly(points);
      const last = runs[runs.length - 1];
      if (last?.name === name) last.d += d;
      else runs.push({ name, d });
    }
  }
  return { paths: runs.map((run) => `<path class="${run.name}" d="${run.d}"/>`).join(""), css: [...styles.values()].join(""), bounds };
}

function renderFlame() {
  let seed = 20261109;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  const cube = (id, color) => {
    const point = ([x, y, z]) => project(x * 3.4, y * 3.4, z * 3.4);
    const face = (points, k) => `<path fill="${shade(color, k)}" d="${poly(points.map(point))}"/>`;
    return `<g id="${id}">${face([[.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [.5, -.5, .5]], 0.6)}${face([[-.5, .5, -.5], [.5, .5, -.5], [.5, .5, .5], [-.5, .5, .5]], 0.8)}${face([[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5]], 1)}</g>`;
  };

  const COUNT = 150;
  let particles = "";
  for (let i = 0; i < COUNT; i++) {
    const u = i / COUNT;
    const core = u < 0.32;
    const middle = u < 0.68;
    const reach = (core ? 0.55 : middle ? 0.8 : 1) * (0.75 + random() * 0.3);
    const angle = 0.9 + (random() - 0.5) * (core ? 0.26 : 0.6);
    const x = Math.round(Math.cos(angle) * 250 * reach);
    const y = Math.round(Math.sin(angle) * 250 * reach);
    const size = (0.55 + random() * 0.9).toFixed(2);
    const id = core ? "fy" : middle ? "fo" : "fr";
    particles += `<g class="p" style="--x:${x}px;--y:${y}px;--s:${size};animation-delay:-${Math.round(random() * 620)}ms"><use href="#${id}"/></g>`;
  }
  return { defs: cube("fy", "#ffe45c") + cube("fo", "#ff9a1f") + cube("fr", "#e8381f"), particles };
}

const DRAGON = (() => {
  const body = buildDragonBody();
  const far = renderVoxels(buildDragonWing(-6, -0.45), 0.7);
  const near = renderVoxels(buildDragonWing(7, 0.45));
  const rendered = renderVoxels(body.voxels);
  const shoulder = project(4, 0, 9);
  const shifted = (b) => ({ minX: b.minX + shoulder[0], maxX: b.maxX + shoulder[0], minY: b.minY + shoulder[1], maxY: b.maxY + shoulder[1] });
  const all = [rendered.bounds, shifted(far.bounds), shifted(near.bounds)];
  return {
    far,
    near,
    body: rendered,
    flame: renderFlame(),
    shoulder,
    eye: project(...body.eye),
    mouth: project(...body.mouth),
    bounds: {
      minX: Math.min(...all.map((b) => b.minX)),
      maxX: Math.max(...all.map((b) => b.maxX)),
      minY: Math.min(...all.map((b) => b.minY)),
    },
  };
})();

// ---------------------------------------------------------------- dragon scene

function renderScene(stats, theme) {
  const WEEK = [13.6, 2.3];
  const DAY = [-8, 5.2];
  const SLOPE = WEEK[1] / WEEK[0];
  const LOOP = 12; // seconds
  const TRAVEL = 9; // seconds to cross the scene
  const LIFT = 150; // how high the dragon flies above the middle of the grid
  const FIRE_REACH = 245; // how far ahead of the dragon the flame lands
  const BOB = 6;

  const width = Math.ceil(stats.weekCount * WEEK[0] + 64);
  const startX = -Math.ceil(DRAGON.bounds.maxX + 190);
  const endX = width + Math.ceil(-DRAGON.bounds.minX + 10);
  // Lowest grid position that keeps the wing tips inside the image once the dragon is in view.
  const firstVisibleX = -DRAGON.bounds.maxX;
  const cityY = Math.max(225, Math.ceil(4 + BOB - DRAGON.bounds.minY - 18 - (firstVisibleX - 64) * SLOPE + LIFT));
  const CITY = [64, cityY];
  const height = Math.ceil(CITY[1] + stats.weekCount * WEEK[1] + 7 * DAY[1] + 12);
  const anchorY = (x) => CITY[1] + 18 + (x - CITY[0]) * SLOPE - LIFT;

  const point = (c, r, up = 0) => [CITY[0] + c * WEEK[0] + r * DAY[0], CITY[1] + c * WEEK[1] + r * DAY[1] - up];
  const gap = 0.09;
  const tile = ({ c, r }, up) =>
    [[c + gap, r + gap], [c + 1 - gap, r + gap], [c + 1 - gap, r + 1 - gap], [c + gap, r + 1 - gap]].map(([a, b]) => point(a, b, up));

  const bars = stats.days.filter((day) => day.count > 0);
  const max = Math.max(1, ...bars.map((day) => day.count));
  const peak = bars.reduce((best, day) => (!best || day.count > best.count ? day : best), null);

  const ground = stats.days.filter((day) => day.count === 0).map((day) => poly(tile(day, 0))).join("");
  const blocks = bars
    .map((day) => {
      const tall = 7 + Math.sqrt(day.count / max) * 62;
      const [, b, c, e] = tile(day, 0);
      const [tA, tB, tC, tE] = tile(day, tall);
      const id = day === peak ? "p" : Math.min(3, Math.floor((day.count / max) * 4));
      const x = point(day.c + 0.5, day.r + 0.5)[0];
      const delay = ((x - FIRE_REACH - startX) / (endX - startX)) * TRAVEL;
      return `<g class="b" style="--d:${Math.round(delay * 1000)}ms"><path class="s${id}" d="${poly([b, c, tC, tB])}"/><path class="f${id}" d="${poly([e, c, tC, tE])}"/><path class="t${id}" d="${poly([tA, tB, tC, tE])}"/></g>`;
    })
    .join("");

  const blockCss = [...theme.cityRamp.map((color, i) => [i, color]), ["p", theme.box]]
    .flatMap(([id, color]) =>
      Object.entries(FACE_SHADE).map(([face, k]) => {
        const base = shade(color, k);
        return `.${face}${id}{fill:${base};animation-name:b${face}${id}}@keyframes b${face}${id}{0%{fill:${base}}1.5%{fill:${shade("#ffd54a", k)}}6%{fill:${shade("#ff6a1f", k)}}14%,45%{fill:${shade(theme.char, k)}}62%,100%{fill:${base}}}`;
      }),
    )
    .join("");

  const restX = Math.round(width / 3);
  const shoulder = `translate(${n(DRAGON.shoulder[0])} ${n(DRAGON.shoulder[1])})`;
  const shadowX = -25;
  const angle = n((Math.atan(SLOPE) * 180) / Math.PI);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="A voxel dragon flies across a 3D contribution skyline and breathes fire on it">
<style>${blockCss}${DRAGON.far.css}${DRAGON.body.css}${DRAGON.near.css}
.b{transform-box:fill-box;transform-origin:50% 100%}
.fly{transform:translate(${restX}px,${n(anchorY(restX))}px)}
.p{transform:translate(calc(var(--x)*.6),calc(var(--y)*.6)) scale(var(--s))}
@media (prefers-reduced-motion:no-preference){
.b,.b path{animation-duration:${LOOP}s;animation-timing-function:linear;animation-delay:var(--d);animation-iteration-count:infinite}
.b{animation-name:melt}
.fly{animation:fly ${LOOP}s linear infinite}
.bob{animation:bob 1.3s ease-in-out infinite}
.flap{animation:flap 1.3s ease-in-out infinite}
.shadow{animation:shadow 1.3s ease-in-out infinite}
.p{animation:spit 700ms linear infinite}
.glow{animation:glow 240ms ease-in-out infinite alternate}
}
@keyframes melt{0%{transform:scaleY(1)}6%{transform:scaleY(1.07)}16%,45%{transform:scaleY(.38)}60%{transform:scaleY(1.04)}66%,100%{transform:scaleY(1)}}
@keyframes fly{0%{transform:translate(${startX}px,${n(anchorY(startX))}px)}${n((TRAVEL / LOOP) * 100)}%,100%{transform:translate(${endX}px,${n(anchorY(endX))}px)}}
@keyframes bob{0%,100%{translate:0 ${BOB}px}38%{translate:0 -${BOB}px}}
@keyframes flap{0%,100%{transform:scaleY(1)}38%{transform:scaleY(-.45)}}
@keyframes shadow{0%,100%{opacity:1}38%{opacity:.75}}
@keyframes spit{0%{transform:translate(0,0) scale(calc(var(--s)*.35));opacity:0}12%{opacity:1}35%{transform:translate(calc(var(--x)*.35),calc(var(--y)*.35)) scale(var(--s))}88%{opacity:.95}100%{transform:translate(var(--x),var(--y)) scale(calc(var(--s)*.25));opacity:0}}
@keyframes glow{from{opacity:.55}to{opacity:1}}
</style>
<defs>${DRAGON.flame.defs}
<radialGradient id="heat"><stop offset="0" stop-color="#ffd76a" stop-opacity=".95"/><stop offset=".45" stop-color="#ff8a1f" stop-opacity=".45"/><stop offset="1" stop-color="#ff5a1f" stop-opacity="0"/></radialGradient>
<radialGradient id="shade"><stop offset="0" stop-color="#000" stop-opacity="${theme.shadow}"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
<radialGradient id="eyeglow"><stop offset="0" stop-color="#fff6a0" stop-opacity=".9"/><stop offset="1" stop-color="#ffb21f" stop-opacity="0"/></radialGradient>
</defs>
<path fill="${theme.empty}" d="${ground}"/>${blocks}
<g class="fly">
<ellipse class="shadow" cx="${shadowX}" cy="${n(LIFT + shadowX * SLOPE)}" rx="110" ry="18" transform="rotate(${angle} ${shadowX} ${n(LIFT + shadowX * SLOPE)})" fill="url(#shade)"/>
<g class="bob">
<g transform="${shoulder}"><g class="flap">${DRAGON.far.paths}</g></g>
${DRAGON.body.paths}
<circle cx="${n(DRAGON.eye[0])}" cy="${n(DRAGON.eye[1])}" r="7" fill="url(#eyeglow)"/>
<circle class="glow" cx="${n(DRAGON.mouth[0])}" cy="${n(DRAGON.mouth[1])}" r="20" fill="url(#heat)"/>
<g transform="translate(${n(DRAGON.mouth[0])} ${n(DRAGON.mouth[1])})">${DRAGON.flame.particles}</g>
<g transform="${shoulder}"><g class="flap">${DRAGON.near.paths}</g></g>
</g></g></svg>
`;
}

// ---------------------------------------------------------------- output

const stats = summarize(await loadUser());
await mkdir(OUT_DIR, { recursive: true });
await writeFile(`${OUT_DIR}/profile-card.svg`, renderCard(stats, THEMES.light));
await writeFile(`${OUT_DIR}/profile-card-dark.svg`, renderCard(stats, THEMES.dark));
await writeFile(`${OUT_DIR}/dragon-city.svg`, renderScene(stats, THEMES.light));
await writeFile(`${OUT_DIR}/dragon-city-dark.svg`, renderScene(stats, THEMES.dark));
console.log(`Built profile images for ${stats.login}.`);
