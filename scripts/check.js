// 题库与前端资源的构建期校验。
// 不引入任何依赖，用 Node 内置能力检查三件事：
//   1. 所有 JS 文件语法可解析
//   2. SUDOKU_BANK 每道题的解符合数独规则
//   3. 题面与解的已知格一致，clues 计数与题面一致
// 用法：node scripts/check.js

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const errors = [];
const fails = (msg) => errors.push(msg);

// ---------- 1. 语法检查 ----------
function checkSyntax(file) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    fails(`${file}: 文件不存在`);
    return null;
  }
  const src = fs.readFileSync(full, "utf8");
  try {
    new vm.Script(src, { filename: file });
  } catch (e) {
    fails(`${file}: 语法错误 → ${e.message}`);
    return null;
  }
  return src;
}

const jsFiles = fs
  .readdirSync(ROOT)
  .filter((f) => f.endsWith(".js"))
  .sort();
if (jsFiles.length === 0) fails("仓库里没有找到任何 .js 文件");

let mainSrc = null;
for (const f of jsFiles) {
  const src = checkSyntax(f);
  if (f === "main.js") mainSrc = src;
}

// ---------- 2. 取出 SUDOKU_BANK ----------
function extractBank(src) {
  const marker = "window.SUDOKU_BANK";
  const at = src.indexOf(marker);
  if (at < 0) return null;
  const start = src.indexOf("{", at);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// ---------- 3. 逐题校验 ----------
function validSolution(sol) {
  if (sol.length !== 81) return "解的长度不是 81";
  for (const unit of units()) {
    const seen = new Set();
    for (const i of unit) {
      const d = sol[i];
      if (d < "1" || d > "9") return `解的第 ${i} 格不是 1-9`;
      if (seen.has(d)) return `解的同一单元出现重复数字 ${d}`;
      seen.add(d);
    }
  }
  return null;
}

function units() {
  const out = [];
  for (let r = 0; r < 9; r++) out.push([...Array(9)].map((_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) out.push([...Array(9)].map((_, r) => r * 9 + c));
  for (let br = 0; br < 3; br++)
    for (let bc = 0; bc < 3; bc++) {
      const u = [];
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) u.push((br * 3 + r) * 9 + bc * 3 + c);
      out.push(u);
    }
  return out;
}

let total = 0;
if (!mainSrc) {
  fails("main.js 未能读取，跳过题库校验");
} else {
  const raw = extractBank(mainSrc);
  if (!raw) {
    fails("main.js 里找不到 window.SUDOKU_BANK");
  } else {
    let bank;
    try {
      bank = JSON.parse(raw);
    } catch (e) {
      fails(`SUDOKU_BANK 不是合法 JSON → ${e.message}`);
    }
    if (bank) {
      if (!Array.isArray(bank.tiers) || bank.tiers.length === 0) {
        fails("SUDOKU_BANK.tiers 为空");
      } else {
        for (const tier of bank.tiers) {
          const label = `难度「${tier.name || tier.key}」`;
          if (!Array.isArray(tier.puzzles) || tier.puzzles.length === 0) {
            fails(`${label}: 没有题目`);
            continue;
          }
          for (let k = 0; k < tier.puzzles.length; k++) {
            const p = tier.puzzles[k];
            const tag = `${label} 第 ${k + 1} 题`;
            total++;
            const g = String(p.g || "");
            const sol = String(p.sol || "");
            if (g.length !== 81) {
              fails(`${tag}: 题面长度 ${g.length}，应为 81`);
              continue;
            }
            const solErr = validSolution(sol);
            if (solErr) {
              fails(`${tag}: ${solErr}`);
              continue;
            }
            let clues = 0;
            for (let i = 0; i < 81; i++) {
              const gc = g[i];
              if (gc !== "0") {
                clues++;
                if (gc !== sol[i]) {
                  fails(`${tag}: 第 ${i} 格题面 ${gc} 与解 ${sol[i]} 不一致`);
                  break;
                }
              }
            }
            if (typeof p.clues === "number" && p.clues !== clues) {
              fails(`${tag}: clues 标注 ${p.clues}，实际 ${clues}`);
            }
            if (!Number.isInteger(p.grade) || p.grade < 1 || p.grade > 8) {
              fails(`${tag}: grade 超出 L1-L8 范围（${p.grade}）`);
            }
          }
        }
      }
    }
  }
}

// ---------- 4. 产出结果 ----------
if (errors.length) {
  console.error(`\n校验失败，共 ${errors.length} 项：\n`);
  for (const e of errors.slice(0, 40)) console.error("  ✗ " + e);
  if (errors.length > 40) console.error(`  … 另有 ${errors.length - 40} 项`);
  process.exit(1);
}
console.log(`校验通过：${jsFiles.length} 个 JS 文件语法正确，${total} 道题的题面与解一致。`);
