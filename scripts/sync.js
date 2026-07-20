/**
 * Синхронизирует posts.json и videos.json с папкой видео.
 *
 * Папка — источник истины. Скрипт идемпотентный: существующие записи в
 * posts.json никогда не перезаписываются, дописываются только новые номера.
 * Превью снимаются только те, которых ещё нет.
 *
 * Запуск:  node scripts/sync.js
 *          node scripts/sync.js --force-thumbs   пересобрать все превью
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SRC =
  process.env.VIDEO_DIR ||
  "C:/Users/aivar/Documents/Adobe/Premiere Pro/26.0/Published";

const ROOT = path.join(__dirname, "..");
const THUMBS = path.join(ROOT, "public/thumbs");
const POSTS = path.join(ROOT, "posts.json");
const VIDEOS = path.join(ROOT, "videos.json");
const forceThumbs = process.argv.includes("--force-thumbs");

// --- 1. читаем папку -------------------------------------------------------

if (!fs.existsSync(SRC)) {
  console.error("Папка с видео не найдена: " + SRC);
  process.exit(1);
}

const byNum = new Map();
const unparsed = [];

for (const file of fs.readdirSync(SRC)) {
  if (!file.toLowerCase().endsWith(".mp4")) continue;
  // Premiere пишет то 'post (7).mp4', то 'post(90).mp4' — пробел необязателен.
  const m = file.match(/^post\s*\((\d+)\)\.mp4$/i);
  if (!m) {
    unparsed.push(file);
    continue;
  }
  byNum.set(Number(m[1]), file);
}

if (unparsed.length) {
  console.warn("Пропущены файлы с нераспознанным именем:");
  unparsed.forEach((f) => console.warn("  " + f));
}

const nums = [...byNum.keys()].sort((a, b) => a - b);
if (!nums.length) {
  console.error("В папке нет видео вида 'post (N).mp4'.");
  process.exit(1);
}

// Нумерация карточек = позиция в posts.json, поэтому дыра в номерах сдвинула бы
// все последующие записи. Лучше остановиться, чем молча развалить соответствие.
const gaps = nums.filter((n, i) => n !== i + 1);
if (gaps.length) {
  console.error(
    "Нумерация видео не сплошная — не хватает номеров перед: " +
      gaps.slice(0, 5).join(", ")
  );
  console.error("Исправь имена файлов и запусти снова.");
  process.exit(1);
}

// --- 2. превью -------------------------------------------------------------

fs.mkdirSync(THUMBS, { recursive: true });

let made = 0;
for (const n of nums) {
  const out = path.join(THUMBS, "post-" + n + ".jpg");
  if (!forceThumbs && fs.existsSync(out)) continue;
  try {
    // -ss 1 до -i: отступаем от начала, иначе часто ловится чёрный кадр.
    // thumbnail=50 выбирает самый показательный кадр из следующих 50.
    execFileSync(
      "ffmpeg",
      [
        "-v", "error",
        "-ss", "1",
        "-i", path.join(SRC, byNum.get(n)),
        "-vf", "thumbnail=50,scale=400:-2",
        "-frames:v", "1",
        "-q:v", "4",
        "-y", out,
      ],
      { stdio: ["ignore", "ignore", "pipe"] }
    );
    made++;
    console.log("превью: post-" + n + ".jpg");
  } catch (err) {
    console.error("не удалось снять превью для " + byNum.get(n));
    console.error("  " + String(err.stderr || err.message).trim());
  }
}

// --- 3. posts.json ---------------------------------------------------------

const posts = fs.existsSync(POSTS)
  ? JSON.parse(fs.readFileSync(POSTS, "utf8"))
  : [];

if (posts.length > nums.length) {
  console.error(
    "В posts.json записей (" + posts.length + ") больше, чем видео (" +
      nums.length + "). Разбирайся вручную, ничего не трогаю."
  );
  process.exit(1);
}

const added = [];
for (let n = posts.length + 1; n <= nums.length; n++) {
  posts.push({ img: "public/thumbs/post-" + n + ".jpg", url: "", isRemoved: false });
  added.push(n);
}

// Чиним только пути к превью — url и isRemoved остаются как есть.
posts.forEach((p, i) => {
  p.img = "public/thumbs/post-" + (i + 1) + ".jpg";
});

fs.writeFileSync(POSTS, JSON.stringify(posts, null, 4) + "\n");

// --- 4. videos.json (страница ревизии) -------------------------------------

const videos = nums.map((n) => {
  const st = fs.statSync(path.join(SRC, byNum.get(n)));
  const p = posts[n - 1];
  return {
    num: n,
    file: byNum.get(n),
    img: "public/thumbs/post-" + n + ".jpg",
    url: p && p.url ? p.url : null,
    isRemoved: p ? p.isRemoved : false,
    sizeMb: +(st.size / 1048576).toFixed(1),
    modified: st.mtime.toISOString().slice(0, 16).replace("T", " "),
  };
});

fs.writeFileSync(VIDEOS, JSON.stringify(videos, null, 4) + "\n");

// --- итог ------------------------------------------------------------------

const noUrl = videos.filter((v) => !v.url).map((v) => v.num);

console.log("");
console.log("видео в папке:   " + nums.length);
console.log("новых превью:    " + made);
console.log("добавлено в JSON: " + (added.length ? added.join(", ") : "нет"));
console.log(
  "без ссылки:      " + (noUrl.length ? noUrl.length + " → " + noUrl.join(", ") : "нет")
);
