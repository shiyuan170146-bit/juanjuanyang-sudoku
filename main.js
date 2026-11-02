/* 卷卷羊 · 数独学园 —— 网页版主脚本（由 index.bak.html 的内联脚本原样外置） */
/* 网页版：不写 window.__XHS_BUILD，运行时按 ENV.xhs=false 走原逻辑。 */

/* ============================================================================
 * ENV · 端能力探测（双端适配的唯一分流点）
 *   网页端：容器不注入 window.xhs → 全部走原有逻辑，行为与旧版完全一致。
 *   小红书小工具：容器注入 window.xhs.miniTool → 下载/剪贴板改用容器允许的方式。
 * 任何平台差异只在这里判断一次，其它地方只读 ENV，禁止散落判断。
 * ========================================================================== */
window.ENV = (function () {
  var mt = (window.xhs && window.xhs.miniTool) || null;
  var e = {
    xhs: !!mt,
    miniTool: mt,
    bridge: !!(mt && typeof mt.saveImageToPhotosAlbum === 'function'),
    canDownload: false,
    canClipboard: false,
    canVibrate: !!navigator.vibrate
  };
  try { e.canDownload = ('download' in document.createElement('a')); } catch (x) {}
  
  /* 剪贴板探测只对网页端有意义。小工具容器把 navigator.clipboard 和 execCommand 全禁了
     （device-capabilities.md §2「不可用能力」），打小工具包时这一段会被 build-xhs 整段删掉，
     ENV.canClipboard 保持上面的 false。别把标记删了 —— 发布检查要求被禁能力零残留。 */
  try { e.canClipboard = !!(navigator.clipboard && navigator.clipboard.writeText); } catch (x) {}
  
  /* 小红书容器禁用 a[download] 与剪贴板 API：即使表面存在也按不可用处理 */
  if (e.xhs) { e.canDownload = false; e.canClipboard = false; }
  return e;
})();
/* 容器外壳标记（2026-10-31）：小红书小工具里「返回 / 分享」那条悬浮栏压在 webview 顶上，
   安卓上 env(safe-area-inset-top) 报 0，安全区躲不开 → 给 <html> 挂 inxhs，
   build-xhs.js 追加的 html.inxhs 规则据此把 --xtop 设成 max(0px, 46px - sat)。
   普通浏览器 / 网页端不会挂这个类，样式逐像素不变。 */
(function () {
  function mark() {
    try {
      if (window.ENV && window.ENV.xhs && document.documentElement.className.indexOf('inxhs') < 0)
        document.documentElement.className += ' inxhs';
    } catch (x) {}
  }
  mark();                                         /* 桥在首帧前注入 → 当场就挂上 */
  document.addEventListener('DOMContentLoaded', mark);   /* 桥来得晚也能补上 */
  window.addEventListener('load', mark);
})();
/* 旧内核（Chrome 61 一类）检测：只在旧 WebView 上挂 legacy-c61 类启用 CSS 回退。
   现代浏览器不加这个类，样式与像素基线零影响。 */
(function () {
  function probe() {
    var legacy = false;
    try {                                       /* flex gap 必须实测布局，语法检测不可靠 */
      var f = document.createElement('div');
      f.style.cssText = 'position:absolute;visibility:hidden;display:flex;flex-direction:column;row-gap:1px';
      f.appendChild(document.createElement('div'));
      f.appendChild(document.createElement('div'));
      (document.body || document.documentElement).appendChild(f);
      var ok = f.scrollHeight === 1;
      f.parentNode.removeChild(f);
      if (!ok) legacy = true;
    } catch (x) {}
    function sup(p, v) { try { return !!(window.CSS && CSS.supports && CSS.supports(p, v)); } catch (x) { return true; } }
    if (!sup('aspect-ratio', '1 / 1')) legacy = true;
    if (!sup('height', '100dvh')) legacy = true;
    if (!sup('width', 'min(1px, 2px)')) legacy = true;
    if (!sup('inset', '0')) legacy = true;
    if (legacy) {
      try { document.documentElement.className += ' legacy-c61'; } catch (x) {}
    }
  }
  if (document.body) probe();
  else document.addEventListener('DOMContentLoaded', probe);
})();
/* 版本自检：只记录已看版本用于页脚展示，不再整页重定向。
   旧逻辑发新版后会 location.replace 把整页（约 3MB）再加载一遍，慢网速下表现为「加载好久、显示不全」；
   现改为依赖平台缓存策略，新版本发布后用户硬刷新一次（Ctrl/Cmd+F5）即可。 */
(function () {
  var V = 'v20261031l';
  try { localStorage.setItem('sd_ver', V); } catch (e) {}
  document.addEventListener('DOMContentLoaded', function () {
    var _bv = document.getElementById('bver');
    if (_bv) _bv.textContent = V;
  });
})();
/* 首帧就把「真实可视高度」写进 --vvh：手机浏览器的 100dvh 常常偏大（把地址栏算进去），
   等 JS 初始化完再改会出现一帧跳动，所以这里先量一次（样式里用 min(100dvh, var(--vvh)) 取小）。 */
(function () {
  function set() {
    try {
      var vv = window.visualViewport;
      var h = (vv && vv.height) || window.innerHeight || 0;
      if (h > 0) document.documentElement.style.setProperty('--vvh', Math.round(h) + 'px');
    } catch (e) {}
  }
  set();
  window.addEventListener('resize', set);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', set);
})();


/* ---------------- 下一段 ---------------- */


/* ============================================================================
 * 数独核心引擎 (JavaScript) —— 与 Python 版 sudoku_engine.py 同构
 * 技巧分级：L1 唯一余数 / L2 隐性唯一 / L3 区块摒除 / L4 数对数组 /
 *          L5 鱼型 / L6 XY-Wing·唯一矩形 / L7 简单着色·XY-Chain / L8 强制链
 * 对外 API（挂在 window.SudokuEngine 或 module.exports）
 *   PEERS, UNITS, BOX
 *   initCandidates(grid) -> Int16Array(81) 位掩码
 *   nextHint(grid, maxLevel) -> {kind,i,v,level,tech,reason} | null
 *   solveWithLevel(grid, maxLevel) -> {ok, grid, maxLevel, steps}
 *   grade(grid) -> 1..8，9 表示 L1-L8 仍解不完
 *   generateFull(rng) / countSolutions(grid, limit) / dig(full, rng, targetClues)
 *   isSolved(grid) / validate(grid, solution) -> 错误格索引数组
 * ==========================================================================*/
(function (global) {
  'use strict';

  var FULL = 0x3FE;                       // bit1..bit9
  var POP = new Uint8Array(1024);
  for (var i = 0; i < 1024; i++) POP[i] = POP[i >> 1] + (i & 1);

  function V(v) { return 1 << v; }
  function bits(mask) {
    var out = [];
    for (var v = 1; v <= 9; v++) if (mask & V(v)) out.push(v);
    return out;
  }
  function popcount(m) { return POP[m & 1023]; }

  // ---------- 预计算 peers / units / box ----------
  var PEERS = new Array(81);
  var UNITS = [];
  var BOX = new Int8Array(81);
  (function build() {
    for (var i = 0; i < 81; i++) PEERS[i] = [];
    var push = function (type, idx, cells) {
      UNITS.push({ type: type, idx: idx, cells: cells });
      for (var k = 0; k < cells.length; k++) {
        var a = cells[k];
        for (var j = 0; j < cells.length; j++)
          if (cells[j] !== a) PEERS[a].push(cells[j]);
      }
    };
    var r, c, br, bc;
    for (r = 0; r < 9; r++) { var row = []; for (c = 0; c < 9; c++) row.push(r * 9 + c); push('row', r, row); }
    for (c = 0; c < 9; c++) { var col = []; for (r = 0; r < 9; r++) col.push(r * 9 + c); push('col', c, col); }
    for (br = 0; br < 3; br++) for (bc = 0; bc < 3; bc++) {
      var cells = [];
      for (r = 0; r < 3; r++) for (c = 0; c < 3; c++) cells.push((br * 3 + r) * 9 + (bc * 3 + c));
      push('box', br * 3 + bc, cells);
    }
    for (r = 0; r < 81; r++) {
      var st = {}; for (var q = 0; q < PEERS[r].length; q++) st[PEERS[r][q]] = 1;
      var arr = []; for (var k2 in st) arr.push(+k2); PEERS[r] = arr;
      BOX[r] = Math.floor(r / 9 / 3) * 3 + Math.floor((r % 9) / 3);
    }
  })();

  function cellName(i) { return 'R' + (Math.floor(i / 9) + 1) + 'C' + (i % 9 + 1); }
  function unitName(u) { var t = UNITS[u]; return '第' + (t.idx + 1) + (t.type === 'row' ? '行' : t.type === 'col' ? '列' : '宫'); }
  /* 强制链反证过程 → 人话链：起点由调用方拼在前面，这里只写「每步落子 + 矛盾点」。
     超过 12 步折叠中间段，但链尾的矛盾点永远保留（教学上结论不能省） */
  function chainText(log) {
    function fmt(e) {
      if (e.t === 0) return cellName(e.i) + '=' + e.v + '（唯一余数）';
      if (e.t === 1) return cellName(e.i) + '=' + e.v + '（' + unitName(e.u) + '隐性唯一）';
      if (e.t === 2) return cellName(e.i) + '候选被清空 → 矛盾';
      return unitName(e.u) + '没有格子能放 ' + e.v + ' → 矛盾';
    }
    var parts = [], n = log.length;
    var head = Math.min(n, n <= 12 ? n : 11);
    for (var i = 0; i < head; i++) parts.push(fmt(log[i]));
    if (n > 12) parts.push('……（省略 ' + (n - 12) + ' 步）');
    if (n > head) parts.push(fmt(log[n - 1]));
    return parts.join(' → ');
  }
  function cloneGrid(g) { return g.slice(0); }

  function initCandidates(grid) {
    var cands = new Int16Array(81);
    for (var i = 0; i < 81; i++) {
      if (grid[i]) { cands[i] = 0; continue; }
      var used = 0;
      var p = PEERS[i];
      for (var k = 0; k < p.length; k++) if (grid[p[k]]) used |= V(grid[p[k]]);
      cands[i] = FULL & ~used;
    }
    return cands;
  }

  function applyPlace(grid, cands, i, v) {
    grid[i] = v; cands[i] = 0;
    var p = PEERS[i];
    for (var k = 0; k < p.length; k++) if (grid[p[k]] === 0) cands[p[k]] &= ~V(v);
  }

  function isSolved(grid) {
    for (var i = 0; i < 81; i++) if (!grid[i]) return false;
    return true;
  }

  function combos(arr, n, start, acc, out) {
    if (acc.length === n) { out.push(acc.slice()); return; }
    for (var k = start; k < arr.length; k++) {
      acc.push(arr[k]); combos(arr, n, k + 1, acc, out); acc.pop();
    }
  }
  function comb(arr, n) { var out = []; combos(arr, n, 0, [], out); return out; }

  /* ---------------- L1 唯一余数 ---------------- */
  function tNakedSingle(grid, cands) {
    for (var i = 0; i < 81; i++)
      if (grid[i] === 0 && popcount(cands[i]) === 1) {
        var v1 = bits(cands[i])[0];
        // 证据：这格周围每个「已出现数字」挑一个代表格，reason 里引用 R#C#，
        // 前端 parseCells 会把它们全部高亮成陶土色闪烁 —— 玩家能亲眼看到排除依据
        var p1 = PEERS[i], seen = {}, blockers = [];
        for (var k1 = 0; k1 < p1.length; k1++) {
          var d1 = grid[p1[k1]];
          if (d1 && !seen[d1]) { seen[d1] = 1; blockers.push(p1[k1]); }
        }
        var ds = Object.keys(seen).map(Number).sort(function (a, b) { return a - b; });
        var refs = blockers.map(function (ci) {
          return 'R' + (Math.floor(ci / 9) + 1) + 'C' + (ci % 9 + 1);
        }).join('、');
        return { kind: 'place', i: i, v: v1, level: 1,
          tech: '唯一余数 Naked Single',
          reason: '这一格的行、列、宫里已经出现了 ' + ds.join('、') +
            '（陶土色闪烁的格子就是这些数字）——9 个数字里只剩 ' + v1 +
            ' 没被挡住，所以这一格只能填 ' + v1 + '。依据格：' + refs };
      }
    return null;
  }

  /* ---------------- L2 隐性唯一 ---------------- */
  function tHiddenSingle(grid, cands) {
    var names = { row: '行', col: '列', box: '宫' };
    function rel(a, b) {   // b 相对 a 的位置关系（同行/列/宫），用于人话解释
      if (Math.floor(a / 9) === Math.floor(b / 9)) return '同一行';
      if (a % 9 === b % 9) return '同一列';
      return '同一宫';
    }
    for (var u = 0; u < UNITS.length; u++) {
      var U = UNITS[u];
      for (var v = 1; v <= 9; v++) {
        var spot = -1, cnt = 0;
        for (var k = 0; k < U.cells.length; k++) {
          var i = U.cells[k];
          if (grid[i] === 0 && (cands[i] & V(v))) { spot = i; cnt++; if (cnt > 1) break; }
        }
        if (cnt === 1) {
          // 证据：这个单元里其他空格为什么都放不下 v —— 各找一个挡住它的 v
          var parts = [], total = 0;
          for (var k2 = 0; k2 < U.cells.length; k2++) {
            var e = U.cells[k2];
            if (e === spot || grid[e] || (cands[e] & V(v))) continue;
            total++;
            var by = -1, pp = PEERS[e];
            for (var k3 = 0; k3 < pp.length; k3++) if (grid[pp[k3]] === v) { by = pp[k3]; break; }
            if (by >= 0 && parts.length < 6)
              parts.push('R' + (Math.floor(e / 9) + 1) + 'C' + (e % 9 + 1) +
                '（它的' + rel(e, by) + '已有 ' + v + '，在 R' + (Math.floor(by / 9) + 1) + 'C' + (by % 9 + 1) + '）');
          }
          var spotName = 'R' + (Math.floor(spot / 9) + 1) + 'C' + (spot % 9 + 1);
          var reason = '看第 ' + (U.idx + 1) + names[U.type] + '：这一' + names[U.type] +
            '还没有 ' + v + '，但其他空格都放不下它';
          if (parts.length) reason += ' —— ' + parts.join('；') + (total > parts.length ? '；等共 ' + total + ' 格' : '');
          reason += '。所以整' + names[U.type] + '只剩 ' + spotName + ' 能放 ' + v + '。';
          return { kind: 'place', i: spot, v: v, level: 2, tech: '隐性唯一 Hidden Single',
            reason: reason };
        }
      }
    }
    return null;
  }

  /* ---------------- L3 区块摒除 ---------------- */
  function tPointingClaiming(grid, cands) {
    var u, k, v;
    for (u = 0; u < UNITS.length; u++) {
      var U = UNITS[u];
      for (v = 1; v <= 9; v++) {
        var spots = [];
        for (k = 0; k < U.cells.length; k++) {
          var i = U.cells[k];
          if (grid[i] === 0 && (cands[i] & V(v))) spots.push(i);
        }
        if (spots.length < 2 || spots.length > 3) continue;
        var spotNames = spots.map(cellName).join('、');
        if (U.type === 'box') {
          var rows = {}, cols = {};
          for (k = 0; k < spots.length; k++) { rows[Math.floor(spots[k] / 9)] = 1; cols[spots[k] % 9] = 1; }
          var rk = Object.keys(rows), ck = Object.keys(cols);
          if (rk.length === 1) {
            var rr = +rk[0];
            var headR = '第' + (U.idx + 1) + '宫里，能放 ' + v + ' 的空格只有 ' + spotNames + '，它们全在第 ' + (rr + 1) + ' 行 —— 这宫的 ' + v + ' 肯定落在第 ' + (rr + 1) + ' 行里';
            for (var cc = 0; cc < 9; cc++) {
              var t = rr * 9 + cc;
              if (U.cells.indexOf(t) < 0 && grid[t] === 0 && (cands[t] & V(v)))
                return { kind: 'elim', i: t, v: v, level: 3, tech: '区块摒除 Pointing（宫→行）', unit: U.cells.slice(),
                  reason: headR + ' → 同一行里宫外的格子就放不下 ' + v + ' 了，' + cellName(t) + ' 的候选 ' + v + ' 可以划掉' };
            }
          }
          if (ck.length === 1) {
            var c2 = +ck[0];
            var headC = '第' + (U.idx + 1) + '宫里，能放 ' + v + ' 的空格只有 ' + spotNames + '，它们全在第 ' + (c2 + 1) + ' 列 —— 这宫的 ' + v + ' 肯定落在第 ' + (c2 + 1) + ' 列里';
            for (var r2 = 0; r2 < 9; r2++) {
              var t2 = r2 * 9 + c2;
              if (U.cells.indexOf(t2) < 0 && grid[t2] === 0 && (cands[t2] & V(v)))
                return { kind: 'elim', i: t2, v: v, level: 3, tech: '区块摒除 Pointing（宫→列）', unit: U.cells.slice(),
                  reason: headC + ' → 同一列里宫外的格子就放不下 ' + v + ' 了，' + cellName(t2) + ' 的候选 ' + v + ' 可以划掉' };
            }
          }
        } else {
          var boxes = {};
          for (k = 0; k < spots.length; k++) boxes[BOX[spots[k]]] = 1;
          var bk = Object.keys(boxes);
          if (bk.length === 1) {
            var b = +bk[0];
            var headL = '第 ' + (U.idx + 1) + (U.type === 'row' ? ' 行' : ' 列') + '里，能放 ' + v + ' 的空格只有 ' + spotNames + '，它们全在第' + (b + 1) + '宫 —— 这条线上的 ' + v + ' 肯定落在第' + (b + 1) + '宫里';
            for (var j = 0; j < 81; j++) {
              if (BOX[j] === b && U.cells.indexOf(j) < 0 && grid[j] === 0 && (cands[j] & V(v)))
                return { kind: 'elim', i: j, v: v, level: 3, tech: '组合摒除 Claiming（线→宫）', unit: U.cells.slice(),
                  reason: headL + ' → 宫里这条线以外的格子就放不下 ' + v + ' 了，' + cellName(j) + ' 的候选 ' + v + ' 可以划掉' };
            }
          }
        }
      }
    }
    return null;
  }

  /* ---------------- L4 数对 / 数组 / 隐性数对 ---------------- */
  function tNakedSubset(grid, cands) {
    var names = { row: '行', col: '列', box: '宫' };
    for (var u = 0; u < UNITS.length; u++) {
      var U = UNITS[u];
      var empt = [];
      for (var k = 0; k < U.cells.length; k++) if (grid[U.cells[k]] === 0) empt.push(U.cells[k]);
      var ns = [2, 3];
      for (var ni = 0; ni < ns.length; ni++) {
        var n = ns[ni];
        if (empt.length < n) continue;
        var list = comb(empt, n);
        for (var li = 0; li < list.length; li++) {
          var group = list[li], union = 0;
          for (k = 0; k < group.length; k++) union |= cands[group[k]];
          if (popcount(union) !== n) continue;
          for (k = 0; k < empt.length; k++) {
            var i = empt[k];
            if (group.indexOf(i) >= 0) continue;
            var dead = cands[i] & union;
            if (dead) {
              var v = bits(dead)[0];
              var names2 = group.map(cellName).join('、');
              return { kind: 'elim', i: i, v: v, level: 4, unit: U.cells.slice(), focus: group.slice(),
                tech: n === 2 ? '数对 Naked Pair' : '数组 Naked Triple',
                reason: '第 ' + (U.idx + 1) + names[U.type] + '里 ' + names2 + ' 恰好只含 {' + bits(union).join(',') + '} 这几个候选 → 本单元其他格子都不能是 ' + v };
            }
          }
        }
      }
    }
    return null;
  }

  function tHiddenPair(grid, cands) {
    var names = { row: '行', col: '列', box: '宫' };
    for (var u = 0; u < UNITS.length; u++) {
      var U = UNITS[u];
      var empt = [];
      for (var k = 0; k < U.cells.length; k++) if (grid[U.cells[k]] === 0) empt.push(U.cells[k]);
      var pairs = comb([1, 2, 3, 4, 5, 6, 7, 8, 9], 2);
      for (var pi = 0; pi < pairs.length; pi++) {
        var a = pairs[pi][0], b = pairs[pi][1];
        var sa = [], sb = [];
        for (k = 0; k < empt.length; k++) {
          if (cands[empt[k]] & V(a)) sa.push(empt[k]);
          if (cands[empt[k]] & V(b)) sb.push(empt[k]);
        }
        if (sa.length === 2 && sb.length === 2 && sa[0] === sb[0] && sa[1] === sb[1]) {
          for (k = 0; k < sa.length; k++) {
            var extra = cands[sa[k]] & ~(V(a) | V(b));
            if (extra) {
              var v = bits(extra)[0];
              return { kind: 'elim', i: sa[k], v: v, level: 4, tech: '隐性数对 Hidden Pair', unit: U.cells.slice(), focus: sa.slice(),
                reason: '第 ' + (U.idx + 1) + names[U.type] + '里 ' + a + ' 和 ' + b + ' 只出现在 ' + sa.map(cellName).join('、') + ' 两格 → 这两格不可能再放其他数字，删 ' + v };
            }
          }
        }
      }
    }
    return null;
  }

  /* ---------------- L5 鱼型 ---------------- */
  function tFish(grid, cands, size) {
    var name = size === 2 ? 'X-Wing（二链列）' : 'Swordfish（三链列）';
    for (var v = 1; v <= 9; v++) {
      for (var ori = 0; ori < 2; ori++) {
        var isRow = ori === 0;
        var lines = {};
        for (var i = 0; i < 9; i++) {
          var spots = [];
          for (var j = 0; j < 9; j++) {
            var idx = isRow ? i * 9 + j : j * 9 + i;
            if (grid[idx] === 0 && (cands[idx] & V(v))) spots.push(j);
          }
          if (spots.length >= 2 && spots.length <= size) lines[i] = spots;
        }
        var keys = Object.keys(lines);
        if (keys.length < size) continue;
        var lists = comb(keys, size);
        for (var li = 0; li < lists.length; li++) {
          var posSet = {}, ok = true;
          for (var ci = 0; ci < lists[li].length; ci++) {
            var arr = lines[lists[li][ci]];
            for (var z = 0; z < arr.length; z++) posSet[arr[z]] = 1;
          }
          var pos = Object.keys(posSet).map(Number);
          if (pos.length !== size) continue;
          for (var r2 = 0; r2 < 9; r2++) {
            if (lists[li].indexOf(String(r2)) >= 0) continue;
            for (var pz = 0; pz < pos.length; pz++) {
              var t = isRow ? r2 * 9 + pos[pz] : pos[pz] * 9 + r2;
              if (grid[t] === 0 && (cands[t] & V(v))) {
                var unit = [];
                for (var ui = 0; ui < 9; ui++) for (var uj = 0; uj < pos.length; uj++)
                  unit.push(isRow ? ui * 9 + pos[uj] : pos[uj] * 9 + ui);
                return { kind: 'elim', i: t, v: v, level: 5, tech: name, unit: unit,
                  reason: '数字 ' + v + ' 在第 ' + lists[li].map(function (x) { return +x + 1; }).join('、') + (isRow ? '行' : '列') + '上形成鱼型，只占第 ' + pos.map(function (x) { return x + 1; }).join('、') + (isRow ? '列' : '行') + ' → 这些列/行的其他格子都不能是 ' + v };
              }
            }
          }
        }
      }
    }
    return null;
  }
  function tXWing(grid, cands) { return tFish(grid, cands, 2); }
  function tSwordfish(grid, cands) { return tFish(grid, cands, 3); }

  /* ---------------- L6 XY-Wing / 唯一矩形 ---------------- */
  function tXYWing(grid, cands) {
    for (var p = 0; p < 81; p++) {
      if (grid[p] !== 0 || popcount(cands[p]) !== 2) continue;
      var pb = bits(cands[p]), x = pb[0], y = pb[1];
      var pa = PEERS[p];
      for (var ai = 0; ai < pa.length; ai++) {
        var a = pa[ai];
        if (!(grid[a] === 0 && popcount(cands[a]) === 2)) continue;
        if (!(cands[a] & V(x)) || (cands[a] & V(y))) continue;
        var z = bits(cands[a] & ~V(x))[0];
        for (var bi = 0; bi < pa.length; bi++) {
          var b = pa[bi];
          if (b === a) continue;
          if (!(grid[b] === 0 && popcount(cands[b]) === 2)) continue;
          if (!(cands[b] & V(y)) || (cands[b] & V(x)) || !(cands[b] & V(z))) continue;
          var common = PEERS[a].filter(function (q) { return PEERS[b].indexOf(q) >= 0; });
          for (var qi = 0; qi < common.length; qi++) {
            var t = common[qi];
            if (grid[t] === 0 && (cands[t] & V(z)))
              return { kind: 'elim', i: t, v: z, level: 6, tech: 'XY-Wing（三格枢纽）',
                reason: '枢纽 ' + cellName(p) + '={' + x + ',' + y + '}，两翼 ' + cellName(a) + '={' + x + ',' + z + '}、' + cellName(b) + '={' + y + ',' + z + '} → 无论枢纽取哪个值，' + z + ' 必在两翼之一，故同时看见两翼的 ' + cellName(t) + ' 不能是 ' + z };
          }
        }
      }
    }
    return null;
  }

  function tUniqueRectangle(grid, cands) {
    for (var r1 = 0; r1 < 9; r1++) for (var r2 = r1 + 1; r2 < 9; r2++)
      for (var c1 = 0; c1 < 9; c1++) for (var c2 = c1 + 1; c2 < 9; c2++) {
        var cells = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
        var i, ok = true;
        for (i = 0; i < 4; i++) if (grid[cells[i]] !== 0) { ok = false; break; }
        if (!ok) continue;
        var bs = {}; for (i = 0; i < 4; i++) bs[BOX[cells[i]]] = 1;
        if (Object.keys(bs).length !== 2) continue;
        var pairsC = [], fourth = -1;
        for (i = 0; i < 4; i++) { if (popcount(cands[cells[i]]) === 2) pairsC.push(cells[i]); else fourth = cells[i]; }
        if (pairsC.length !== 3 || fourth < 0) continue;
        var vals = cands[pairsC[0]] | cands[pairsC[1]] | cands[pairsC[2]];
        if (popcount(vals) !== 2) continue;
        var dead = cands[fourth] & vals;
        if (dead) {
          var v = bits(dead)[0];
          return { kind: 'elim', i: fourth, v: v, level: 6, tech: '唯一矩形 Unique Rectangle',
            reason: '这四格构成矩形且三格只含 {' + bits(vals).join(',') + '}，若第四格也是这两个数就会产生两个解 → 第四格必须删掉 ' + v };
        }
      }
    return null;
  }

  /* ---------------- L7 简单着色 / XY-Chain ---------------- */
  /* 重要：着色只在「同一连通分量」内才有意义，跨分量的颜色不可比较 ——
     早期版本未做分量隔离，会导致误删正确候选（已由可靠性测试抓出并修复） */
  function tSimpleColoring(grid, cands) {
    for (var v = 1; v <= 9; v++) {
      var adj = {}, has = false, k, u;
      for (u = 0; u < UNITS.length; u++) {
        var spots = [];
        for (k = 0; k < UNITS[u].cells.length; k++) {
          var i = UNITS[u].cells[k];
          if (grid[i] === 0 && (cands[i] & V(v))) spots.push(i);
        }
        if (spots.length === 2) {
          (adj[spots[0]] = adj[spots[0]] || []).push(spots[1]);
          (adj[spots[1]] = adj[spots[1]] || []).push(spots[0]);
          has = true;
        }
      }
      if (!has) continue;

      var color = {}, comp = {}, cid = 0, start;
      for (start in adj) {
        if (color[start] !== undefined) continue;
        color[start] = 0; comp[start] = cid;
        var stack = [start];
        while (stack.length) {
          var x = stack.pop(), nb = adj[x] || [];
          for (k = 0; k < nb.length; k++) {
            var y = nb[k];
            if (color[y] === undefined) { color[y] = 1 - color[x]; comp[y] = cid; stack.push(y); }
          }
        }
        cid++;
      }

      // 规则1：同一连通分量内、同色两格落在同一单元 → 该分量该色全假
      for (u = 0; u < UNITS.length; u++) {
        for (var col = 0; col < 2; col++) {
          var groups = {};
          for (k = 0; k < UNITS[u].cells.length; k++) {
            var c3 = UNITS[u].cells[k];
            if (color[c3] === col) (groups[comp[c3]] = groups[comp[c3]] || []).push(c3);
          }
          for (var gk in groups) {
            var same = groups[gk];
            if (same.length < 2) continue;
            for (var key in color) {
              var t = +key;
              if (comp[t] === +gk && color[t] === col && grid[t] === 0 && (cands[t] & V(v)))
                return { kind: 'elim', i: t, v: v, level: 7, tech: '简单着色 Simple Coloring',
                  /* 把整条链的染色一并带出去：教程 / 提示要照着把格子染成红蓝两色 */
                  colors: color, components: comp, compId: +gk, chainDigit: v,
                  reason: '数字 ' + v + ' 的强链接链里，同色的 ' + cellName(same[0]) + ' 与 ' + cellName(same[1]) + ' 落在同一单元（不可能同时为真）→ 这一整种颜色都不能是 ' + v };
            }
          }
        }
      }

      // 规则2：同一连通分量内同时看见两种颜色 → 删
      for (var idx = 0; idx < 81; idx++) {
        if (grid[idx] !== 0 || !(cands[idx] & V(v)) || color[idx] !== undefined) continue;
        var seenByComp = {}, pp = PEERS[idx];
        for (k = 0; k < pp.length; k++) {
          var q = pp[k];
          if (color[q] !== undefined && (cands[q] & V(v)))
            (seenByComp[comp[q]] = seenByComp[comp[q]] || {})[color[q]] = 1;
        }
        for (var ck in seenByComp) {
          if (Object.keys(seenByComp[ck]).length === 2)
            return { kind: 'elim', i: idx, v: v, level: 7, tech: '简单着色 Simple Coloring',
              colors: color, components: comp, compId: +ck, chainDigit: v,
              reason: cellName(idx) + ' 在同一条链上同时看见数字 ' + v + ' 的两种颜色，无论哪种为真它都不能是 ' + v };
        }
      }
    }
    return null;
  }

  /* 传播语义：从 c1 假设「不含 z」→ c1 = 另一值 o1；沿链逐格强制，末格含 z */
  function tXYChain(grid, cands) {
    var biv = [];
    for (var i = 0; i < 81; i++) if (grid[i] === 0 && popcount(cands[i]) === 2) biv.push(i);
    var MAXLEN = 14;
    for (var si = 0; si < biv.length; si++) {
      var start = biv[si], sb = bits(cands[start]);
      for (var zi = 0; zi < 2; zi++) {
        var z = sb[zi], o1 = sb[1 - zi];
        var stack = [[[start], o1, z]];
        while (stack.length) {
          var top = stack.pop(), chain = top[0], prop = top[1], zz = top[2];
          if (chain.length > MAXLEN) continue;
          if (chain.length >= 3 && prop === zz) {
            var end = chain[chain.length - 1];
            var shared = PEERS[start].filter(function (q) { return PEERS[end].indexOf(q) >= 0; });
            for (var qi = 0; qi < shared.length; qi++) {
              var t = shared[qi];
              if (t === start || t === end || chain.indexOf(t) >= 0) continue;
              if (grid[t] === 0 && (cands[t] & V(zz)))
                return { kind: 'elim', i: t, v: zz, level: 7, tech: 'XY-Chain（双候选链）',
                  reason: '链 ' + chain.map(cellName).join('→') + ' 首尾都含 ' + zz + '，故 ' + zz + ' 必在首尾之一 → 同时看见首尾的 ' + cellName(t) + ' 不能是 ' + zz };
            }
          }
          for (var ni = 0; ni < biv.length; ni++) {
            var nxt = biv[ni];
            if (chain.indexOf(nxt) >= 0 || !(cands[nxt] & V(prop))) continue;
            /* 硬性前提：相邻两格必须互为 peer，否则强制传递不成立 */
            if (PEERS[chain[chain.length - 1]].indexOf(nxt) < 0) continue;
            var other = bits(cands[nxt] & ~V(prop));
            if (other.length !== 1) continue;
            stack.push([chain.concat([nxt]), other[0], zz]);
          }
        }
      }
    }
    return null;
  }

  /* ---------------- L8 强制链 ---------------- */
  function propagateSingles(g, c, limit, log) {
    limit = limit || 400;
    var steps = 0;
    while (steps < limit) {
      steps++;
      var moved = false, i;
      for (i = 0; i < 81; i++) {
        if (g[i] === 0) {
          /* log：t0=唯一余数落子 t1=隐性唯一落子 t2=格子候选清空(矛盾) t3=单元无处放 v(矛盾) */
          if (c[i] === 0) { if (log) log.push({ t: 2, i: i }); return 'contradiction'; }
          if (popcount(c[i]) === 1) { var d0 = bits(c[i])[0]; applyPlace(g, c, i, d0); if (log) log.push({ t: 0, i: i, v: d0 }); moved = true; }
        }
      }
      if (moved) continue;
      for (var u = 0; u < UNITS.length; u++) {
        for (var v = 1; v <= 9; v++) {
          /* 关键：v 已在本单元落定 → 本单元不再需要 v，空位找不到 v 属正常，不可判矛盾 */
          var has = false;
          for (var h = 0; h < UNITS[u].cells.length; h++) if (g[UNITS[u].cells[h]] === v) { has = true; break; }
          if (has) continue;
          var spot = -1, cnt = 0;
          for (var k = 0; k < UNITS[u].cells.length; k++) {
            var t = UNITS[u].cells[k];
            if (g[t] === 0 && (c[t] & V(v))) { spot = t; cnt++; if (cnt > 1) break; }
          }
          if (cnt === 0) { if (log) log.push({ t: 3, v: v, u: u }); return 'contradiction'; }   /* 仍缺 v 却无处可放 → 真矛盾 */
          if (cnt === 1) { applyPlace(g, c, spot, v); if (log) log.push({ t: 1, i: spot, v: v, u: u }); moved = true; }
        }
        if (moved) break;
      }
      if (moved) continue;
      return 'stuck';
    }
    return 'stuck';
  }

  function tForcedChain(grid, cands) {
    var order = [];
    for (var i = 0; i < 81; i++) if (grid[i] === 0) order.push(i);
    order.sort(function (a, b) { return popcount(cands[a]) - popcount(cands[b]); });
    var tried = 0;
    for (var oi = 0; oi < order.length; oi++) {
      var cell = order[oi];
      if (popcount(cands[cell]) > 3) continue;
      tried++;
      if (tried > 24) break;
      var vs = bits(cands[cell]);
      for (var vi = 0; vi < vs.length; vi++) {
        var v = vs[vi];
        var g2 = cloneGrid(grid), c2 = new Int16Array(81);
        for (var k = 0; k < 81; k++) c2[k] = cands[k];
        c2[cell] = 0; g2[cell] = v;
        var pp = PEERS[cell];
        for (k = 0; k < pp.length; k++) if (g2[pp[k]] === 0) c2[pp[k]] &= ~V(v);
        var log = [];
        var res = propagateSingles(g2, c2, 400, log);
        if (res === 'contradiction')
          return { kind: 'elim', i: cell, v: v, level: 8, tech: '强制链 Forcing Chain（反证）',
            reason: '假设 ' + cellName(cell) + ' 填 ' + v + '，只用「唯一余数 / 隐性唯一」往下推就出现矛盾 → 所以这里不能是 ' + v,
            chain: '假设' + cellName(cell) + '=' + v + ' → ' + chainText(log) };
        if (res === 'solved')
          return { kind: 'place', i: cell, v: v, level: 8, tech: '强制链 Forcing Chain（收敛）',
            reason: '假设 ' + cellName(cell) + ' 填 ' + v + '，可以一路推出完整且自洽的解（本题唯一解）→ 所以这里就是 ' + v,
            chain: '假设' + cellName(cell) + '=' + v + ' → ' + chainText(log) };
      }
    }
    return null;
  }

  var LADDER = [
    [1, tNakedSingle], [2, tHiddenSingle], [3, tPointingClaiming],
    [4, tNakedSubset], [4, tHiddenPair], [5, tXWing], [5, tSwordfish],
    [6, tXYWing], [6, tUniqueRectangle], [7, tSimpleColoring], [7, tXYChain],
    [8, tForcedChain]
  ];

  /* ---------------- 对外：提示 / 求解 / 定级 ---------------- */

  /* 有状态提示：调用方必须持有并延续 cands。
     排除类技巧（L3 起）的结论只在候选状态里累积才有意义，
     若每次重算候选，同一题会反复吐出同一条排除，永远推不到落子。
     返回 {kind:'place'|'elim', i, v, level, tech, reason} 或 null */
  function nextHintState(grid, cands, maxLevel) {
    maxLevel = maxLevel || 8;
    for (var k = 0; k < LADDER.length; k++) {
      if (LADDER[k][0] > maxLevel) continue;
      var a = LADDER[k][1](grid, cands);
      if (a) return a;
    }
    return null;
  }

  /* 无状态便捷版：每次从 grid 重算候选。只适合「单次试手」，
     连续提示请改用 nextHintState，否则会卡在同一条排除上。 */
  function nextHint(grid, maxLevel) {
    return nextHintState(grid, initCandidates(grid), maxLevel || 8);
  }

  /* 把 nextHintState 的动作落到 (grid, cands) */
  function applyAction(grid, cands, act) {
    if (act.kind === 'place') applyPlace(grid, cands, act.i, act.v);
    else cands[act.i] &= ~V(act.v);
  }

  function solveWithLevel(grid0, maxLevel, maxtries) {
    maxLevel = maxLevel || 8; maxtries = maxtries || 3000;
    var grid = cloneGrid(grid0), cands = initCandidates(grid);
    var usedMax = 0, steps = 0;
    for (var t = 0; t < maxtries; t++) {
      if (isSolved(grid)) return { ok: true, grid: grid, maxLevel: usedMax, steps: steps };
      var act = nextHintState(grid, cands, maxLevel);
      if (!act) return { ok: false, grid: grid, maxLevel: usedMax, steps: steps };
      usedMax = Math.max(usedMax, act.level);
      applyAction(grid, cands, act);
      steps++;
    }
    return { ok: isSolved(grid), grid: grid, maxLevel: usedMax, steps: steps };
  }

  function grade(grid) {
    for (var lv = 1; lv <= 8; lv++) if (solveWithLevel(grid, lv).ok) return lv;
    return 9;
  }

  /* ---------------- 生成器 ---------------- */
  function countSolutions(grid0, limit) {
    limit = limit || 2;
    var g = cloneGrid(grid0);
    var rows = new Int32Array(9), cols = new Int32Array(9), bx = new Int32Array(9);
    for (var i = 0; i < 81; i++) {
      var v = g[i];
      if (v) { var b = V(v); rows[Math.floor(i / 9)] |= b; cols[i % 9] |= b; bx[BOX[i]] |= b; }
    }
    var cnt = 0;
    (function bt() {
      if (cnt >= limit) return;
      var best = -1, bestn = 10;
      for (var i2 = 0; i2 < 81; i2++) {
        if (g[i2] === 0) {
          var used = rows[Math.floor(i2 / 9)] | cols[i2 % 9] | bx[BOX[i2]];
          var n = 9 - popcount(used & FULL);
          if (n < bestn) { bestn = n; best = i2; if (n <= 1) break; }
        }
      }
      if (best < 0) { cnt++; return; }
      var idx = best, used2 = rows[Math.floor(idx / 9)] | cols[idx % 9] | bx[BOX[idx]];
      for (var v2 = 1; v2 <= 9; v2++) {
        if (used2 & V(v2)) continue;
        g[idx] = v2;
        rows[Math.floor(idx / 9)] |= V(v2); cols[idx % 9] |= V(v2); bx[BOX[idx]] |= V(v2);
        bt();
        g[idx] = 0;
        rows[Math.floor(idx / 9)] &= ~V(v2); cols[idx % 9] &= ~V(v2); bx[BOX[idx]] &= ~V(v2);
        if (cnt >= limit) return;
      }
    })();
    return cnt;
  }

  function generateFull(rng) {
    var g = new Int8Array(81);
    var cand = new Int16Array(81);
    for (var i = 0; i < 81; i++) cand[i] = FULL;
    (function bt(pos) {
      if (pos === 81) return true;
      var used = 0, pp = PEERS[pos];
      for (var k = 0; k < pp.length; k++) if (g[pp[k]]) used |= V(g[pp[k]]);
      if (used & FULL) { /* noop */ }
      var avail = [];
      for (var v = 1; v <= 9; v++) if (!(used & V(v))) avail.push(v);
      for (var a = avail.length - 1; a > 0; a--) { var j = Math.floor(rng() * (a + 1)); var tmp = avail[a]; avail[a] = avail[j]; avail[j] = tmp; }
      for (var ai = 0; ai < avail.length; ai++) {
        g[pos] = avail[ai];
        if (bt(pos + 1)) return true;
        g[pos] = 0;
      }
      return false;
    })(0);
    return g;
  }

  function dig(full, rng, targetClues) {
    var g = cloneGrid(full), clues = 81;
    var order = [];
    for (var i = 0; i < 81; i++) order.push(i);
    for (var a = order.length - 1; a > 0; a--) { var j = Math.floor(rng() * (a + 1)); var t = order[a]; order[a] = order[j]; order[j] = t; }
    for (var k = 0; k < order.length; k++) {
      if (clues <= targetClues) break;
      var idx = order[k], bak = g[idx];
      g[idx] = 0;
      if (countSolutions(g, 2) !== 1) g[idx] = bak; else clues--;
    }
    return { puzzle: g, clues: clues };
  }

  /* ---------------- 校验 ---------------- */
  function validate(grid, solution) {
    var bad = [];
    for (var i = 0; i < 81; i++)
      if (grid[i] && solution && grid[i] !== solution[i]) bad.push(i);
    return bad;
  }

  var API = {
    FULL: FULL, POP: POP, PEERS: PEERS, UNITS: UNITS, BOX: BOX,
    cellName: cellName, bits: bits, popcount: popcount, V: V,
    initCandidates: initCandidates, applyPlace: applyPlace, isSolved: isSolved,
    nextHint: nextHint, nextHintState: nextHintState, applyAction: applyAction,
    propagateSingles: propagateSingles, chainText: chainText, unitName: unitName,
    solveWithLevel: solveWithLevel, grade: grade,
    generateFull: generateFull, countSolutions: countSolutions, dig: dig,
    validate: validate,
    LEVEL_NAMES: ['', '唯一余数', '隐性唯一', '区块摒除', '数对/数组', '鱼型',
      'XY-Wing/唯一矩形', '链技巧', '强制链']
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.SudokuEngine = API;
})(typeof window !== 'undefined' ? window : globalThis);



/* ---------------- 下一段 ---------------- */


window.SUDOKU_BANK = {"seed":20261023,"tiers":[{"key":"easy","name":"入门","blurb":"只需「唯一余数」就能一路推完","targets":[1],"puzzles":[{"g":"103080092007059384894720000005960408008500020009042060940308205580400130300205846","sol":"153684792627159384894723651235967418468531927719842563946318275582476139371295846","clues":45,"grade":1,"steps":36},{"g":"007020000060743150900000008805402007013800920670109005780210034500384000300000800","sol":"157928643268743159934651278895462317413875926672139485789216534526384791341597862","clues":37,"grade":1,"steps":44},{"g":"000059106010020305020060000405012070289470010001003204002100500143000800650200001","sol":"374859126916724385528361749435612978289475613761983254892146537143597862657238491","clues":36,"grade":1,"steps":45},{"g":"007000543930000070086743021003074000000000406408502300300007869000485002820309004","sol":"217896543934251678586743921193674285752938416468512397345127869679485132821369754","clues":38,"grade":1,"steps":43},{"g":"170004329006729800289500760403107502010000936058300147500010078020806400830045090","sol":"175684329346729815289531764493167582712458936658392147564913278921876453837245691","clues":46,"grade":1,"steps":35},{"g":"901020400804000006020070090093001000642000130180003000400502710219068300058030009","sol":"961825473874319526325476891593241687642987135187653942436592718219768354758134269","clues":36,"grade":1,"steps":45},{"g":"019000204673000008420008006080007000096835400150004000700069080930000045060403017","sol":"819756234673942158425318796384127569296835471157694823741569382938271645562483917","clues":36,"grade":1,"steps":45},{"g":"026900008704000390503204670601000900238709416005006823000500084810467205000308160","sol":"126973548784615392593284671641832957238759416975146823362591784819467235457328169","clues":44,"grade":1,"steps":37},{"g":"000692004067540008340810602410780020078006300020100800006000205004020163192300487","sol":"581692734267543918349817652413789526978256341625134879836471295754928163192365487","clues":42,"grade":1,"steps":39},{"g":"000400032190056000070839506830500100015302608746000253307090000480125360000783405","sol":"568471932193256784274839516832567149915342678746918253357694821489125367621783495","clues":44,"grade":1,"steps":37},{"g":"843002070279001006106098243005070408300264709400810032000480197908507000000030820","sol":"843652971279341586156798243625973418381264759497815632532486197918527364764139825","clues":44,"grade":1,"steps":37},{"g":"912005043006020001753004296080000000400032965609050100068371050097540380004000600","sol":"912765843846923571753184296385619724471832965629457138268371459197546382534298617","clues":41,"grade":1,"steps":40},{"g":"852439000007005400430060258108092507090670000203001900080700325001250079705000610","sol":"852439761617825493439167258168392547594678132273541986986714325341256879725983614","clues":42,"grade":1,"steps":39},{"g":"482005013300208065160070028504007009076801054030950070013042800750109206040000500","sol":"482695713397218465165473928524367189976821354831954672613542897758139246249786531","clues":43,"grade":1,"steps":38},{"g":"709842003400937085380061094205700830070600509000000107807450061000276000564009072","sol":"759842613416937285382561794295714836173628549648395127827453961931276458564189372","clues":44,"grade":1,"steps":37},{"g":"403009070020500046610704023260017300800053712000400080080040259540020137002170068","sol":"453269871728531946619784523265817394894653712371492685187346259546928137932175468","clues":43,"grade":1,"steps":38},{"g":"104000056005416823386250704243700005069004008010900430052100009437602500601500000","sol":"124873956975416823386259714243781695569324178718965432852147369437692581691538247","clues":44,"grade":1,"steps":37},{"g":"403100065070500038060080719200630090090004500810902643108365974630270000000000320","sol":"483197265971526438562483719245638197396714582817952643128365974634279851759841326","clues":42,"grade":1,"steps":39},{"g":"007280900510340600029106008056000080000068200890030165003600050042051076075000001","sol":"367285914518349627429176538256914783731568249894732165183697452942851376675423891","clues":38,"grade":1,"steps":43},{"g":"320600010069180000071300460196050004008000390040700685632570008514908270987240000","sol":"325694817469187532871325469196853724758462391243719685632571948514938276987246153","clues":44,"grade":1,"steps":37},{"g":"087200590540798103016030070258000609000685300670100080030010040120306000060850900","sol":"387261594542798163916534872258473619491685327673129485835917246129346758764852931","clues":40,"grade":1,"steps":41},{"g":"948030021063020900021948005050002073000386002032050100070000068100000207006004300","sol":"948635721563127984721948635659412873417386592832759146375291468194863257286574319","clues":37,"grade":1,"steps":44},{"g":"670050910010692000080040530390486000406200800001000600902100700108527360700068001","sol":"674853912513692487289741536397486125456219873821375694962134758148527369735968241","clues":39,"grade":1,"steps":42},{"g":"046750009207100380051089006000008020508300091402915007605071000900600100083504002","sol":"846753219297146385351289746719468523568327491432915867625871934974632158183594672","clues":40,"grade":1,"steps":41},{"g":"400071005015900038760000100100026859028340600600008004092007400501039206046802507","sol":"483271965215964738769583142134726859928345671657198324892657413571439286346812597","clues":42,"grade":1,"steps":39},{"g":"795003010002000040000800359264000930503000000010304208000010700079032580328076491","sol":"795643812832195647641827359264781935583269174917354268456918723179432586328576491","clues":39,"grade":1,"steps":42},{"g":"890000704760432900245980060009708000470203050382010000157020603934500000620004500","sol":"893156724761432985245987361519748236476293158382615497157829643934561872628374519","clues":42,"grade":1,"steps":39},{"g":"000200006300000070069043005070008413081034007036000029523190048700002061600007590","sol":"847215936352869174169743285975628413281934657436571829523196748798452361614387592","clues":38,"grade":1,"steps":43},{"g":"706002901210473685085100047007000000023785060560090070000007800008546710602018453","sol":"746852931219473685385169247897631524423785169561294378154327896938546712672918453","clues":44,"grade":1,"steps":37},{"g":"200003900003400528490027013100274836000000050604080102078300200006000081300608704","sol":"281563947763419528495827613159274836827136459634985172978341265546792381312658794","clues":39,"grade":1,"steps":42},{"g":"706000042015208673204730105079520316500071020020003907002080004000400709000390081","sol":"736159842915248673284736195879524316563971428421863957192687534358412769647395281","clues":42,"grade":1,"steps":39},{"g":"003040190120800564094005000000400056960710480478052903706020845841000020259084670","sol":"583246197127839564694175238312498756965713482478652913736921845841567329259384671","clues":46,"grade":1,"steps":35},{"g":"509830040100006380086000195654100239090002504231509060070008050015400600860005020","sol":"529831746147956382386274195654187239798362514231549867472618953915423678863795421","clues":42,"grade":1,"steps":39},{"g":"108905407007380916000070030000640785380000140005120060060810293000090050210036004","sol":"138965427457382916692471538921643785386759142745128369564817293873294651219536874","clues":40,"grade":1,"steps":41},{"g":"230081000000020009000057230610004350009005670050816020071560093324000805060008000","sol":"236981547547623189198457236612794358489235671753816924871562493324179865965348712","clues":37,"grade":1,"steps":44},{"g":"829063154471980060650000798100576309000400600067029800782390510004607002000052007","sol":"829763154471985263653241798148576329295438671367129845782394516534617982916852437","clues":46,"grade":1,"steps":35},{"g":"400050310012040080300001290098735600704060900060084170601090037879500000543017009","sol":"487259316912346785356871294198735642734162958265984173621498537879523461543617829","clues":42,"grade":1,"steps":39},{"g":"207810000005370814000645097084721030300008020070053081820007006096004350450006978","sol":"247819563965372814138645297584721639319468725672953481823597146796184352451236978","clues":44,"grade":1,"steps":37},{"g":"000200080080503040936470200003945020009836500804020003491602000328750469675094010","sol":"547219386182563947936478251763945128219836574854127693491682735328751469675394812","clues":45,"grade":1,"steps":36},{"g":"401502000000046103500710600050371206130469080070025300600000937300157068708600001","sol":"461532879287946153593718642854371296132469785976825314615284937329157468748693521","clues":42,"grade":1,"steps":39},{"g":"894005001530021780007000965085639017000150208009004603000002106400510839960078040","sol":"894765321536921784127843965285639417643157298719284653358492176472516839961378542","clues":44,"grade":1,"steps":37},{"g":"370000602500060000090728135000000000009000360007296800042001583016003040703080910","sol":"378145692521369478694728135165834729289517364437296851942671583816953247753482916","clues":36,"grade":1,"steps":45},{"g":"000160800061800307389007001600008924093502700800796510906080175400075039027930406","sol":"754163892261859347389427651675318924193542768842796513936284175418675239527931486","clues":46,"grade":1,"steps":35},{"g":"291040600057032009360150000002087146100000950070910008009463870703000000016805090","sol":"291748635857632419364159782932587146148326957675914328529463871783291564416875293","clues":40,"grade":1,"steps":41},{"g":"070890400940605802068402001250080946407006100800100000005724609620030080014968023","sol":"172893465943615872568472391251387946497256138836149257385724619629531784714968523","clues":44,"grade":1,"steps":37},{"g":"800000000000310600537968210023546008000809120908001400050780901080690537070004002","sol":"816425379294317685537968214123546798745839126968271453652783941481692537379154862","clues":40,"grade":1,"steps":41},{"g":"724039108500802490918004020305000280009700005040050006150207800890400012060080030","sol":"724639158536812497918574623375946281689721345241358976153297864897463512462185739","clues":40,"grade":1,"steps":41},{"g":"085004000010839546934060008000301695050006003090008704049087001003400009860590070","sol":"685124937712839546934765128428371695157946283396258714249687351573412869861593472","clues":40,"grade":1,"steps":41},{"g":"000000029204008005053902078029605000000029000861304900600080000008091046947500080","sol":"786153429294768315153942678429615837375829164861374952612487593538291746947536281","clues":36,"grade":1,"steps":45},{"g":"800530246002841370053207890149008650060925000027610900016480020084052000000100700","sol":"871539246692841375453267891149378652368925417527614938716483529984752163235196784","clues":44,"grade":1,"steps":37},{"g":"021587390094020056507690200300800410209760000185002600068005923903270008400930160","sol":"621587394894123756537694281376859412249761835185342679768415923913276548452938167","clues":46,"grade":1,"steps":35},{"g":"380760945000000206000405001200051030100070624700003018006000100010324007020906050","sol":"381762945594138276672495381248651739153879624769243518436587192915324867827916453","clues":36,"grade":1,"steps":45},{"g":"801467205000093100047000089005078001128000090970204060209780400514600872706540010","sol":"891467235652893147347125689465978321128356794973214568239781456514639872786542913","clues":44,"grade":1,"steps":37},{"g":"200004760417003802800702004030070006000045080580000371028400100609281430700539620","sol":"295814763417693852863752914932178546176345289584926371328467195659281437741539628","clues":42,"grade":1,"steps":39},{"g":"006300005904651000170002030003000207680007950701029680017040500060015700400086301","sol":"826374195934651872175892436593468217682137954741529683217943568368215749459786321","clues":39,"grade":1,"steps":42},{"g":"000007034009082507075340021100406780700021000906000000097600318000200400063700295","sol":"821567934349182567675349821152436789784921653936875142297654318518293476463718295","clues":38,"grade":1,"steps":43},{"g":"030000009902050146057190380000020800120403900000015060290000600518039420000248590","sol":"431862759982357146657194382375926814126483975849715263294571638518639427763248591","clues":39,"grade":1,"steps":42},{"g":"306070014290040800081300007800012300970500080103000000019003028004781905030209700","sol":"356978214297145863481326597845612379972534186163897452719453628624781935538269741","clues":38,"grade":1,"steps":43},{"g":"004070029080090076279401805300050640500684013046020057000216094015847060400035080","sol":"654378129183592476279461835321759648597684213846123957738216594915847362462935781","clues":45,"grade":1,"steps":36},{"g":"030160058800030090010948367200091640040006002000300785000003870375089100180000504","sol":"934167258867235491512948367258791643743856912691324785426513879375489126189672534","clues":40,"grade":1,"steps":41},{"g":"700002005050300200030605071500004613360807000904036080000000140603091708019000006","sol":"796412835158379264432685971587924613361857492924136587875263149643591728219748356","clues":36,"grade":1,"steps":45},{"g":"728351964010004002506090070607910003004023000209475018802007130400100000301200095","sol":"728351964913764582546892371657918243184623759239475618892547136465139827371286495","clues":43,"grade":1,"steps":38},{"g":"080000913705000200903204000040000802000070050600423001506809304831040000002536080","sol":"284657913765391248913284675147965832329178456658423791576819324831742569492536187","clues":36,"grade":1,"steps":45},{"g":"009000000360970052500368179600090205705821096204050781106080000457100908903540010","sol":"879215364361974852542368179618497235735821496294653781126789543457136928983542617","clues":45,"grade":1,"steps":36},{"g":"000010403143026005070053690084701539006004007001089246050000008000690104600048050","sol":"965817423143926785872453691284761539596234817731589246459172368328695174617348952","clues":40,"grade":1,"steps":41},{"g":"408537060206000783070002005001800200002003578005700046527018004080000301160954007","sol":"418537962256491783379682415741865239692143578835729146527318694984276351163954827","clues":41,"grade":1,"steps":40},{"g":"301506000800920000569070200205060000430000005706000082007800051002605093050791004","sol":"321586479874923516569174238295368147438217965716459382947832651182645793653791824","clues":36,"grade":1,"steps":45},{"g":"728005301604900007319800056080304519907500003000000008870102034460759082102003675","sol":"728645391654931827319827456286374519947518263531296748875162934463759182192483675","clues":46,"grade":1,"steps":35},{"g":"090030700078041309600708000856300910210905640400000000080672400760003291020410870","sol":"192536784578241369643798152856324917217985643439167528981672435764853291325419876","clues":41,"grade":1,"steps":40},{"g":"064371950050000100100980074600540097009037000000290400475800203001700009006402781","sol":"864371952957624138123985674612548397549137826738296415475819263281763549396452781","clues":40,"grade":1,"steps":41},{"g":"000400518006870900500130006010200084089014250064008100090700000070581009603940801","sol":"937426518146875932528139746315297684789614253264358197891763425472581369653942871","clues":39,"grade":1,"steps":42},{"g":"007003000400800963326100700874510009002030100160029080050040031708900542241080600","sol":"987653214415872963326194758874516329592438176163729485659247831738961542241385697","clues":41,"grade":1,"steps":40},{"g":"908500107532071800040290300000006002054900610806425709005010003020004900080309076","sol":"968543127532671894147298365379186542254937618816425739695712483723864951481359276","clues":40,"grade":1,"steps":41},{"g":"000650000542070306073210509001080090309702165000000720800100002000005000006028957","sol":"918653274542879316673214589721586493389742165465931728854197632297365841136428957","clues":36,"grade":1,"steps":45},{"g":"000200091040180060167049028030691000200500803051800076000750040620403000000920030","sol":"583267491942185367167349528738691254296574813451832976319758642625413789874926135","clues":37,"grade":1,"steps":44},{"g":"823000000014802053570006002307004000951200076240157390008630100035021680060008507","sol":"823549761614872953579316842387964215951283476246157398798635124435721689162498537","clues":43,"grade":1,"steps":38},{"g":"090576304013004076074012050085003701340000500120658000000425009439807120852009607","sol":"298576314513984276674312958985243761346791582127658493761425839439867125852139647","clues":46,"grade":1,"steps":35},{"g":"200090000040005160856021070320160400010074906004950200090047020485612700000039005","sol":"231796584947385162856421379329168457518274936764953218693547821485612793172839645","clues":40,"grade":1,"steps":41},{"g":"105003028000000043008090165020800004563900200001002609070539816050010400009426050","sol":"145673928692185743738294165927861534563947281481352679274539816356718492819426357","clues":39,"grade":1,"steps":42},{"g":"960057341501800020720049000030015208216098054895704600009500470100080530000900006","sol":"968257341541863927723149865437615298216398754895724613689531472172486539354972186","clues":43,"grade":1,"steps":38},{"g":"000000870000800590050972030408000003920340087603000049134567908280004300006203710","sol":"369415872742836591851972436478629153925341687613758249134567928287194365596283714","clues":40,"grade":1,"steps":41},{"g":"002060007400501200157203640509310000001609020623785904800907001006408730974006500","sol":"392864157468571293157293648549312876781649325623785914835927461216458739974136582","clues":44,"grade":1,"steps":37},{"g":"040026039128000400360100870070583001453001087891040603600907520900200004782010096","sol":"547826139128379465369154872276583941453691287891742653614937528935268714782415396","clues":45,"grade":1,"steps":36},{"g":"057640300002190570018000609080975460064800790009406180001589240845200930206004050","sol":"957642318632198574418753629183975462564821793729436185371589246845267931296314857","clues":46,"grade":1,"steps":35},{"g":"009400020050009640040020031306087090780290316090006002810070250900000164500000800","sol":"139468527257319648648725931326187495785294316491536782814673259973852164562941873","clues":37,"grade":1,"steps":44},{"g":"001760093096000070027009004700085340040300901500046082003050607005690408264807509","sol":"451768293396421875827539164712985346648372951539146782983254617175693428264817539","clues":42,"grade":1,"steps":39},{"g":"500980043384000900109040875000100058800300790942050601706510000018000520200490007","sol":"567981243384275916129643875673129458851364792942857631796512384418736529235498167","clues":40,"grade":1,"steps":41},{"g":"000670050060853140070002060800030000400000025900200604593700400604321509710900006","sol":"148679253269853147375412968826534791437196825951287634593768412684321579712945386","clues":37,"grade":1,"steps":44},{"g":"000695234425700009060000800659300008370800001008076090030064502040037986196008043","sol":"781695234425783169963241857659312478374859621218476395837964512542137986196528743","clues":43,"grade":1,"steps":38},{"g":"160034078408615023509702146081050060000071300090406017000003650950007002246508730","sol":"162934578478615923539782146781359264624871395395426817817243659953167482246598731","clues":46,"grade":1,"steps":35},{"g":"187509204300810000905007081560300800073690000490028500000086059050900403700450020","sol":"187539264326814975945267381562341897873695142491728536234186759658972413719453628","clues":40,"grade":1,"steps":41},{"g":"950710402070032890000008617301000004065024070720950008503209746000075000200603901","sol":"958716432176432895432598617391867524865324179724951368513289746649175283287643951","clues":42,"grade":1,"steps":39},{"g":"002305100003900842640807035467080001008002076239001008170260580025704009390058024","sol":"982345167753916842641827935467583291518492376239671458174269583825734619396158724","clues":46,"grade":1,"steps":35},{"g":"419620300085013240073050086000930060704180050000006002507000038800005090391867000","sol":"419628375685713249273459186152934867764182953938576412547291638826345791391867524","clues":40,"grade":1,"steps":41},{"g":"006000708357680002000709034584106320630025001000893400700910503100000986043560007","sol":"496231758357684192812759634584176329639425871271893465768912543125347986943568217","clues":43,"grade":1,"steps":38},{"g":"082005070019270580000130902500810790960350128008000430050000847034000609006400000","sol":"682945371319276584475138962543812796967354128128769435251693847834527619796481253","clues":39,"grade":1,"steps":42},{"g":"065100004000500060849206005080000051930005400756000809090052080608009503000060792","sol":"365198274172543968849276315284937651931685427756421839497352186628719543513864792","clues":37,"grade":1,"steps":44},{"g":"017069830609402750005071964102007403054013207090048010300000600076394100000786045","sol":"417569832689432751235871964162957483854613297793248516348125679576394128921786345","clues":46,"grade":1,"steps":35},{"g":"400200795006075308500080002000024001021090407009751800100060500932500000600008003","sol":"418236795296175348573489162765824931821693457349751826184362579932517684657948213","clues":36,"grade":1,"steps":45},{"g":"069000007125060093370020004000400002950008370000097000642980035000500060591603000","sol":"469835217125764893378129654713456982954218376286397541642981735837542169591673428","clues":36,"grade":1,"steps":45}]},{"key":"simple","name":"简单","blurb":"偶尔用一下「隐性唯一」","targets":[2],"puzzles":[{"g":"960000004032179000708000000000310800300082460800604030604008001205961000090000000","sol":"961853274432179586758426319546317892319582467827694135674238951285961743193745628","clues":32,"grade":2,"steps":49},{"g":"095680400801420003700001008500000709320700000007200385000972004009300000000004900","sol":"295683471861427593734591268546138729328759146917246385183972654479365812652814937","clues":32,"grade":2,"steps":49},{"g":"075480206408003070006900000600059023000000800004000007500700000809006002000500314","sol":"975481236418263975326975148687159423253647891194832567531724689849316752762598314","clues":30,"grade":2,"steps":51},{"g":"060080207100000000005602900200300081638500000701024069500040802006208170800705096","sol":"963481257127953648485672913294367581638519724751824369579146832346298175812735496","clues":37,"grade":2,"steps":44},{"g":"051008304800500900040200010480001070000060085900005031000653000003000000608109003","sol":"251798364836514927749236518485321679312967485967485231174653892593872146628149753","clues":31,"grade":2,"steps":50},{"g":"080320000001070053070000000006084007304796210007030469030910000090050840000000000","sol":"689325174241879653573461982926184537354796218817532469435918726792653841168247395","clues":31,"grade":2,"steps":50},{"g":"001000406080300290006002000003200719000034620000000043100079800020045907900000050","sol":"231598476485367291796412385843256719519734628672981543154679832328145967967823154","clues":31,"grade":2,"steps":50},{"g":"500300400000008003003490020200007041100060302000000960879050006352000090460000000","sol":"587326419924718653613495827296837541148569372735142968879254136352681794461973285","clues":30,"grade":2,"steps":51},{"g":"507010603004700000008060400203000050006043210700905300135000060060000000400000130","sol":"597214683614738529328569471243176958956843217781925346135497862862351794479682135","clues":30,"grade":2,"steps":51},{"g":"000091020000400700230057000089100362010004508000060940003080600000740030045310207","sol":"576891423198423756234657189489175362612934578357268941723589614961742835845316297","clues":34,"grade":2,"steps":47},{"g":"400000080001020003003596041600009000000603402000702900060270800010805604208000000","sol":"426317589591428763783596241642159378179683452835742916364271895917835624258964137","clues":31,"grade":2,"steps":50},{"g":"431800920098100030025000870800060000100400090900000460300710000210049003500080709","sol":"431876925798152634625394871843967152156428397972531468389715246217649583564283719","clues":34,"grade":2,"steps":47},{"g":"800074600407010085090006007008100459009000073000709800500031090003000061900005208","sol":"835974612467312985192586347728163459659428173314759826586231794243897561971645238","clues":34,"grade":2,"steps":47},{"g":"000000080500902000001400059029040008410608020007090600106800007008760000070354010","sol":"794536182583912764261487359629143578415678923837295641156829437348761295972354816","clues":32,"grade":2,"steps":49},{"g":"050001009090350000000809030084905700030087964960043508600002800003690200070008040","sol":"358421679791356482426879135184965723532187964967243518645732891813694257279518346","clues":36,"grade":2,"steps":45},{"g":"609050073005000120003008000786000341000060700030040050068090004000506018000004060","sol":"619452873845379126273618495786925341954163782132847659568791234427536918391284567","clues":31,"grade":2,"steps":50},{"g":"050010004860094300000608090700900020698203000042001009000007000006030008000869015","sol":"957312684861794352234658197715946823698273541342581769589127436126435978473869215","clues":32,"grade":2,"steps":49},{"g":"890507034000000000500090080004000203003000059000071000200008001478006092061049070","sol":"892517634147683925536492187784965213613824759925371846259738461478156392361249578","clues":31,"grade":2,"steps":50},{"g":"000500890000079041300061052010600908620100037704300160000020000462700009000056003","sol":"271534896856279341349861752513647928628195437794382165135928674462713589987456213","clues":35,"grade":2,"steps":46},{"g":"000003010600407030005001004001002000940100703060000050004018095000670000380005147","sol":"497583216612497538835261974571832469948156723263749851724318695159674382386925147","clues":31,"grade":2,"steps":50},{"g":"007400800008020074290875000700201609021790300906304000070500010502007000140000000","sol":"657413892318629574294875163735281649421796385986354721879532416562147938143968257","clues":34,"grade":2,"steps":47},{"g":"000007020076000090500840307400700960200095140000001800010084006000160000300500400","sol":"134957628876312594529846317451738962287695143693421875915284736748163259362579481","clues":30,"grade":2,"steps":51},{"g":"950317040000090007007005800004200308205900400063050020000083060080500200006000900","sol":"958317642612894537347625891194276358275938416863451729529783164481569273736142985","clues":31,"grade":2,"steps":50},{"g":"300100000210000506000029307501004070000900005093080040030800051060040700082010000","sol":"376158924219437586854629317521364879648972135793581642437896251165243798982715463","clues":30,"grade":2,"steps":51},{"g":"400000050030074600160039400000680542200005000548090006000900100001020900690350087","sol":"487162359935874621162539478319687542276415893548293716723948165851726934694351287","clues":34,"grade":2,"steps":47},{"g":"920000601030026790176000040650200080000038000800007260010060070000401009702503400","sol":"928745631534126798176389542653214987297638154841957263419862375365471829782593416","clues":34,"grade":2,"steps":47},{"g":"009407500305069020080050009004090005030504062057000401000000000610000798070002050","sol":"129437586345869127786251349264193875831574962957628431593786214612345798478912653","clues":32,"grade":2,"steps":49},{"g":"080006300300700000004903800000802010050601098010007006007100540105270600006354901","sol":"781426359392785164564913827679832415253641798418597236937168542145279683826354971","clues":35,"grade":2,"steps":46},{"g":"000100090500803670000095200006000900090607500007030186005002403810300050900000802","sol":"784126395529843671361795248136458927298617534457239186675982413812364759943571862","clues":32,"grade":2,"steps":49},{"g":"093470000507008063040005001070050800400000507035807000009382000000060008386700902","sol":"693471285517928463842635791971256834468193527235847619759382146124569378386714952","clues":34,"grade":2,"steps":47},{"g":"502100030000500791060000002017390000008700040000000120006030009921000004030000276","sol":"572149638384526791169873452417392865258761943693485127746238519921657384835914276","clues":30,"grade":2,"steps":51},{"g":"000000080020700400060405010090263050201800600056001008000000572009602003000508100","sol":"947316285125789436368425917894263751231857694756941328683194572519672843472538169","clues":31,"grade":2,"steps":50},{"g":"706480021080000600000900040002500010814620900070000000150792030260804095040000180","sol":"796485321485231679321967548632579814814623957579148263158792436263814795947356182","clues":35,"grade":2,"steps":46},{"g":"890000000020351080730800060000500324900270000050100790009016200000000040043900600","sol":"891627453426351987735894162187569324964273815352148796579416238618732549243985671","clues":31,"grade":2,"steps":50},{"g":"906007580001000402000000030200100600604070058000400019079804005000005870005021900","sol":"936247581751683492428519736293158647614972358587436219379864125162395874845721963","clues":32,"grade":2,"steps":49},{"g":"000000510020051000003070080008034026000000400294068300302080000400013005700040090","sol":"847326519926851734153479682578134926631297458294568371362985147489713265715642893","clues":30,"grade":2,"steps":51},{"g":"080100050019260000602840109000000081096050000030400705500000308060510000070002010","sol":"487139652319265874652847139745623981196758423238491765521976348863514297974382516","clues":31,"grade":2,"steps":50},{"g":"003000000509004270000000506700106080100003702006700004940317600000600807070000401","sol":"463275918519864273287931546724156389195483762836729154948317625351642897672598431","clues":31,"grade":2,"steps":50},{"g":"904200005500806020082300006020067400030008002005002800400000058300104200208609003","sol":"964271385513896724782345916829567431637418592145932867491723658356184279278659143","clues":34,"grade":2,"steps":47},{"g":"108602009096030000000009060020050600540060973000700250400090020900307080000504790","sol":"158672439296435817374189562723951648541268973689743251417896325965327184832514796","clues":33,"grade":2,"steps":48},{"g":"700083154001700000082054070409007500003029400007000003004030020008640010130970040","sol":"796283154541796832382154976429367581813529467657418293964831725278645319135972648","clues":35,"grade":2,"steps":46},{"g":"710000000002000000083204060804072019107450030326908400075000098030000000008520103","sol":"719685324642731985583294761854372619197456832326918457475163298231849576968527143","clues":35,"grade":2,"steps":46},{"g":"000430060060000029021000000010500030058009002000010075000000013000020750170358290","sol":"897432561563871429421695387712584936358769142649213875285947613934126758176358294","clues":30,"grade":2,"steps":51},{"g":"300000500004006000576000003050947000283600900700320000060070020020000369430069187","sol":"392781546814536792576492813651947238283615974749328651968173425127854369435269187","clues":34,"grade":2,"steps":47},{"g":"370001654002603007004070002020137008067000401000400005040000000010004000000900246","sol":"378291654152643897694578312425137968967852431831469725549726183216384579783915246","clues":31,"grade":2,"steps":50},{"g":"074000082000400056000080000200050030000001008050300617000738005743012860002000170","sol":"974165382128493756365287491217856934436971528859324617691738245743512869582649173","clues":32,"grade":2,"steps":49},{"g":"005000400700062000000104567020006000001287649400000230010025004007010300003040120","sol":"165873492794562813382194567829436751531287649476951238618325974247619385953748126","clues":33,"grade":2,"steps":48},{"g":"060001000000000901001608000340015080020040190500289074090004008005003400204867500","sol":"462971853873452961951638742349715286728346195516289374197524638685193427234867519","clues":34,"grade":2,"steps":47},{"g":"000000050069780020004002068007020301100008500830010402405600000290040017000090040","sol":"328169754569784123714352968957426381142938576836517492485671239293845617671293845","clues":32,"grade":2,"steps":49},{"g":"060109050051002000023705160390400700002000630070001980000003090700090503030214806","sol":"467139258951862347823745169398456712142987635675321984286573491714698523539214876","clues":36,"grade":2,"steps":45},{"g":"000018600947000000860039400098305040000020379304000000620000000400100930700000500","sol":"532418697947256813861739425298375146156824379374691258629543781485167932713982564","clues":30,"grade":2,"steps":51},{"g":"090305706450170000600200401900000230305004610106000900000460073004900860560030090","sol":"291345786458176329673289451947618235325794618186523947819462573734951862562837194","clues":36,"grade":2,"steps":45},{"g":"006000000030810940005090007840027536300080100060030820000100000003008001000049600","sol":"496572318732816945185394267841927536329685174567431829954163782673258491218749653","clues":30,"grade":2,"steps":51},{"g":"053607009006080250090000700200000000000476005630205000049051600000960500007800000","sol":"453627819716389254892514763275138496981476325634295178349751682128963547567842931","clues":30,"grade":2,"steps":51},{"g":"000020030340800000900403510090000057508000004000980002025007080000041605100090003","sol":"657129438341856729982473516293614857568732194714985362425367981839241675176598243","clues":30,"grade":2,"steps":51},{"g":"000758691500206080960300002002000000005479230397080014006940300040000000103067000","sol":"234758691571296483968314752482135976615479238397682514856941327749823165123567849","clues":36,"grade":2,"steps":45},{"g":"000000061004500290026410800900008512071200000602000000415007900080000006000000720","sol":"598372461134586297726419835943768512871235649652194378415627983287943156369851724","clues":30,"grade":2,"steps":51},{"g":"000820047000000500700300908060910002413080705020000000004030006385200004000000089","sol":"931825647648197523752346918567914832413682795829573461194738256385269174276451389","clues":30,"grade":2,"steps":51},{"g":"308605720100970050000000001210000000000300010605020000900008347046203000830400200","sol":"398615724164972853527834961213549678479386512685721439952168347746293185831457296","clues":31,"grade":2,"steps":50},{"g":"019700300608000000400906270001000036005648107000300090580023000024000003037061040","sol":"219754368678132954453986271741295836395648127862317495586423719124579683937861542","clues":34,"grade":2,"steps":47},{"g":"000076050074000000635090400003720000069300000000605230000501004007200903006000580","sol":"912476358874153692635892417583729146269314875741685239398561724157248963426937581","clues":30,"grade":2,"steps":51},{"g":"800596074003014009490007000080001000000040097040030200030000900609003012270050400","sol":"821596374763814529495327168582971643316245897947638251134762985659483712278159436","clues":32,"grade":2,"steps":49},{"g":"016008320040350690035690047000009004104006200583004070069027080000003060000460000","sol":"916748325847352691235691847672839154194576238583214976469127583751983462328465719","clues":36,"grade":2,"steps":45},{"g":"970030058001004000043850000130500600020048173000003000200309045307405001005001002","sol":"972136458851974236643852917138597624529648173764213589216389745397425861485761392","clues":35,"grade":2,"steps":46},{"g":"089103620005070090100000058000216980217000460008040000000027309902300000300600870","sol":"789153624465872193123469758534216987217938465698745231846527319972381546351694872","clues":35,"grade":2,"steps":46},{"g":"070600500500013007003800002059020780017908000020000400060000090001509000090037200","sol":"172694538586213947943875612459326781617948325328751469765482193231569874894137256","clues":30,"grade":2,"steps":51},{"g":"400020003000003900008000004000040807002001500000860312036710029000034065700650138","sol":"417529683625483971398176254163245897872391546954867312536718429281934765749652138","clues":34,"grade":2,"steps":47},{"g":"800009107603070092004000000091340065000050001500910080000001650160700000030060000","sol":"852639147613874592974125836791348265348256971526917384287491653165783429439562718","clues":30,"grade":2,"steps":51},{"g":"530000001070400023092000000006041300017008090900006010700012430100364070340009102","sol":"534627981871495623692183745286941357417538296953276814765812439129364578348759162","clues":35,"grade":2,"steps":46},{"g":"060080000090706002020904736000570090000090048539108600400020005000407300050000204","sol":"763285419194736852825914736648572193217693548539148627476321985982457361351869274","clues":33,"grade":2,"steps":48},{"g":"000730080006008000030602700070389200280070040065010070043100052008005600527060100","sol":"952731486716948523834652719471389265289576341365214978643197852198425637527863194","clues":35,"grade":2,"steps":46},{"g":"004009082280500000000200650000900200028004065915000740000002130490000006070005004","sol":"564719382287563491139248657643957218728134965915826743856472139492381576371695824","clues":31,"grade":2,"steps":50},{"g":"000530004650000080000010600080329500020800060035000928000001009104052000200090400","sol":"812536794659274183347918652786329541921845367435167928563481279194752836278693415","clues":30,"grade":2,"steps":51},{"g":"000000040907410036354008000190300005000080400400000920000706800270890600006000070","sol":"621973548987415236354628197192364785735289461468157923549736812273891654816542379","clues":30,"grade":2,"steps":51},{"g":"000100003102005004003900680000050008360000027845090000914800700600003009500000002","sol":"496178253182635974753924681271356498369481527845297316914862735627513849538749162","clues":30,"grade":2,"steps":51},{"g":"000001000905028000218936054000000302603102405824000000302090560000080040400013000","sol":"736541829945728136218936754571864392693172485824359617382497561167285943459613278","clues":34,"grade":2,"steps":47},{"g":"040050060000740890000306710400130007800000450700090020005010000000089500002500940","sol":"147958362263741895598326714429135687831672459756894123985413276674289531312567948","clues":30,"grade":2,"steps":51},{"g":"003006509500003000400200007240800070008000001065037082800020950000005700607000200","sol":"783416529512973864496258137241869375378542691965137482834721956129685743657394218","clues":30,"grade":2,"steps":51},{"g":"026008047780004029001030000000461700000003000308700050079000603000300072000800004","sol":"526918347783654129491237865952461738147583296368729451279145683814396572635872914","clues":30,"grade":2,"steps":51},{"g":"800007001002540080000210304031009000005803100080401500057380000100004000000070009","sol":"864937251312546987579218364231759648495863172786421593957382416128694735643175829","clues":30,"grade":2,"steps":51},{"g":"003006009000200700765390402800050000610803090509170000001000030207930000000000004","sol":"423786159198245763765391482872659341614823597539174826951467238247938615386512974","clues":30,"grade":2,"steps":51},{"g":"900300002000900800600487103000800200000090081801000647200000030300100520008040010","sol":"987315462134926875625487193473861259562794381891532647219658734346179528758243916","clues":30,"grade":2,"steps":51},{"g":"040000000000050070100780003000802659060004300500061742030610805810300200600000100","sol":"749123586328456971156789423471832659962574318583961742234617895817395264695248137","clues":32,"grade":2,"steps":49},{"g":"060002800080900050000007326000105900400069000090070210801000000000091038509080007","sol":"163542879287936451954817326378125964412369785695478213831754692746291538529683147","clues":30,"grade":2,"steps":51},{"g":"510000000000000600300870004060302000100040089040000000030050802490708106801026930","sol":"514263798789514623326879514965382471173645289248197365637951842492738156851426937","clues":31,"grade":2,"steps":50},{"g":"035008102976512300000040000000000200057030080093004007329080000580600070060395804","sol":"435768192976512348812943756648179235157236489293854617329487561584621973761395824","clues":36,"grade":2,"steps":45},{"g":"000030025452060091301200004008607000137020000060300807049000000705000903603070000","sol":"986134725452768391371259684598647132137825469264391857849513276725486913613972548","clues":33,"grade":2,"steps":48},{"g":"300040029200300408400000107938461005001000906000509803060103702003700050000900000","sol":"316847529279315468485692137938461275751238946642579813564183792893724651127956384","clues":34,"grade":2,"steps":47},{"g":"050903041000001790060000000801320509000000080793045000670410900000000020000609400","sol":"257963841438251796169784253841326579526197384793845162675412938914538627382679415","clues":30,"grade":2,"steps":51},{"g":"073004000960001040005080030800020170000400060756130000049215387000000002520800004","sol":"273654891968371245415982736894526173132497568756138429649215387381749652527863914","clues":34,"grade":2,"steps":47},{"g":"600040010070030456500060803000103607004080031300407020457810000100009784900004000","sol":"638745219271938456549261873825193647794682531316457928457816392163529784982374165","clues":36,"grade":2,"steps":45},{"g":"000400026030687009600009538300090075000701090792050001570302900000000007009006300","sol":"918435726235687149647129538361294875854761293792853461576312984123948657489576312","clues":34,"grade":2,"steps":47},{"g":"030400009009002100081309002943600820200900000010000054070090000090807260008005090","sol":"532418679469572138781369542943651827257984316816723954375296481194837265628145793","clues":32,"grade":2,"steps":49},{"g":"000421706000070805972080100000000260610700040004605080405000312060230050030000670","sol":"853421796146379825972586134597843261618792543324615987485967312761238459239154678","clues":35,"grade":2,"steps":46},{"g":"020037000570020000080400026250304090009070402006008500002580049100040053340009070","sol":"624837915571926384983451726257364891839175462416298537762583149198742653345619278","clues":35,"grade":2,"steps":46},{"g":"001039080000002010000710409710060040040070500503000170008050090000001800070028300","sol":"461539782397482615825716439712865943946173528583294176138657294259341867674928351","clues":30,"grade":2,"steps":51},{"g":"300217968200804001010900000000620004000000520000705003054360800180002630000000000","sol":"345217968296854371817936245538621794971483526462795183754369812189542637623178459","clues":31,"grade":2,"steps":50},{"g":"000904016072300490060000370010000053090030800306158007654009100980500060000001080","sol":"835974216172365498469812375218497653597236841346158927654789132981523764723641589","clues":35,"grade":2,"steps":46},{"g":"010030080080059020070084951036900540001005070450008000009020407020490805040003000","sol":"915732684684159723372684951236917548891245376457368192569821437723496815148573269","clues":35,"grade":2,"steps":46},{"g":"090031002730092610152074030000083007587900000200050068025000000000210490009308700","sol":"694831572738592614152674839961483257587926341243157968325749186876215493419368725","clues":37,"grade":2,"steps":44}]},{"key":"medium","name":"中等","blurb":"开始需要「区块摒除」","targets":[3],"puzzles":[{"g":"001300504500000007463050000020001040100060905006490300030608070000900800040000000","sol":"871329564592846137463157298329581746184763925756492381235618479617934852948275613","clues":28,"grade":3,"steps":55},{"g":"009000500008950301040000020000000003630094000004008000756201000800000100000587200","sol":"369412578278956341145873629987125463632794815514368792756231984823649157491587236","clues":27,"grade":3,"steps":56},{"g":"008300010314027000000000020700000046000000070900080105009004500003070090000050702","sol":"298345617314627859657198324782531946135469278946782135879214563523876491461953782","clues":26,"grade":3,"steps":58},{"g":"000040008000060003000803700400000030000008295005002400900120050010680000052004007","sol":"236749518578261943149853762427596831361478295895312476983127654714685329652934187","clues":27,"grade":3,"steps":59},{"g":"390000720800600940000070080702080000950300000100950007270596000000000070080001200","sol":"396845721827613945415279386762184593958367412143952867274596138531428679689731254","clues":29,"grade":3,"steps":57},{"g":"007008019200009807000030060005000700360500000074306008000000070000804605090603001","sol":"457268319236419857981735264825941736369587142174326598648152973713894625592673481","clues":29,"grade":3,"steps":53},{"g":"090704080001030600060010530000607000012000000800000000100002098020000400300041065","sol":"593764182281539674764218539459687321612493857837125946146352798925876413378941265","clues":27,"grade":3,"steps":59},{"g":"042030157009140020100020400700000000600080034000000570000250790300009210900000043","sol":"842936157579148326163527489794315862651782934238694571416253798387469215925871643","clues":31,"grade":3,"steps":51},{"g":"500090012000004609902070800005027000020100000010080000800710560000008091000459000","sol":"543896712178234659962571834385927146726143985419685327894712563257368491631459278","clues":29,"grade":3,"steps":54},{"g":"000007509004001200000490060000240300450013020030000084060700090000830000090000002","sol":"126387549974561238385492761719248356458613927632975184561724893247839615893156472","clues":27,"grade":3,"steps":58},{"g":"009308500800260900030090000000020003908700200000006709280940670060005000005000840","sol":"429318567851267934637594128576129483948753216312486759283941675164875392795632841","clues":30,"grade":3,"steps":55},{"g":"097605002806700000020400060000070000004900007509060080000000806000016070000090023","sol":"397685412846721359125439768683172945214958637579364281751243896932816574468597123","clues":27,"grade":3,"steps":58},{"g":"087030090040005000200001007019507008000310500003089600050900000300000086802100900","sol":"187634295946725813235891467619547328428316579573289641754968132391452786862173954","clues":30,"grade":3,"steps":53},{"g":"010200000400000006509364000604031500080000001300000047000403900103570204000020070","sol":"816257439432198756579364812694731528287645391351982647728413965163579284945826173","clues":30,"grade":3,"steps":56},{"g":"508200060400030580000000007000006000036005000071000002000004075780050300600780020","sol":"518247963427639581369518247945126738236875194871493652192364875784952316653781429","clues":27,"grade":3,"steps":57},{"g":"200640090073100002690000000000810200020000060408000000009001400340700020000004015","sol":"215648793873159642694372851956817234127493568438526179569231487341785926782964315","clues":27,"grade":3,"steps":55},{"g":"009001000125800000000009801003000000000098052208030607050000006000780005400015900","sol":"689471523125863794374259861513627489746198352298534617857942136931786245462315978","clues":28,"grade":3,"steps":55},{"g":"030067000000009700000400005529000071074000008080000060090003800001800000000750042","sol":"832567194456129783917438625529386471674915238183274569295643817741892356368751942","clues":26,"grade":3,"steps":57},{"g":"400012560600000030007038000104306070000090040206540000502000000300000806000000020","sol":"483912567621475938957638412194386275875291643236547189542863791319724856768159324","clues":27,"grade":3,"steps":58},{"g":"500890060260007001070006403134008075600000040002004010700960000000475020005000000","sol":"543891267269347581871256493134628975687519342952734618728963154316475829495182736","clues":31,"grade":3,"steps":51},{"g":"000600000040300001020785003598134000000850000000000000950000078600010090000902005","sol":"839641257745329861126785943598134726264857319317296584952463178673518492481972635","clues":27,"grade":3,"steps":62},{"g":"060000700203007004487300020008000060390002007700084009612000308800006000030000010","sol":"169245783253867194487391625548973261396512847721684539612459378874136952935728416","clues":30,"grade":3,"steps":53},{"g":"041009000000528040500000007430000708706034000020005406800040570000001060910007020","sol":"241379685697528143583416297439162758756834912128795436862943571374251869915687324","clues":31,"grade":3,"steps":52},{"g":"090080000000060050008975000006000040300000006951004000609807503035210000070503200","sol":"593481627417362859268975431786129345342758196951634782629847513835216974174593268","clues":30,"grade":3,"steps":53},{"g":"009000700063090005070024000001008009030000000480370120000003004000500908090000500","sol":"149635782263897415578124693721468359936251847485379126857913264312546978694782531","clues":26,"grade":3,"steps":63},{"g":"020000600000004008809600001200390800090008000400002000000080960070030000050409073","sol":"724813659561924738839657421215396847697548312483172596342781965976235184158469273","clues":26,"grade":3,"steps":59},{"g":"000704500070090020000080490000005704053470009746900000930000000000050008800600235","sol":"392764581478591623561382497189235764253476819746918352935827146624153978817649235","clues":30,"grade":3,"steps":53},{"g":"028030000005109000900000000080015203000080600002000700800300070260800049007600082","sol":"128437965435169827976528431684715293791283654352946718849352176263871549517694382","clues":28,"grade":3,"steps":59},{"g":"004200900205600370800905000000500000057100098030000004500000200928060100000000000","sol":"364271985295684371871935426189546732457123698632798514543819267928467153716352849","clues":26,"grade":3,"steps":61},{"g":"600080700100600000307900001003060140000500980000000035800130670000290300000076000","sol":"645381729189627453327954861953862147712543986468719235894135672576298314231476598","clues":28,"grade":3,"steps":58},{"g":"410203000085006000070000200000400790030850000026307008040000052800705000060000070","sol":"419273685285196437673548219158462793734859126926317548347681952891725364562934871","clues":28,"grade":3,"steps":54},{"g":"008000060000000500370000008089000605030200407004350000000504000500762000002190000","sol":"458927361926813574371645928289471635135286497764359182897534216513762849642198753","clues":26,"grade":3,"steps":56},{"g":"000800600018002000000970000040080106069000240000240000306000000000103000800024309","sol":"495831627718462953632975481247589136569317248183246795326798514974153862851624379","clues":26,"grade":3,"steps":58},{"g":"301050000000214000090000020030020090002008007400701002000000000250040306680003000","sol":"321956478876214953594387621738625194912438567465791832143562789257849316689173245","clues":26,"grade":3,"steps":56},{"g":"000000250905010000084050031021060703000000400693004000509100000000500078000207100","sol":"716438259935612847284759631421965783857321496693874512579186324162543978348297165","clues":29,"grade":3,"steps":55},{"g":"004003000810090030600020780100900000300210059000000002200030476080600503000100000","sol":"724583691815796234639421785142958367376214859598367142251839476987642513463175928","clues":28,"grade":3,"steps":60},{"g":"460090200003004500700001006000000035010050974000000008900605000108900000602070009","sol":"461597283893264517725381496284719635316852974579436128937625841158943762642178359","clues":28,"grade":3,"steps":63},{"g":"400800500038000004000002039620003400000090000983000200006300000790401000010005000","sol":"479836512238159674165742839621573498547298163983614257856327941792461385314985726","clues":26,"grade":3,"steps":64},{"g":"060000830010089000004000016000590087000038109090040200081000340046000000050014008","sol":"967421835513689724824753916132596487475238169698147253781965342346872591259314678","clues":30,"grade":3,"steps":52},{"g":"610000400000006000007980100009230000006004000100000073080020530900543000050060009","sol":"618357492295416387347982165879231654536874921124695873481729536962543718753168249","clues":27,"grade":3,"steps":55},{"g":"006040105000000000030105680500000340200570000081000000070900263010000950000760010","sol":"896347125125698734734125689567819342243576891981234576478951263612483957359762418","clues":28,"grade":3,"steps":56},{"g":"760000000900080260020000009008060000072059006496820000000000302500003040010000057","sol":"765192438931784265824635719158367924372459186496821573647518392589273641213946857","clues":28,"grade":3,"steps":56},{"g":"050000460864000090000674000006200005090085006500100000075800000009300102003010900","sol":"357928461864531297912674583736249815291785346548163729175892634489356172623417958","clues":29,"grade":3,"steps":54},{"g":"030004072200307845708000009070000000000740300000002097060008010000030008082060000","sol":"531984672296317845748625139874193526925746381613852497369578214457231968182469753","clues":28,"grade":3,"steps":61},{"g":"070018050000090104000003700938000000200004030000002507003650012090000000040027000","sol":"479218653325796184816543729938175246257964831164832597783659412692481375541327968","clues":27,"grade":3,"steps":58},{"g":"800007501900600007005020389004006000100000002500000000000001000617080020000072005","sol":"842397561931658247765124389394216758176835492528749136259461873617583924483972615","clues":26,"grade":3,"steps":61},{"g":"000700020001020050096500800040160009000003060623007000008000012530010604000046500","sol":"354781926781629453296534871845162739179453268623897145468975312537218694912346587","clues":30,"grade":3,"steps":61},{"g":"000950037007040005400001000310627900000005600000000300000470000098012000270000090","sol":"182956437967243815453781269315627984849135672726894351631479528598312746274568193","clues":27,"grade":3,"steps":60},{"g":"000009030009480006020000704067050000390100080001000400070200000010068070000710803","sol":"745629138139487256628531794467852319392146587581973462873295641214368975956714823","clues":28,"grade":3,"steps":56},{"g":"000103000000070250045000000603002401810305906090006005908537002020000500000400800","sol":"289153674136974258745268319653792481817345926492816735968537142324681597571429863","clues":31,"grade":3,"steps":51},{"g":"002039000800000005609850032520600009000900200003502040000080700004090080900361000","sol":"752139468831426975649857132527648319486913257193572846365284791214795683978361524","clues":30,"grade":3,"steps":52},{"g":"860010003000007004000003890085000030900030006301000950042000000000100000530400002","sol":"869514723213987564457623891685291437974835216321746958142358679798162345536479182","clues":26,"grade":3,"steps":56},{"g":"903004060080100000527006001800500010000020040002060079070000000009280030000000090","sol":"913854762486172953527396481894537216765921348132468579371649825649285137258713694","clues":26,"grade":3,"steps":58},{"g":"910738000000000010060050020250060900040003800609000005300070080800040000500000006","sol":"912738654785624319463951728258167943147593862639482175396275481821346597574819236","clues":26,"grade":3,"steps":58},{"g":"075010000604005000000028000000300910000500004803000750060050800598240070030800000","sol":"275619438684735129319428567756384912921576384843192756162957843598243671437861295","clues":28,"grade":3,"steps":54},{"g":"004900000508000024002000380005000000380010050400080260900000001000035400003100006","sol":"634928715598371624172456389725693148386214957419587263947862531861735492253149876","clues":26,"grade":3,"steps":59},{"g":"000182960300600000000000085247069030010070620006000000000016090700000540020030870","sol":"475182963398657214162943785247569138513874629986321457854716392731298546629435871","clues":30,"grade":3,"steps":56},{"g":"500200000000900035200400080020304079900000040407060000009701600600000010085000000","sol":"598237461714986235263415987826354179931872546457169823349721658672598314185643792","clues":26,"grade":3,"steps":56},{"g":"003004000400035610600000409000007850800002370030006100004209080007008000981060200","sol":"193684725472935618658721439216397854849152376735846192364279581527418963981563247","clues":31,"grade":3,"steps":51},{"g":"000005810030600000004000000640001029300000000021083057002060003000109500700804000","sol":"296375814137648295584912736648751329375296481921483657812567943463129578759834162","clues":27,"grade":3,"steps":59},{"g":"206070805037050100800000042600020308010000000000003500020040000000060050105009070","sol":"296174835437258196851396742674925318513687429982413567729541683348762951165839274","clues":27,"grade":3,"steps":55},{"g":"000000209100020000300010004704050080000000406295048000000034020600501008030006007","sol":"458367219176429835329815764764153982813792456295648173587934621642571398931286547","clues":28,"grade":3,"steps":56},{"g":"043070005000000070000413002000030000510700000807005010090180000681950004075064000","sol":"943276185162598473758413962429831657516729348837645219394187526681952734275364891","clues":30,"grade":3,"steps":52},{"g":"000400872000038000010200090025300017000102000000080000070000006060050720900610500","sol":"653491872297538641418276395825369417736142958149785263574923186361854729982617534","clues":27,"grade":3,"steps":68},{"g":"000004000006827040003900080000000200350010090800200300000002510004000007070091004","sol":"287134659596827143413965782749583261352716498861249375938472516124658937675391824","clues":26,"grade":3,"steps":62},{"g":"086700100020010860000000045300000004000080600079460008000000306800000500030970010","sol":"586749123924513867713826945368291754452387691179465238297154386841632579635978412","clues":27,"grade":3,"steps":59},{"g":"052000090003080000100060380000000000004050021001300008025609804000007000908410000","sol":"852173496643982175179564382587291643364758921291346758725639814416827539938415267","clues":27,"grade":3,"steps":56},{"g":"900803500200007013004000026032006000000000050405000009001300005000061000040208030","sol":"916823574258647913374915826132596487697184352485732169861379245523461798749258631","clues":27,"grade":3,"steps":57},{"g":"308095000007000000090723004000307490709010000004009020100000046043000100200040500","sol":"368495217427168359591723864612387495759214638834659721175832946943576182286941573","clues":29,"grade":3,"steps":53},{"g":"001905300395800000000003080210607503000000006903050710000200000800000200026001040","sol":"681925374395874162472163985214687593758319426963452718139248657847596231526731849","clues":29,"grade":3,"steps":53},{"g":"005000002000210903609500018040090100000000086080000004050000040000403601004082000","sol":"315879462478216953629534718542698137931745286786321594253167849897453621164982375","clues":27,"grade":3,"steps":58},{"g":"030700000006240700004350000102000040705000200003000950610020000000003060000007021","sol":"531796482986241735274358196192875643765934218843612957618529374427183569359467821","clues":26,"grade":3,"steps":68},{"g":"030100700070509024200070083000200900504000000000064001006000800007008035002310009","sol":"435182796678539124219476583761253948524891367983764251356947812197628435842315679","clues":29,"grade":3,"steps":53},{"g":"008607030006031200300008046150000060000002000080513020230700400000000003000300680","sol":"528647139746931258391258746152879364973462815684513927235786491869124573417395682","clues":29,"grade":3,"steps":58},{"g":"300900185194080032800003490700000000980050017040020908000000500000000061009007200","sol":"326974185194685732875213496751398624982456317643721958468132579237549861519867243","clues":31,"grade":3,"steps":52},{"g":"400010000009004010085006900000000002500009030090300750012500400050043020000070006","sol":"473915268269784315185236947341857692527469831896321754612598473758643129934172586","clues":27,"grade":3,"steps":56},{"g":"000070100704500020013000060290005006346000050050002403000084200000023004409000000","sol":"562379148784561329913248567298435716346817952157692483631984275875123694429756831","clues":29,"grade":3,"steps":64},{"g":"030002070200040500006080900900500807008960104000070000001039200390020000002000030","sol":"435192678289647513176385942923514867758963124614278395541739286397826451862451739","clues":28,"grade":3,"steps":55},{"g":"008000700000305040130000000824000030010000050500000928900053070700004000000120009","sol":"458291763297365841136748592824579136619832457573416928981653274762984315345127689","clues":26,"grade":3,"steps":60},{"g":"081000095000180700900056020000700000007920003400003009000008240000000500060040900","sol":"681472395532189764974356821396715482817924653425863179159638247748291536263547918","clues":26,"grade":3,"steps":66},{"g":"031069000800000000070420090048230900700000500200080060080000450050900020000500600","sol":"431869275892357146675421893548236917763194582219785364387612459156943728924578631","clues":27,"grade":3,"steps":55},{"g":"700030560065009000130000024000900700900006052000005300309200040000050019200000070","sol":"792134568465829137138567924543912786971386452826745391319278645687453219254691873","clues":28,"grade":3,"steps":54},{"g":"610809024098000006000000079730008002100000000080072000000650203000003701004900000","sol":"617839524498725136253461879735148962142596387986372415871654293569283741324917658","clues":28,"grade":3,"steps":54},{"g":"007001003000320074003400105620540300700030000090002006000090607000705900800200050","sol":"487951263951326874263478195628547319714639528395812746532194687146785932879263451","clues":30,"grade":3,"steps":57},{"g":"031700006009013800400206000006000020008050007000020089000070300010000070060031005","sol":"231748956679513842485296713756389124928154637143627589594872361312965478867431295","clues":27,"grade":3,"steps":56},{"g":"000601040002500003013000500000090058008007000026000790200309070005200109090000030","sol":"579631842682574913413928567347192658958467321126853794261389475735246189894715236","clues":28,"grade":3,"steps":54},{"g":"900210400020050009070009526840900070000002000590007300069800000080020900000503760","sol":"956218437423756819178349526841935672637482195592167384369874251785621943214593768","clues":31,"grade":3,"steps":56},{"g":"095000200170500900000000503000200134000310025000006000000008360600000000001904008","sol":"895673241173542986426891573567289134948317625312456897754128369689735412231964758","clues":26,"grade":3,"steps":57},{"g":"400003001030070240000080700100000000005008000900621070046000059010300600000009020","sol":"467253891831976245592184736123597468675438912984621573746812359219345687358769124","clues":26,"grade":3,"steps":57},{"g":"000600100700000004002070600960527400000001000020060000200000040504010003010730080","sol":"398645172756192834142378659963527418475981326821463597237856941584219763619734285","clues":26,"grade":3,"steps":56},{"g":"800071090004000600000000081001000030603050014200309000070003062060000003000206050","sol":"826471395914835627357962481781624539693758214245319876478593162562187943139246758","clues":27,"grade":3,"steps":62},{"g":"900000006050000892600200000000046730000807000040301605020003000305000004000600350","sol":"982135476153764892674289513218546739536897241749321685821453967365978124497612358","clues":27,"grade":3,"steps":57},{"g":"000000001000800420080007090009000000210509070603700085160200040000000060000390100","sol":"427965831596831427381427596759683214218549673643712985165278349932154768874396152","clues":26,"grade":3,"steps":57},{"g":"037400500000000002005260090700026010000008000900310020801043000000100800369000000","sol":"237489561196735482485261793743526918612978345958314627871643259524197836369852174","clues":27,"grade":3,"steps":66},{"g":"080600401000100000500000000060531007010002000020006308106040073000000040004007509","sol":"782653491693124785541798236468531927317982654925476318156249873879365142234817569","clues":27,"grade":3,"steps":57},{"g":"100600035076400000504000006062800004000006080300709600891000500000000800000100070","sol":"189672435276435918534918726762851394945326187318749652891267543427593861653184279","clues":27,"grade":3,"steps":64},{"g":"005200000000100920000607035001709048000000000080040370137000004200000710009400000","sol":"615293487378154926492687135521739648743816592986542371137925864254368719869471253","clues":27,"grade":3,"steps":57},{"g":"070603005810004097000000100009000070000200000001048352400301006000460503000002000","sol":"974613285813524697652897134529136478348275961761948352495381726287469513136752849","clues":28,"grade":3,"steps":54},{"g":"603000000040020000000400620500700000400800091002005470060003009057200360090060000","sol":"623971845845326917719458623581794236476832591932615478268143759157289364394567182","clues":27,"grade":3,"steps":57},{"g":"000000410170030000080902037000089371050120060003000290067090080000006020008070000","sol":"932765418176438952485912637624589371759123864813647295567294183341856729298371546","clues":30,"grade":3,"steps":54}]},{"key":"hard","name":"困难","blurb":"数对与数组登场","targets":[4],"puzzles":[{"g":"000002040000506300000000278300000800008000501010027000130000006500013700804000000","sol":"793182645482576319651439278346951827278364591915827463137248956529613784864795132","clues":25,"grade":4,"steps":62},{"g":"640080100700000000000904000080560020000003006500008000800000001000210004021000069","sol":"643782195798651342215934678189567423472193586536428917864379251957216834321845769","clues":24,"grade":4,"steps":93},{"g":"000000460016040900080050032000506000001002090000100003025080100030700009600210007","sol":"573829461216347958984651732897536214361472895452198673725983146138764529649215387","clues":28,"grade":4,"steps":56},{"g":"003201000100008004000053012608040050500017400000560080004705360780000000000000005","sol":"453271698172698534896453712618342957539817426247569183924785361785136249361924875","clues":29,"grade":4,"steps":62},{"g":"057600000901000680000200000010000030600000095003000061328001000000409000040020010","sol":"257618349931745682864293157415976238682134795793852461328561974176489523549327816","clues":25,"grade":4,"steps":66},{"g":"090706203000000040050000607000000026600570008023000000000208070009140000410000030","sol":"194786253867325149352914687985431726641572398723869514536298471279143865418657932","clues":26,"grade":4,"steps":60},{"g":"400060010000001090090700000005200006030078001008500300000083240320000080500000000","sol":"453869712267341598891752634915234876632978451748516329179683245326495187584127963","clues":25,"grade":4,"steps":71},{"g":"800350006040000000062408091080500004130004605000000000020709000000001000006000409","sol":"891352746743196852562478391689517234137924685254863917425739168978641523316285479","clues":26,"grade":4,"steps":68},{"g":"000300100003000006007020000060000050004270360000000714000003905050400270800000000","sol":"528346197913587426647921538769134852184275369235869714472613985356498271891752643","clues":24,"grade":4,"steps":66},{"g":"090007004700004030005000000049070080070001020200800600000100062000008009000240000","sol":"396587214782914536415326798549672183678431925231859647857193462124768359963245871","clues":24,"grade":4,"steps":66},{"g":"500300020000000070020600800000200091806000200002007460600000140010030000205700600","sol":"548371926961482573327695814754268391896143257132957468673829145419536782285714639","clues":26,"grade":4,"steps":62},{"g":"700900608000007000020068000300700000089056700000401902000005080605800300000074560","sol":"754923618816547293923168475341792856289356741567481932492635187675819324138274569","clues":29,"grade":4,"steps":56},{"g":"400007036007000000600500708000206080904010020000030900180000060005000891000000000","sol":"459187236827643159613529748571296384934718625268435917182974563745362891396851472","clues":25,"grade":4,"steps":73},{"g":"009080000080040010410209000004700000100000058050802300908004002500000076200600000","sol":"329185467685347219417269583894753621132496758756812394968574132543921876271638945","clues":27,"grade":4,"steps":64},{"g":"000034000580000000000000590400009203200850007708200600000601000050002000010380060","sol":"129534876584967321673128594465719283231856947798243615342691758856472139917385462","clues":26,"grade":4,"steps":58},{"g":"006870091000092307000040500000908400095020070000000000540030600700000003300006020","sol":"436875291851692347927143586173958462695324178284761935548237619762419853319586724","clues":27,"grade":4,"steps":60},{"g":"900003020020001850000070000010560080000108090000702600700000900050927406090080200","sol":"946853127327641859185279364219564783674138592538792641762415938853927416491386275","clues":29,"grade":4,"steps":57},{"g":"097041300020003900038209070009007060300004000000020001006000009043090506000006040","sol":"597641328624783915138259674289517463371964852465328791816475239743192586952836147","clues":29,"grade":4,"steps":64},{"g":"000070905410000000000903000040000000082000709105040006050000200007620000000807600","sol":"263174985419285367578963421746398152382516749195742836651439278837621594924857613","clues":24,"grade":4,"steps":77},{"g":"804520000000003001905076000000400009041000805500700000060000000000917030003085700","sol":"814529367276843951935176482387451629641392875592768143769234518458917236123685794","clues":27,"grade":4,"steps":60},{"g":"040000600000700008001300005000012007270600000080030400000005106500000020700160090","sol":"347528619652791348891346275463812957279654831185937462934275186516489723728163594","clues":25,"grade":4,"steps":69},{"g":"301008504000007006000000170800400003000000050009002608040090000200100000050260300","sol":"371628594924517836685349172867451923432986751519732648143895267296173485758264319","clues":25,"grade":4,"steps":60},{"g":"381600900000000005000009870500000000070000504903040010000000050008010000490208100","sol":"381657942749182635652439871514726389876391524923845716137964258268513497495278163","clues":25,"grade":4,"steps":66},{"g":"080000206509000010004000000001060080600020070930400000000100020000000704000805190","sol":"183759246569234817274618935751963482648521379932487651397146528815392764426875193","clues":24,"grade":4,"steps":76},{"g":"700002000046000750290000000067050000000000604310260509080900200000105003670020900","sol":"738512496146389752295647381967453128852791634314268579581936247429175863673824915","clues":29,"grade":4,"steps":66},{"g":"500000203000500700000007060000000000630109000410200300000001430342000080100008009","sol":"571864293863592714294317568728643951635179842419285376986721435342956187157438629","clues":25,"grade":4,"steps":74},{"g":"000004005000000000029706400008000030000470020370010000800090000005000680062000041","sol":"613984275487125369529736418248569137951473826376812594834691752195247683762358941","clues":24,"grade":4,"steps":64},{"g":"000008006000024903060900000090000000000100008018507000009005007030000180700009604","sol":"923758416851624973467931825395286741274193568618547392149865237536472189782319654","clues":25,"grade":4,"steps":67},{"g":"000001000900000364004830500070080290500000600080507000300004000000090000050010002","sol":"635941728918752364724836519176483295543129687289567143391274856862395471457618932","clues":24,"grade":4,"steps":94},{"g":"000083002000000000000076190030000000060010084005000010000908020002000003940035600","sol":"596183742417592836328476195134859267269317584875624319753968421682741953941235678","clues":24,"grade":4,"steps":67},{"g":"075000409000080050040000003012090500700002000003701600200000140050004000100000030","sol":"875213469326489751941675283412396578769852314583741692237968145658134927194527836","clues":25,"grade":4,"steps":76},{"g":"000430060200700003004080000040000500800000030035600100000800025960000301000060080","sol":"157432869286759413394186752642913578819547236735628194473891625968275341521364987","clues":25,"grade":4,"steps":75},{"g":"300040802094300015000005030400000000085000000206003000000908150000027040000500028","sol":"357641892894372615621895437473289561985416273216753984742938156568127349139564728","clues":27,"grade":4,"steps":70},{"g":"000000120020003070700006005906408000000000086000067410040800560000049000815000000","sol":"653794128428153679791286345936418257174325986582967413349871562267549831815632794","clues":27,"grade":4,"steps":58},{"g":"009004100010300200000060009400609000085000000000508010740005000903000702000000038","sol":"279854163816397245354162879432619587185743926697528314748235691963481752521976438","clues":25,"grade":4,"steps":57},{"g":"905100000200090030801600007056009203080000500000005040500000000070000806008200350","sol":"935127684267498135841653927756849213384712569129365748513986472472531896698274351","clues":27,"grade":4,"steps":90},{"g":"052700000007008906000000007000300100000010080510060003000000012346002070080005360","sol":"952746831137528946864931257628357194473219685519864723795683412346192578281475369","clues":27,"grade":4,"steps":59},{"g":"080350010000084900200170000009017480000400000008000075600000020007000603190000000","sol":"986352714713684952245179368329517486571468239468923175634795821857241693192836547","clues":26,"grade":4,"steps":65},{"g":"402500006009000800605080903300010008000400050000930060201000000500209000090040002","sol":"482593716739126845615784923327615498968472351154938267241857639573269184896341572","clues":27,"grade":4,"steps":72},{"g":"300200976200000000019005004500001300000030000020690005074000830000000400001000002","sol":"385214976246879513719365284597421368468537129123698745674952831932186457851743692","clues":25,"grade":4,"steps":65},{"g":"000000500700400010430009200000245700000000000005801006010080030906302000000010020","sol":"629138574758426913431579268863245791194763852275891346512687439946352187387914625","clues":25,"grade":4,"steps":68},{"g":"001050097000000800090603001470000030005002000000800500500000400069000020010900086","sol":"341258697652719843897643251478561932135492768926837514583126479769384125214975386","clues":25,"grade":4,"steps":60},{"g":"200405000007809000080002009040200063060004710030000000875000400000000170300000006","sol":"296415387457839621183672549541297863962384715738156294875961432629543178314728956","clues":26,"grade":4,"steps":71},{"g":"074080002200000050018700060000000600040600501106903000087500104000000000000090800","sol":"674385912293461758518729463732158649849672531156943287987536124425817396361294875","clues":26,"grade":4,"steps":59},{"g":"200003005690000004000000180080100203000030507300295008970002001100009020000000039","sol":"248713965691528374735964182586147293429836517317295648973682451154379826862451739","clues":29,"grade":4,"steps":59},{"g":"500096004000500000600014500020000300005000908000927000037080090109000007000000005","sol":"573896214841532769692714583924658371765341928318927456437185692159263847286479135","clues":25,"grade":4,"steps":72},{"g":"300850040000002600700010080070600300500900000002003070000004200010070005200000004","sol":"391856742845732691726419583479621358583947126162583479958364217614278935237195864","clues":24,"grade":4,"steps":67},{"g":"500070042300900508008002000090060050007000004200030000001000020000050090004600007","sol":"569378142342916578178542936493867251617295384285134769731489625826751493954623817","clues":24,"grade":4,"steps":61},{"g":"040000000000800620027000094900040018300078000004090000070000802090200003000706000","sol":"641927385539814627827563194965342718312678459784195236173459862496281573258736941","clues":25,"grade":4,"steps":59},{"g":"000006058043005000002010600000500000004800002710009405300060107090003000400102000","sol":"971246358643985721852317649239574816564831972718629435325468197196753284487192563","clues":27,"grade":4,"steps":59},{"g":"800050000000000008420001000010304000000007365700020000085703400000005600001200090","sol":"867452139153679248429831756516394872294187365738526914985763421342915687671248593","clues":25,"grade":4,"steps":90},{"g":"000900000002805000300020087000010000507600003100503406000000210960000005010350000","sol":"851937624472865931396124587643719852587642193129583476735496218968271345214358769","clues":26,"grade":4,"steps":66},{"g":"500001000000000040479050601920000700060020004000603800005070080300000400006200010","sol":"532461978681397245479852631924185763863729154157643892215974386398516427746238519","clues":26,"grade":4,"steps":71},{"g":"200108000800600000000007003005800000060900030190050040020003090780520000000700062","sol":"237198456814635279956247183375864921462971538198352647621483795789526314543719862","clues":26,"grade":4,"steps":61},{"g":"700009080050026000920840070089000007003000210000080064000500803800000000094000100","sol":"736159482458726391921843675689412537543967218172385964267591843815634729394278156","clues":27,"grade":4,"steps":65},{"g":"000020000800056400000340280063700001080504000000001008015000920030000005040000700","sol":"374928156892156437651347289463782591189534672527691348715863924236479815948215763","clues":26,"grade":4,"steps":62},{"g":"000002000053900010007601503681009000009100620500006009000000000306700900010000067","sol":"168532794453987216297641583681329475739154628524876139975263841346718952812495367","clues":28,"grade":4,"steps":59},{"g":"000080000580090200900000504003002140059700300800900050600000071005001000030600000","sol":"342185697586497213971326584763852149259714368814963752628539471495271836137648925","clues":26,"grade":4,"steps":61},{"g":"003000000080070040000912000540020017090500008310000004020098500030006070006100000","sol":"273485169981673245465912783548329617697541328312867954124798536839256471756134892","clues":27,"grade":4,"steps":79},{"g":"000700001003008000100090240800004000300080169000060004000001006020907000005000090","sol":"562743981943218657187695243896174532374582169251369874439851726628937415715426398","clues":24,"grade":4,"steps":67},{"g":"008105000500060020000000000006020950000600010000000008060090380700340260100206090","sol":"928135746531764829647982135416827953879653412352419678264591387795348261183276594","clues":26,"grade":4,"steps":75},{"g":"000385060083200500000001007005103000700009000021000000430602000007000040509700006","sol":"174385269983276514652941387895163472746829135321457698438692751267518943519734826","clues":27,"grade":4,"steps":60},{"g":"000730900050000720009052000008000040020080003060401000802000109006900000000060007","sol":"281736954653194728749852316598673241124589673367421895872345169436917582915268437","clues":25,"grade":4,"steps":76},{"g":"000000600000200030790600100310900004200080300000007008507800090040001000031004007","sol":"425173689186249735793658142318926574279485316654317928567832491942761853831594267","clues":26,"grade":4,"steps":68},{"g":"700400000009000006010095800000000010051007003407008050040000005000006000000780109","sol":"785462391329871546614395827296543718851927463437618952148239675973156284562784139","clues":24,"grade":4,"steps":67},{"g":"107000003000060090090020150000100009500004000008072005600000904301040002840005300","sol":"157498263283561497496723158734156829562984731918372645625837914371649582849215376","clues":28,"grade":4,"steps":56},{"g":"200000300004080060700200045006500020021007098000900007000000400800003000017060000","sol":"268754319154389762793216845976538124321647598485921637632895471849173256517462983","clues":25,"grade":4,"steps":65},{"g":"607008001013900200048010000700040900080000000000800060000490070460300050100000020","sol":"697258341513964287248713695726145938984637512351829764835492176462371859179586423","clues":26,"grade":4,"steps":62},{"g":"009000000080203001002750000100500802030000009000000130006020508250800006003000024","sol":"369481257785263491412759683197536842538142769624978135946327518251894376873615924","clues":27,"grade":4,"steps":59},{"g":"001800000003400000000009613000070958000000076070060030100000007406357000090004000","sol":"961835724723416589548729613614273958352948176879561432135692847486357291297184365","clues":26,"grade":4,"steps":70},{"g":"010700000030000015000240000800006030240000100570000008100060070024370501007104090","sol":"618735249432689715759241683891526437243897156576413928185962374924378561367154892","clues":29,"grade":4,"steps":70},{"g":"800069100900001000070450060490000000001006700300100000080700302704200008000000470","sol":"845369127926871534173452869497583216251946783368127945689714352714235698532698471","clues":27,"grade":4,"steps":59},{"g":"012050000007000060600004509000003004004129006000060000500000000000008910020005703","sol":"912856437457932168638714529196583274374129856285467391549371682763248915821695743","clues":25,"grade":4,"steps":66},{"g":"050040800000008000000000403960300070500100000000400961003500000074800005000010086","sol":"356947812419238657728651493961382574547169238832475961183526749674893125295714386","clues":25,"grade":4,"steps":72},{"g":"000050000000403000305016000578000000600309008000000016020730500003000200900200004","sol":"796852341182473695345916872578641923614329758239587416821734569463195287957268134","clues":25,"grade":4,"steps":83},{"g":"000048025790000000800000000009034160008000000650000004060050000000020043000709200","sol":"136948725795362481824175639279534168348691572651287394962453817517826943483719256","clues":24,"grade":4,"steps":73},{"g":"005600820000005000006190004600040008002500070030709001000004000200001905109000040","sol":"415637829798425136326198754671243598982516473534789261853974612247361985169852347","clues":27,"grade":4,"steps":56},{"g":"010000093070009005000780410782040030000003204004008000600300000507000160120007000","sol":"815462793476139825293785416782946531961573284354218679648321957537894162129657348","clues":29,"grade":4,"steps":55},{"g":"800040601900720000050000490601070040000000000079600500003000806000000000005310000","sol":"837945621946721385152863497681572943524139768379684512213497856798256134465318279","clues":24,"grade":4,"steps":64},{"g":"601009005500700000027000006070005060058200010103000900800500004000870000000002001","sol":"681329745594768123327154896472915368958236417163487952816593274245871639739642581","clues":26,"grade":4,"steps":62},{"g":"490100056000480007020000000000003000500000400000670000050000200240015003106200740","sol":"497132856365489127821567394614853972573921468982674531758346219249715683136298745","clues":26,"grade":4,"steps":76},{"g":"019700000000900057030000000004008071070060004000000305080040729002850000400020000","sol":"519784632846932157237516948654398271371265894928471365185643729762859413493127586","clues":26,"grade":4,"steps":77},{"g":"000703040600900000080065000740000600000006200006800070060009020507040000890500000","sol":"925713846674928315381465792748291653159376284236854179463189527517642938892537461","clues":25,"grade":4,"steps":58},{"g":"900000602104000000080705004500400010000300207296000400040067009000030000000000800","sol":"957143682134682795682795134573426918418359267296871453841567329769238541325914876","clues":25,"grade":4,"steps":73},{"g":"000000003000540600659000008008000700000005032000010080930008000010450070004107000","sol":"741986253283541697659723418128394765496875132375612984937268541812459376564137829","clues":25,"grade":4,"steps":73},{"g":"600400009090070000100000650013004005060000080904002000000200090300000004000358000","sol":"638415279592876341147923658213784965765139482984562137876241593351697824429358716","clues":24,"grade":4,"steps":78},{"g":"207000600085003002030000090090010053500040000064905100003000017000400086600500020","sol":"247859631985163742136274895892716453571348269364925178453682917729431586618597324","clues":29,"grade":4,"steps":55},{"g":"000801009100090200090040800000000003002008040600702100003000002000030000080504031","sol":"425871369178693254396245817817469523952318746634752198543186972261937485789524631","clues":25,"grade":4,"steps":64},{"g":"004050009000309000806274000900007006007908000050000070070003060010040005040000290","sol":"734156829125389647896274351981527436467938512253461978572893164319642785648715293","clues":27,"grade":4,"steps":62},{"g":"043000005001009000080007000000805009008100000000030820070081092562000004000020706","sol":"943218675751369248286457913127845369638192457495736821374681592562973184819524736","clues":27,"grade":4,"steps":61},{"g":"004010005000802100905000200509060400870004031003000000038006000400900000000030000","sol":"284319765367852149915647283529163478876294531143785692738526914451978326692431857","clues":25,"grade":4,"steps":77},{"g":"005980000300001500901002030000690040090000000000000800056000102800000004200076980","sol":"725983416384761529961542738537698241198324657642157893456839172879215364213476985","clues":26,"grade":4,"steps":63},{"g":"030010200060204000800000500070001040000009000453800000540000008001300007000486000","sol":"735918264169254783824673519976531842218749356453862971542197638681325497397486125","clues":25,"grade":4,"steps":62},{"g":"070002034100000000005000208509020760060900400810030000000000020000701090690200800","sol":"978512634126384579435697218549128763362975481817436952753849126284761395691253847","clues":27,"grade":4,"steps":68},{"g":"005000810030500294020008000060000000501040002300007000200600030000300100600005709","sol":"495732816837516294126498573962851347571943682384267951218679435759324168643185729","clues":26,"grade":4,"steps":71},{"g":"006100802007060050000809000001000200095000007200000000050038070000004000004570083","sol":"936157842487362159512849736741983265895426317263715498159238674378694521624571983","clues":25,"grade":4,"steps":69},{"g":"001070000200009003085200007307001060090040000004063870000700050040002000003000020","sol":"431675298276189543985234617357821469698547132124963875812796354549312786763458921","clues":26,"grade":4,"steps":68},{"g":"008025010010007500607000004000000670064000300720010400081040200500802003000900000","sol":"398425716412697538657138924839254671164789352725316489981543267546872193273961845","clues":28,"grade":4,"steps":59},{"g":"170000206800000005000090070524000008000500160000000020000706000650009001007040000","sol":"173458296896372415245691873524167938938524167761983524489716352652839741317245689","clues":24,"grade":4,"steps":86},{"g":"000006549000213000007009000009000010500000078030600004810000000900040086000000402","sol":"321786549495213867687459231279834615546921378138675924814562793952347186763198452","clues":25,"grade":4,"steps":59}]},{"key":"expert","name":"挑战","blurb":"XY-Wing / 唯一矩形","targets":[6],"puzzles":[{"g":"749000080000050030010068000400080000000100000000090071030000007005670820060000050","sol":"749312586628754139513968742471286395952137468386495271834529617195673824267841953","clues":24,"grade":6,"steps":68},{"g":"000603000040100000602050000310000070906270000000000006000010064003080500800709000","sol":"791643258548127639632958741315896472986274315427531986279315864163482597854769123","clues":24,"grade":6,"steps":65},{"g":"067000900100000040050310007000540720042100000800900000480600000000008000000701600","sol":"367854912198276543254319867619543728542187396873962451481635279726498135935721684","clues":25,"grade":6,"steps":63},{"g":"000048350001030002090500000000000003000060000300200940506002000040007009700050080","sol":"627948351851736492493521678215479863974863125368215947586392714142687539739154286","clues":24,"grade":6,"steps":66},{"g":"004380000080050010300000200000000690500009004800000000001070000402610005950000000","sol":"124387569789256413365194287247531698513869724896742351631975842472618935958423176","clues":23,"grade":6,"steps":61},{"g":"107090000500000001060000009000300086010009054700005030080007300000600090050900040","sol":"127594863539786421864132579245371986613829754798465132986247315471653298352918647","clues":25,"grade":6,"steps":74},{"g":"006703100000062003000090000480030052090000681050010000000200000870041000000005700","sol":"946753128718462593523198467481637952397524681652819374139276845875941236264385719","clues":26,"grade":6,"steps":59},{"g":"070890300000001008010400020000900200040050000601000070000040750000506039700030060","sol":"276895341453721698918463527537914286842657913691382475369148752124576839785239164","clues":26,"grade":6,"steps":73},{"g":"000020000051000706000608000000500009407200500000009140008100900240900600500000080","sol":"634721895851394726972658413186547239497213568325869147768132954243985671519476382","clues":25,"grade":6,"steps":69},{"g":"040000978800020030051000400005000000000940000210003080000001000000079340020600100","sol":"642315978897426531351897426485162793736948215219753684574231869168579342923684157","clues":25,"grade":6,"steps":62},{"g":"070604010000089002002010368001068703080100095000400000700006000100000000309000080","sol":"873624519516389472492517368951268743284173695637495821728936154165842937349751286","clues":28,"grade":6,"steps":68},{"g":"700000080008205609009007000000000006090000530030006000007090104001850000650100800","sol":"724961385318245679569387241872539416196428537435716928287693154941852763653174892","clues":26,"grade":6,"steps":67},{"g":"005003201000070608200100070700000000000085002018006000050000300004600000106500009","sol":"875463291431972658269158473742319586693785142518246937957821364324697815186534729","clues":25,"grade":6,"steps":63},{"g":"805100000034000060210007000000000000000034086000080127080009203000003000000851700","sol":"895146372734528961216397845578612439921734586643985127187469253459273618362851794","clues":26,"grade":6,"steps":56},{"g":"000207000002604100000008004008090600000760000000000743050000209103000007907005000","sol":"481257396592634178736918524278493615345761982619582743854176239163829457927345861","clues":25,"grade":6,"steps":64},{"g":"900040008630920000000010006080000400300001060401000890090700205120000000503000009","sol":"912546378638927154754318926285679431379481562461253897896734215127895643543162789","clues":27,"grade":6,"steps":57},{"g":"600008002000020000420509000000000140008304090300000000001600420050031700080070501","sol":"613748952895123674427569318572896143168354297349217865731685429254931786986472531","clues":27,"grade":6,"steps":59},{"g":"000071020010008006002900000067000840800500070004000000100402000050100030700003009","sol":"948671325315248796672935184567319842891524673234786951183492567459167238726853419","clues":25,"grade":6,"steps":66},{"g":"008090340002007000609000800000952600500300200000000007430000005201480000060003000","sol":"758296341312847596649531872174952638586374219923168457437629185291485763865713924","clues":26,"grade":6,"steps":61},{"g":"201800000800907060040000000025000390000105000000008056000001004090400000600020000","sol":"261854739853917462947362581125746398386195247479238156538671924792483615614529873","clues":23,"grade":6,"steps":72},{"g":"460320000000400000308000090802010005003000470006000000000062150100003007000140000","sol":"467329581291485763358671294842716935513298476976534812734962158129853647685147329","clues":25,"grade":6,"steps":88},{"g":"070030000000179305000600090003006000405007000890304010030400706080000900009000000","sol":"976532148248179365351648297123986574465217839897354612532491786684723951719865423","clues":26,"grade":6,"steps":67},{"g":"800010500000683000000520107041000020007000000006051040000000000030000276000039010","sol":"824917563715683492963524187541378629287496351396251748478162935139845276652739814","clues":25,"grade":6,"steps":66},{"g":"400050000900200100050007402000508000000020000000001090089060210500090703107080060","sol":"421853976973246158658917432794538621815629347236471895389765214562194783147382569","clues":27,"grade":6,"steps":58},{"g":"010700000060000200000580610040000000000902030605013709000000900850000403304000002","sol":"519726348768134295432589617943875126187962534625413789276348951851297463394651872","clues":26,"grade":6,"steps":65},{"g":"040007008208040006000000400000800000304700850507060001006500003003080000905400002","sol":"649257318258341976731698425192835764364712859587964231876529143423186597915473682","clues":27,"grade":6,"steps":57},{"g":"000700005000390002840000000020040000070000050538910000000800510002039040001000300","sol":"293764185615398472847521693129645738476283951538917264364872519752139846981456327","clues":25,"grade":6,"steps":72},{"g":"002000070065080000390000000000400005000100300000002041080500600070690008900840012","sol":"842315976765984123391276584617438295428159367539762841184527639273691458956843712","clues":26,"grade":6,"steps":64},{"g":"900500040020401500010020003060090020000000000000070001000006004270003008100800000","sol":"937568142628431579415729863861395427749182356352674981583216794274953618196847235","clues":23,"grade":6,"steps":74},{"g":"000000000061050740200800000070680005000000300008035901802000000690010504050007000","sol":"789146253361952748245873619973681425516429387428735961832594176697218534154367892","clues":26,"grade":6,"steps":57},{"g":"000400000400030760005029000050206009000090000300150007040000072006010594000004800","sol":"613487925492531768875629413157246389284793651369158247948365172736812594521974836","clues":27,"grade":6,"steps":76},{"g":"670000080000680070800902005000500003087000000001090000506004000000009804030000000","sol":"679145382125683479843972615264518793987236541351497268596824137712369854438751926","clues":23,"grade":6,"steps":71},{"g":"000006000000100805420500000000307000700020900086004730107000080002000057090005302","sol":"519836274673142895428579613941387526735621948286954731157263489362498157894715362","clues":27,"grade":6,"steps":57},{"g":"074000008800010560090000070020700900009130740000049100003005000000080000060000200","sol":"174596328832417569596823471421758936689132745357649182243965817715284693968371254","clues":25,"grade":6,"steps":72},{"g":"040010500000070000009540170100400000092006000008300906030827041000000003004000800","sol":"743218569521679384689543172156492738392786415478351926935827641817964253264135897","clues":27,"grade":6,"steps":60},{"g":"090200081300000400000009000000005607069000050010300000021058000050600000700103009","sol":"695234781372861495148579236834925617269417853517386942921758364453692178786143529","clues":25,"grade":6,"steps":68},{"g":"300002000060000075000476903000009302900005700080640009000050410600020008005000000","sol":"397582641462193875158476923574819362916235784283647159729358416631724598845961237","clues":27,"grade":6,"steps":59},{"g":"400001000000000900021000740009020080067003000030000500010200000500400800000890260","sol":"486971325375642918921358746159724683267583194834169572618237459592416837743895261","clues":24,"grade":6,"steps":64},{"g":"000020400080049051600000000000000000970301506405072008000260000010038600800005000","sol":"751823469283649751649517283138456927972381546465972138397264815514738692826195374","clues":27,"grade":6,"steps":71},{"g":"000000600620000090840000700460100070030090018000000530073208000500000000094076100","sol":"359827641627541893841963752468135279735692418912784536173258964586419327294376185","clues":27,"grade":6,"steps":58},{"g":"008600000009000000400900068000098340743060180000004000800700001600050000000002005","sol":"158647932269583714437921568526198347743265189981374256895736421612459873374812695","clues":25,"grade":6,"steps":60},{"g":"507060800000000002000050070000300001028900007014070050003001005006000310000008400","sol":"537162894641789532289453176765324981328915647914876253893641725456297318172538469","clues":25,"grade":6,"steps":62},{"g":"000850000607000008001700006000000900020003070090012603052009400000008002000000360","sol":"239856714647921538581734296163487925425693871798512643352169487976348152814275369","clues":25,"grade":6,"steps":59},{"g":"900000140053000009000400003508004070000008500000670000200700300600210000007003010","sol":"982357146453861729716492853568934271379128564124675938241786395635219487897543612","clues":25,"grade":6,"steps":59},{"g":"000070009100002040070080012064007500007805100000000906090000005020006400800010090","sol":"342671859189532647675489312264197538937865124518243976491328765723956481856714293","clues":27,"grade":6,"steps":57},{"g":"008000600005000089600902000050670000000004050032501000700060000010200045000000010","sol":"298453671345716289671982534459678123167324958832591467784165392916237845523849716","clues":24,"grade":6,"steps":68},{"g":"000508710800306000040000000301800065090102007007000000000065001000400003080000290","sol":"263548719879316542145927386321874965698152437457693128934265871712489653586731294","clues":26,"grade":6,"steps":56},{"g":"000075000180000094000000072020060000600950400001000900000010607000046200008002050","sol":"294175836187623594356489172529864713673951428841237965932518647715346289468792351","clues":25,"grade":6,"steps":63},{"g":"000000064076340020000080100090000600000050000002610075040000000200071050060802000","sol":"823197564176345829954286137598724613617953248432618975341569782289471356765832491","clues":25,"grade":6,"steps":70},{"g":"200100000000000380003006270000072400100304700000010000901007000000000806040098020","sol":"278153964614729385593846271835672419169384752427915638981267543752431896346598127","clues":25,"grade":6,"steps":61},{"g":"004010800020704000000000030000090001030062070095000000080400020000006017000021900","sol":"374619852528734196916258734862597341431862579795143268189475623253986417647321985","clues":24,"grade":6,"steps":65},{"g":"000270000050060100900840203720600080580020000009000500000400802008000960000007300","sol":"813275694254369178967841253721653489586924731439718526375496812148532967692187345","clues":27,"grade":6,"steps":78},{"g":"090300061000000080000190002400003007018000400000014600600007038000002100075000000","sol":"594328761132476985786195342469253817218769453357814629621947538943582176875631294","clues":25,"grade":6,"steps":84},{"g":"600270000800300790000080506010000030940150080000000000032090400000000070106800000","sol":"691275843854316792327489516218647935943152687765938124532791468489563271176824359","clues":25,"grade":6,"steps":61},{"g":"005600208807100000060082400000000900000000005409500760000004010000306000600051009","sol":"145693278827145693963782451356217984782469135419538762238974516591326847674851329","clues":26,"grade":6,"steps":65},{"g":"010036500700000000046900008400002900000090000003108700900060100000370000000400002","sol":"219836547738514296546927318487652931125793864693148725974265183862371459351489672","clues":24,"grade":6,"steps":60},{"g":"010905006900040050000760000020008104080300200050009000038000000097001030000000800","sol":"312985476976142358845763921623578194789314265154629783238496517497851632561237849","clues":25,"grade":6,"steps":57},{"g":"000407005000001000028000000200040000040508700900600010410050023000080000050004001","sol":"139427685564891237728365149281749356346518792975632418417956823692183574853274961","clues":24,"grade":6,"steps":66},{"g":"230000060004000000060020500000001300008000020100204007500390201000000008903010006","sol":"235178469794653812861429573426781395378965124159234687587396241612547938943812756","clues":25,"grade":6,"steps":77},{"g":"900002060053040010020000057004105000000039004002000105700003080001780900000006000","sol":"917352468653847219428691357894175632165239874372468195746923581531784926289516743","clues":27,"grade":6,"steps":60},{"g":"000002000004000950710800600007000040500340060100000003300000200020009000000060130","sol":"956472318284613957713895624637981542592347861148526793361754289825139476479268135","clues":23,"grade":6,"steps":66},{"g":"300000008400290000210408300090000000006040005000001400030500002700009063000060000","sol":"359716248468293751217458396194835627876942135523671489631584972745129863982367514","clues":24,"grade":6,"steps":63},{"g":"709300000000050470000000005000006300008009100600180000090005013200000000800920506","sol":"759348621382651479146792835914576382578239164623184957497865213265413798831927546","clues":25,"grade":6,"steps":59},{"g":"009000500100080000068004000640512030000030000000000040000000300000603125006057900","sol":"429376518173985462568124793647512839291438657835769241952841376784693125316257984","clues":25,"grade":6,"steps":73},{"g":"000500300000600100604000000030020608045007090900000000300100000000750000009003087","sol":"298571346573684129614932875731429658845367291926815734357198462482756913169243587","clues":23,"grade":6,"steps":59},{"g":"092000007600040500005000016500009402000685000000001300900000000023100000000700038","sol":"392516847618947523745832916561379482234685791879421365987263154423158679156794238","clues":25,"grade":6,"steps":64},{"g":"000000800000400006700095000320040000070000501008000640000000000052001000800057063","sol":"564732819293418756781695324325146978476829531918573642137964285652381497849257163","clues":23,"grade":6,"steps":93},{"g":"009574020056000000000000030000100000500020091000087000063091000900700200048302900","sol":"139574628856239174472816539697145382584623791321987465263491857915768243748352916","clues":27,"grade":6,"steps":61},{"g":"000000500060700000000104902010006209605010300040030050100980000004300120030600000","sol":"491823567862795413573164982318576249625419378749238651156982734984357126237641895","clues":27,"grade":6,"steps":60},{"g":"005002100240000360100000097000000010500701008004580009900006000000300800000005002","sol":"795632184248917365163458297879264513532791648614583729957826431421379856386145972","clues":25,"grade":6,"steps":59},{"g":"000020008702006000300000605060100080000000000500002090070049060000001504200003001","sol":"659324718712856349384917625467195283921738456538462197173549862896271534245683971","clues":24,"grade":6,"steps":69},{"g":"500006900090007401008090050080000060107002000300600000900080010010025043000000205","sol":"531246978692857431478193652284519367167432589359678124925384716716925843843761295","clues":27,"grade":6,"steps":66},{"g":"030410005052300090400000003064001000000200070007069000029608000000000060300000009","sol":"938416725652387491471925683264731958893254176517869342129648537785193264346572819","clues":25,"grade":6,"steps":59},{"g":"010800000070003001008000000000350204000408030000060070100600900000005760036090050","sol":"513826497672943581498571326869357214725418639341269875157682943984135762236794158","clues":25,"grade":6,"steps":78},{"g":"290000408800946000034000090000000607000750800043800900680000030005009000000010700","sol":"296135478857946312134287596518493627962751843743862951681574239375629184429318765","clues":27,"grade":6,"steps":77},{"g":"000007000050000678003005020004100306802000400000000050007020004301000000020040000","sol":"218967543459213678763485921574192386832756419196834752687529134341678295925341867","clues":23,"grade":6,"steps":75},{"g":"009034000000018005601000040290000800000000100100000024060005000000090308007201400","sol":"759634281324718695681952743295143867846527139173869524468375912512496378937281456","clues":25,"grade":6,"steps":78},{"g":"000000070006000200070126400000002608060080000400000750003801000009004080000590020","sol":"321945876946738215875126439197352648562487391438619752253871964719264583684593127","clues":25,"grade":6,"steps":58},{"g":"800000000049070200000800390000090817080004005070510040734050000000900000006080400","sol":"852439761349671258617825394465392817281764935973518642734256189128943576596187423","clues":27,"grade":6,"steps":68},{"g":"002060000800017200690002001041800009000320050000000000020000406000000938000730000","sol":"152463897834917265697582341341875629968321754275649183523198476716254938489736512","clues":25,"grade":6,"steps":63},{"g":"310040900082000000000010800090003208107500000000002000060490000004000070000007001","sol":"316248957482759163579316824695173248127584639843962715761495382934821576258637491","clues":23,"grade":6,"steps":61},{"g":"009160304200000000000008100000080000080210056420007000000650980004000600030000000","sol":"879165324261349578345728169153486792987213456426597831712654983594832617638971245","clues":24,"grade":6,"steps":80},{"g":"608000020051700006090003000000000000805000061706004002000050000000306900200040000","sol":"678415329351792846492683157924561783835279461716834592163958274547326918289147635","clues":23,"grade":6,"steps":75},{"g":"000642000000100020000030009250080000604000080080500074900401607700090002000008003","sol":"195642738873159426426837519257984361614273985389516274938421657761395842542768193","clues":27,"grade":6,"steps":55},{"g":"050407000000060084000020700000030401091802005004000060540001002023000000010000900","sol":"358417629172369584469528713285736491691842375734195268546971832923684157817253946","clues":26,"grade":6,"steps":56},{"g":"100000502907400000000000000000080620806000301000150004070004108000000090003019060","sol":"148697532927435816365821749491783625856942371732156984279364158614578293583219467","clues":25,"grade":6,"steps":64},{"g":"000000500000809700170000000003010020000038009690050013000000942580000000019400000","sol":"928671534435829761176543298853916427741238659692754813367185942584392176219467385","clues":25,"grade":6,"steps":69},{"g":"000008010060305000007100020300050900010000080702601004600200009009000000800000350","sol":"234978615168325497597146823346852971915734286782691534653287149429513768871469352","clues":25,"grade":6,"steps":59},{"g":"000042150401000007625000000360000000004050610000900003000000091007004000902070005","sol":"793842156481635927625719834369421578274358619158967243546283791817594362932176485","clues":26,"grade":6,"steps":65},{"g":"000070008503000060000086090002000003005308000000001972100800700059000810000040200","sol":"946573128583912467271486395612794583795328641438651972124839756359267814867145239","clues":26,"grade":6,"steps":56},{"g":"700000000806000900000001306007000004000057100090408005000640000400800019500000802","sol":"731962458826534971945781326157396284684257193392418765218649537473825619569173842","clues":25,"grade":6,"steps":68},{"g":"000709000200004000008030004409005600600300050020006740003070208000003000007500000","sol":"514789326236154897798632514479215683681347952325896741953471268842963175167528439","clues":25,"grade":6,"steps":68},{"g":"000008001008000005170400000000004800030600000500090264010000506605700002040010000","sol":"456938721328167495179452638961274853234685917587391264713829546695743182842516379","clues":25,"grade":6,"steps":68},{"g":"000300000024005090000809604800400000091000000050020008002060015900000000710004000","sol":"689342571124675893537819624876431259291586437453927168342768915968153742715294386","clues":24,"grade":6,"steps":65},{"g":"080047050000005780900030006509000000300000097410750000000500402000000000104083070","sol":"681247359243965781957138246579326814362814597418759623896571432735492168124683975","clues":27,"grade":6,"steps":63},{"g":"000000205060000073070045000000900006000070120400000000690087000020004060748500030","sol":"981736245564129873372845691237918456856473129419652387693287514125394768748561932","clues":26,"grade":6,"steps":61},{"g":"000207008004530000010908000305000006402000007070000520000700040900350601008000000","sol":"659247138284531769713968452395472816462815397871693524136789245927354681548126973","clues":26,"grade":6,"steps":67},{"g":"070901000050000003402003090007000500000009768080000040000005000003060051008400600","sol":"376981425859624173412753896637248519124539768985176342761395284243867951598412637","clues":25,"grade":6,"steps":57},{"g":"090050006506000720001200980003002000008004000150800000000130040400000060000029000","sol":"792358416586941723341267985973612854268594137154873692827136549439785261615429378","clues":25,"grade":6,"steps":62},{"g":"000004100980076000000000030017002540009700028060000000000340010370008060000050000","sol":"726534189983176254154829736817962543439715628562483971695347812371298465248651397","clues":25,"grade":6,"steps":57}]},{"key":"master","name":"大师","blurb":"链技巧与强制链","targets":[7,8],"puzzles":[{"g":"000050000000020050700380090008000000300005100010006407809004600004000700060000009","sol":"623459871981627354745381296478213965396745128512896437839574612154962783267138549","clues":23,"grade":8,"steps":74},{"g":"000406005630050000000000090080064000000000820409300100900003460040200000053000070","sol":"897426315632951748514837692285164937361795824479382156928573461746219583153648279","clues":25,"grade":7,"steps":70},{"g":"000009700908000402000000006500000270093800104400070000031400000000300000004020008","sol":"325649781968715432147238596586194273793862154412573869831456927279381645654927318","clues":24,"grade":8,"steps":66},{"g":"204003000007600040005008900078500002100090007000000000000469001080700000000100060","sol":"264973158897651243315248976478516392126394587539827614752469831681735429943182765","clues":24,"grade":7,"steps":65},{"g":"060003010710000002005000900200940380000070500080012000006001070000000004900030000","sol":"469723815718569432325184967271945386694378521583612749856491273132857694947236158","clues":24,"grade":8,"steps":88},{"g":"500010030030004100000000950007980000006000000080602000000070002001200003890001400","sol":"579816234238594167164723958417985326326147589985632741653479812741258693892361475","clues":24,"grade":7,"steps":72},{"g":"005000209000800001000002038607090080000000000510470000090300000042060010001000760","sol":"185637249263849571974512638627193485438256197519478326796321854842765913351984762","clues":25,"grade":8,"steps":60},{"g":"030000000798540000600000800000005600000401003814700000007200508300000000006100097","sol":"431986275798542136625317849973825614562491783814763952147239568359678421286154397","clues":26,"grade":7,"steps":79},{"g":"060300000015400069800510420500830900004000100190000000000704080000000206900000000","sol":"462379851715482369839516427576831942284967135193245678621794583347158296958623714","clues":26,"grade":8,"steps":63},{"g":"000030001000002060408500370007000042090001000000060500000200000005008030100000408","sol":"769834251351792864428516379637985142594321687812467593986243715245178936173659428","clues":23,"grade":7,"steps":67},{"g":"000900000000001050061030807006009000080400100103000020000000000304016009700005068","sol":"537984612842761953961532847476129385285473196193658724658297431324816579719345268","clues":25,"grade":8,"steps":67},{"g":"005070000600100900000005007020600000019008020400500080000800570830050002000400069","sol":"185976234672134958943285617328617495519348726467592381294861573836759142751423869","clues":26,"grade":7,"steps":67},{"g":"001000000000030020030421058070080290680304000500002000005000000400003002000105904","sol":"241658379856937421937421658174586293682394715593712846365249187419873562728165934","clues":27,"grade":8,"steps":63},{"g":"530000080008001000910004050100030570000018002050000000000900240000005030000670008","sol":"532796481468351927917824653186239574794518362253467819671983245829145736345672198","clues":25,"grade":7,"steps":67},{"g":"000300800600008401080046700000020600000000003013097004065000090700052000000000007","sol":"947315862652978431381246759879423615426581973513697284265734198798152346134869527","clues":25,"grade":8,"steps":81},{"g":"000600047310040000200900000000000500700860000090001063107000004060038090940000000","sol":"859612347316547928274983156681394572723865419495721863137259684562438791948176235","clues":25,"grade":7,"steps":66},{"g":"064900010900000030300000000200030700050000062000100800000008000000340005010005094","sol":"764923518925681437381457926298536741157894362436172859549218673672349185813765294","clues":23,"grade":8,"steps":80},{"g":"020500000500029803071800200000002080080004106060000000003070090000058030400000000","sol":"328547619546129873971863245735612984289734156164985327813476592697258431452391768","clues":25,"grade":8,"steps":61},{"g":"001090800000004607800200300000002004023060500006800009040000950062007000000600000","sol":"631795842295384617874216395987532164123469578456871239748123956362957481519648723","clues":25,"grade":7,"steps":66},{"g":"007000080000008290060050001094000023002000408700040000106000900000301002005480060","sol":"527194386341678295968253741894716523612935478753842619186527934479361852235489167","clues":27,"grade":7,"steps":61},{"g":"104080000000010005900700800000130000000607300500004000080000016070300509060050000","sol":"134586972728913645956742831647135298812697354593824167385279416471368529269451783","clues":24,"grade":7,"steps":77},{"g":"006008000020000006810020900000400001090060028700000000257006089000000000000387400","sol":"476958213529731846813624975682479531194563728735812694257146389348295167961387452","clues":25,"grade":8,"steps":67},{"g":"000070001000080420081400600048090000700500200000000070950200010026800503000000000","sol":"294675381675183429381429657548792136739561248162348975957236814426817593813954762","clues":25,"grade":8,"steps":72},{"g":"000200490020000075007000003005030000000060007704900010501008700000400900809750000","sol":"358276491926341875417589623165837249293164587784925316541698732672413958839752164","clues":26,"grade":7,"steps":72},{"g":"007004002000080740010007089201500000000100800300060020009000000100008000400010060","sol":"837694152592381746614257389281543697946172835375869421759436218163928574428715963","clues":24,"grade":8,"steps":61},{"g":"603204000000000250804050000000500082340000000008000307009600000160007800000082001","sol":"653294178971863254824751936716539482342178695598426317289615743165347829437982561","clues":26,"grade":8,"steps":64},{"g":"081305020000000000420900000100200080800000079205780000060092010003000000000000596","sol":"681375924359124768427968153174239685836541279295786431568492317913657842742813596","clues":26,"grade":7,"steps":56},{"g":"041000000207400039000008000009002650008000100700000004020000000000570003005301800","sol":"541937268287416539693258471139842657458763192762195384324689715816574923975321846","clues":24,"grade":7,"steps":75},{"g":"000000000800040723002300060000100830000704600040039000900405000700000100460900000","sol":"634572981859641723172398465597126834318754692246839517921485376785263149463917258","clues":25,"grade":7,"steps":65},{"g":"000000030209503006040000701030020007051000840000980000000298000400000500008000060","sol":"186742935279513486543869721834125697951376842627984153765298314492631578318457269","clues":25,"grade":8,"steps":73},{"g":"000070000007015090009008040030000600700200803000709005001090000050000004008004060","sol":"824973156367415298519628347432581679795246813186739425641897532953162784278354961","clues":24,"grade":8,"steps":80},{"g":"000106050000000300000708100093600007000000010046300900070080035020570000005000080","sol":"937126854281945376564738192893612547752894613146357928679481235328579461415263789","clues":25,"grade":7,"steps":61},{"g":"000007050005301000007050123006008000090030006020000490300000081000700065070200000","sol":"231467859985321647647859123756948312894132576123675498362594781419783265578216934","clues":26,"grade":8,"steps":89},{"g":"048000005007000400350000072009018007003079200080002003800007001000000040000040900","sol":"948726315217853469356194872429318657163579284785462193894637521532981746671245938","clues":26,"grade":7,"steps":69},{"g":"003060000005000108800507400100704003002180700000000040706010000004000906090300000","sol":"243861579675429138819537462158794623462183795937652841726918354384275916591346287","clues":26,"grade":7,"steps":80},{"g":"000100000457000100003000068081047000000302000000005200700050090900003740300000600","sol":"896134527457286139123579468281947356574362981639815274762451893918623745345798612","clues":25,"grade":7,"steps":62},{"g":"010000005900004000305000160000801070160070409500000000000049000630007010000600200","sol":"812736945976154328345982167493861572168275439527493681281349756639527814754618293","clues":25,"grade":8,"steps":91},{"g":"090400000000060038000500020040109000083000010700000084070026000000000040260000100","sol":"897432651125967438634518729542189367983674512716253984471326895358791246269845173","clues":23,"grade":8,"steps":98},{"g":"706009100015002030300006000000000503000050000040000020008901000003048007007000004","sol":"726439185915782436384516279879124563632857941541693728468971352153248697297365814","clues":24,"grade":7,"steps":70},{"g":"100704000650020000000000000040080060800405000000300020700100003090003000020650009","sol":"138764952654928731279531684347289165862415397915376428786192543591843276423657819","clues":23,"grade":8,"steps":98},{"g":"000100600209000050080060003000001000900203004301900000000350000000000007035004001","sol":"543128679269437158187569423824671395956283714371945862718352946492816537635794281","clues":23,"grade":7,"steps":64},{"g":"080900000000060070103000890076000002000040903000000480000009000807600000320070050","sol":"785931246294865371163427895476398512518742963932516487651289734847653129329174658","clues":24,"grade":8,"steps":72},{"g":"000730009000006040002590060040805000060000001000600030836001005900000007000200300","sol":"684732159597186243312594768743815692268943571159627834836471925925368417471259386","clues":25,"grade":7,"steps":66},{"g":"000060000400010508900000200006700034010000002500004700003040000107003020800000005","sol":"385462179472319568961587243296751834714938652538624791623145987157893426849276315","clues":24,"grade":8,"steps":68},{"g":"070000001563000800000034096021009003000180000000603000007800200000300040906000050","sol":"479268531563917824182534796721459683634182975895673412317845269258396147946721358","clues":26,"grade":8,"steps":82},{"g":"040000830300802000080040070000005940600000000050170000900000014003417009000000500","sol":"249761835376852491185943672731625948692384157854179326928536714563417289417298563","clues":25,"grade":8,"steps":90},{"g":"102009000500060010090080260400000100700030086000500000000000630000140002049300000","sol":"162759348584263719397481265458672193721934586936518427215897634873146952649325871","clues":25,"grade":8,"steps":61},{"g":"780160000200095400000400002050000200600800710000519000900000007100680000000000030","sol":"784162953216395478395478162851736294639824715472519386963251847147683529528947631","clues":25,"grade":8,"steps":82},{"g":"300008940004000700090200005008000056102000000000031200000000690905074000043900000","sol":"317658942524319768896247315438792156172865439659431287781523694965174823243986571","clues":26,"grade":8,"steps":72},{"g":"000200405000100020060070000006031500030760091108000700000000000504000087610040000","sol":"381296475745183926269574138976831542432765891158429763823957614594612387617348259","clues":26,"grade":7,"steps":79},{"g":"030400900807006300905037040000000002089005000200000010000008090070062000106700000","sol":"632451978847296351915837246461379582789125463253684719324518697578962134196743825","clues":26,"grade":7,"steps":73},{"g":"300509020000000319800001750203000070000208004000300000002000080010000600970050000","sol":"361579428457682319829431756243965871796218534185347962632794185514823697978156243","clues":25,"grade":8,"steps":67},{"g":"002000030490000000031002900100708000005010008000050700000000800659000007304060510","sol":"762489135498135276531672984126798453975314628843256791217543869659821347384967512","clues":26,"grade":8,"steps":68},{"g":"004006000703000000600020708000000000009000100000538004040800900051002007800040025","sol":"984376251723185469615924738468219573539467182172538694247853916351692847896741325","clues":25,"grade":8,"steps":74},{"g":"000064900090000035041090000000000004900200006530806000200600000000070500060925000","sol":"825364971796182435341597628618739254974251386532846197253618749189473562467925813","clues":25,"grade":8,"steps":79},{"g":"072900000000070030908000060000039000009104057000200801003095000140000000600000400","sol":"372946518456871239918352764781539642269184357534267891823495176147623985695718423","clues":25,"grade":7,"steps":74},{"g":"030007040000020903006005000000000000080040750000803009560074018000008076040000500","sol":"231987645457126983896435127625719834983642751174853269569274318312598476748361592","clues":26,"grade":7,"steps":69},{"g":"380000005010090000000203040000070008000004651805000000001900086070400000002100300","sol":"387641925214795863569283147126579438793824651845316792431957286678432519952168374","clues":25,"grade":7,"steps":75},{"g":"008600000009003000300097002090030074010006500000700020004300086800000000032008049","sol":"728614395159283467346597812295831674417926538683745921974352186861479253532168749","clues":27,"grade":8,"steps":80},{"g":"205080030000004000049000007000300009080010000003008050000000900800102374302900060","sol":"215789436738624591649531287524376819987215643163498752471863925896152374352947168","clues":26,"grade":7,"steps":60},{"g":"078100000902700810400020000080000004000001390001600078600087000000350600000000009","sol":"578163942962745813413928756789532164246871395351694278695287431124359687837416529","clues":26,"grade":8,"steps":76},{"g":"100200000400000000000450060000000030060009008900000124007060400048103700001500006","sol":"189276345456931287732458961815724639264319578973685124597862413648193752321547896","clues":25,"grade":7,"steps":82},{"g":"000001500900850004103000000000049860002000000001260030000016050039020040000300080","sol":"284631579967852314153974628375149862642583791891267435728416953539728146416395287","clues":26,"grade":8,"steps":76},{"g":"000040230008700009001005070070000108014300025900000000060070040000060000407203000","sol":"756948231348712659291635874673524198814396725925187463569871342132469587487253916","clues":26,"grade":8,"steps":58},{"g":"200000003006051080018040600020105009041080000070000030000000026060000005000900010","sol":"254678193796351284318249657823165749941783562675492831489517326162834975537926418","clues":25,"grade":8,"steps":72},{"g":"200000000050001008060400090300200000000000470000569003040010600020000010086005007","sol":"237698541954321768861457392315274986692183475478569123743812659529736814186945237","clues":24,"grade":8,"steps":87},{"g":"000040007000000602604807009900032000008004030000000275051400000000009400093000000","sol":"139246587587391642624857319915732864278564931346918275851423796762189453493675128","clues":25,"grade":7,"steps":91},{"g":"003004280000068710400000050000600000000405070305020006500900000007000000089073100","sol":"163754289952368714478219653794631528826495371315827496531942867247186935689573142","clues":26,"grade":7,"steps":67},{"g":"100000002004700000000300090820000039000076000000830010030000400060025100480000000","sol":"178694352394752861256318794827541639913276548645839217531987426769425183482163975","clues":23,"grade":8,"steps":88},{"g":"006001090000540800001003040100050080400070030000100000094000000830000200000080065","sol":"546821793379546821281793546123459687458672139967138452694215378835967214712384965","clues":24,"grade":7,"steps":59},{"g":"002008790007006005580000001000004830000079014008000000005000070090400000000260008","sol":"162548793937126485584793621219654837653879214748312569425981376896437152371265948","clues":25,"grade":8,"steps":82},{"g":"820700000003000400090480005500000700309000060007005004130060940006000010000000300","sol":"824751693753629481691483275518346729349172568267895134135268947976534812482917356","clues":25,"grade":8,"steps":72},{"g":"000400170010006004007030082039000000580004009001000000200560300000000000690010400","sol":"865492173312876954947135682739651248586324719421987536274568391153249867698713425","clues":25,"grade":7,"steps":70},{"g":"001007090305000700070302000000000000009080005847000010008200060006050007000108400","sol":"281547693395816742674392158563721984129684375847935216438279561916453827752168439","clues":25,"grade":8,"steps":77},{"g":"000000597200000600900005300000708051020000900700420000030062700001800000000900030","sol":"863214597254379618917685342346798251128536974795421863439162785671853429582947136","clues":25,"grade":7,"steps":64},{"g":"079500002600100830300070500000010000460029000092307000100000000000000050003000980","sol":"879563142625194837314278569738615294461829375592347618157986423986432751243751986","clues":25,"grade":8,"steps":73},{"g":"000800300010070004903000000704000000009700600000025008000080703008059000500010900","sol":"467892315215673894983541267724168539859734621631925478192486753378259146546317982","clues":24,"grade":7,"steps":74},{"g":"009003020070500000200010500010079000020064158800000007000007600130000000000240800","sol":"659483721371592486248716593415879362927364158863125947582937614134658279796241835","clues":26,"grade":7,"steps":58},{"g":"532018000080700000000000600000420050000800000750000200095307008020900070470000003","sol":"532618794186794532947253681319426857264875319758139246695347128823961475471582963","clues":26,"grade":8,"steps":84},{"g":"000050000009000360004200500300002000050906048800400000600004907030000000001008020","sol":"263859471589741362714263589346182795157936248892475136628314957935627814471598623","clues":24,"grade":8,"steps":67},{"g":"000603000020010940050000080702030005006000000900700100009001003070560004000000850","sol":"894673521623815947157492386782136495416958732935724168549281673378569214261347859","clues":25,"grade":8,"steps":66},{"g":"500400000690000020004630800800309700001075200000000090480000002700048000000000001","sol":"528491367693587124174632859842369715961875243357124698486913572715248936239756481","clues":25,"grade":7,"steps":64},{"g":"000000000020460005001000427760000200080002030002100050000093060000005000000017049","sol":"458729316327461985691358427763584291185972634942136758574893162219645873836217549","clues":25,"grade":8,"steps":72},{"g":"010300007800002000200090010000048000900010030000000006460001200300070009070000050","sol":"514386927897152643236497815623748591948615732751923486469531278385274169172869354","clues":23,"grade":8,"steps":75},{"g":"002000056000020000057906200006100000098400002520300000080000075000590030000000800","sol":"812743956963825147457916283746152398398467512521389764689231475274598631135674829","clues":25,"grade":7,"steps":71},{"g":"008000165003000900600209007800090000091000000000086009400002050000300800002000001","sol":"928437165753861942614259387865793214391524678247186539486912753179345826532678491","clues":24,"grade":8,"steps":80},{"g":"000004000050007000174950600008020410000000700900000050400060200090200080680071000","sol":"839614527256387941174952638368725419521498763947136852413869275795243186682571394","clues":26,"grade":7,"steps":83},{"g":"500000000601400007004009015708020000900005000000906720280600070000000001000380006","sol":"593718462621453897874269315738124659962875134415936728289641573346597281157382946","clues":26,"grade":7,"steps":71},{"g":"013050000500700090006010002089000007060005080370900000000108000000000206000360018","sol":"713259864528746193946813752489631527162475389375982641697128435831594276254367918","clues":26,"grade":7,"steps":58},{"g":"020970006000020000600000120003700009050083700100000000000860030000090000095200064","sol":"521978346437126598689345127843712659956483712172659483214867935368594271795231864","clues":25,"grade":8,"steps":69},{"g":"100020000064000200070009503300106009005097400000000000000000000080065900790002008","sol":"153824697964573281278619543347156829825397416619248375532981764481765932796432158","clues":25,"grade":8,"steps":74},{"g":"000300001650790004000000690004000100000906000000052007000003000840000030307000060","sol":"429365871651798324783124695294837156578916243136452987965243718842671539317589462","clues":23,"grade":8,"steps":76},{"g":"740501300000006700900000500080700031500900008030000900006040807004050000800003100","sol":"748591326253486719961327584489765231517932468632814975326149857174258693895673142","clues":27,"grade":8,"steps":75},{"g":"000002690400059000070600000000020953000000000792000000300000480008504030006003700","sol":"835742691461859372279631548684127953513498267792365814357216489928574136146983725","clues":25,"grade":7,"steps":87},{"g":"060100802100000095009002700000207900000000000032500600000080030004601200006700080","sol":"763195842128476395459832761841267953675319428932548617217984536384651279596723184","clues":26,"grade":8,"steps":63},{"g":"040030000030000025670089043016002004000090000400000050000060290008004000760003000","sol":"241635879839147625675289143916572384523498761487316952354861297198724536762953418","clues":26,"grade":7,"steps":74},{"g":"308000001000790000070000035020006040400070090009400000040150000003007800010000006","sol":"398524761165793284274861935527936148481275693639418527846152379953647812712389456","clues":24,"grade":8,"steps":93},{"g":"060008000040000010700402080000009001097100200500000800000005902802000070000020400","sol":"169738524248596317753412689386259741497183256521647893614875932832964175975321468","clues":24,"grade":8,"steps":62},{"g":"030005019040900020500700004007193006000000000000050230803070400010000000000004902","sol":"736245819148936725592781364287193546354862197961457238823679451419528673675314982","clues":26,"grade":7,"steps":56},{"g":"406019070000500800800000005673020090000000000009007032080000000200600304300040000","sol":"456819273732564819891273465673425198128936547549187632984351726217698354365742981","clues":25,"grade":8,"steps":57}]}]};


/* ---------------- 下一段 ---------------- */


/* ============================================================
   数独 · 会教你的数独 —— 交互 Demo
   依赖：SudokuEngine（技巧分级引擎 L1~L8）、SUDOKU_BANK（预生成定级题库）
   ============================================================ */
(function () {
  'use strict';

  var E = window.SudokuEngine;
  var BANK = window.SUDOKU_BANK;

  /* ---------------- 技巧图鉴（人话版） ----------------
     desc = 这个技巧是什么；how = 上棋盘怎么找（精讲，可照着做） */
  var TECHS = [
    { lv: 1, name: '唯一余数', en: 'Naked Single',
      desc: '这个格子把同行、同列、同宫已经出现的数字全部排除后，只剩下一个数字能放。',
      how: '盯住一个空格，把同行 / 同列 / 同宫里已出现的数字从它的候选里划掉 —— 只剩一个，就填它。',
      when: '任何时候都能用，开局第一招就是它：先满盘扫一遍「只剩一个数能放」的格子，往往一口气能填掉一大片。',
      primer:
        '<div class="tp-hd">零基础先看：为什么这个格子只剩一个数能放</div>' +
        '<div class="tp-fig g9">' +
          '<i class="pc x">1</i><i class="pc x">2</i><i class="pc x">3</i><i class="pc x">4</i>' +
          '<i class="pc x">5</i><i class="pc hl">6</i><i class="pc x">7</i><i class="pc x">8</i><i class="pc x">9</i>' +
        '</div>' +
        '<div class="tp-cap">这格子的 9 种可能里，8 种被同行 / 同列 / 同宫已经出现的数字否掉了，只剩 6 能放。</div>' +
        '<div class="tp-l">' +
          '<p><b>先记住唯一一条硬规则：</b>同一行、同一列、同一个 3×3 宫里，1 到 9 每个数字只能出现一次。整盘数独的所有推理，都是从这一条长出来的。</p>' +
          '<p><b>「候选」是什么意思：</b>一个空格理论上能放 1 到 9；只要它的同行、同列或同宫里已经出现过某个数字，这个数字就被排除。剩下没被排除的，就是它的候选。</p>' +
          '<p><b>唯一余数就是候选只剩一个：</b>比如某格同行有 1、3、7，同列有 2、4、8，同宫有 5、9 —— 九个数字里 8 个都出现过了，那这格只能是 6。不用猜，也跟别的空格无关。</p>' +
          '<p><b>为什么百分百正确：</b>这一格必须填 1 到 9 中的一个，而其中 8 个都会当场违反规则，能填的只剩一个。这是数独里最硬的一种确定。</p>' +
        '</div>' +
        '<div class="tp-k"><b>新手最容易犯的两个错：</b>① 以为要盯着整盘看 —— 其实只看这一格所在的 3 个单元（共 20 格）；② 以为很难找 —— 开局先满盘扫一遍「候选只剩一个」的格子，往往能一口气连填七八个，性价比最高的一招。</div>' },
    { lv: 2, name: '隐性唯一', en: 'Hidden Single',
      desc: '某个数字在这一行、这一列或这一宫里，只剩一个位置放得下——虽然那个格子里可能还写着别的候选。',
      how: '挑一个还没填满的数字，扫它所在的行 / 列 / 宫，看它还能落进哪几格；只剩一格就填，别管那格里还写着什么候选。',
      when: '唯一余数扫不出东西时，换个方向：不盯格子，改盯数字 —— 一个数字一个数字地问「你在这条线/这个宫里还能站哪」。',
      primer:
        '<div class="tp-hd">零基础先看：换个方向，不盯格子，改盯数字</div>' +
        '<div class="tp-fig g3">' +
          '<i class="pc no">×</i><i class="pc no">×</i><i class="pc no">×</i>' +
          '<i class="pc no">×</i><i class="pc hl">7</i><i class="pc no">×</i>' +
          '<i class="pc no">×</i><i class="pc no">×</i><i class="pc no">×</i>' +
        '</div>' +
        '<div class="tp-cap">一个宫里其余 8 格都放不下 7（同行 / 同列已有 7，或那格的候选里没有 7），那 7 只能落进剩下这一格。</div>' +
        '<div class="tp-l">' +
          '<p><b>它和唯一余数的方向正好相反：</b>唯一余数问「这一格能填什么」，隐性唯一问「这个数能填在哪」。一个从格子出发，一个从数字出发。</p>' +
          '<p><b>怎么看出来：</b>拿一个数字（比如 7），把它在这个宫里的落脚点全点一遍。只剩一格放得下，7 就锁定在这格。</p>' +
          '<p><b>关键区别（新手最容易漏的一点）：</b>那一格里可能还写着别的候选，比如 {7、2、5}。既然 7 在这个宫没别处可去，它就一定在这一格 —— 于是 2 和 5 当场作废，可以放心划掉。</p>' +
          '<p><b>为什么它比唯一余数难发现：</b>人的眼睛习惯盯着格子看「这格还剩几个候选」，而隐性唯一要求你盯着数字看「这个数在这单元还剩几个位置」。视角得主动切过去。</p>' +
        '</div>' +
        '<div class="tp-k"><b>实操顺序：</b>唯一余数扫不出东西以后，拿 1 到 9 一个一个过，对每个数字问一遍「它在每一行 / 每一列 / 每一个宫里还能站哪」。只要有一条线或一个宫只剩一格，就落子。做完这一轮，盘面通常会重新松动，再回头扫唯一余数。</div>' },
    { lv: 3, name: '区块摒除', en: 'Pointing · Claiming',
      desc: '宫里某个数字能放的位置，如果全挤在同一行（或同一列）—— 那它肯定占着那条线，这条线上宫外的格子就放不下它。反过来，一行（或列）里的某数字全挤在同一宫，道理也一样。',
      how: '在某一宫里找某个数字的落脚点：若全挤在同一行 / 列，就把这条线上「宫外」的该候选划掉（Pointing）。反过来，一条线上某数字的落脚点若全在同一宫里，就把「宫内这条线以外」的该候选划掉（Claiming）。',
      when: '前两招都推不动时，看「某个数字在某宫里是不是全挤在同一行 / 同一列」—— 挤成一堆，就能顺着那条线往外删。',
      primer:
        '<div class="tp-hd">零基础先看：宫和线其实是「共用名额」的</div>' +
        '<div class="tp-fig g3">' +
          '<i class="pc no">×</i><i class="pc no">×</i><i class="pc no">×</i>' +
          '<i class="pc no">×</i><i class="pc no">×</i><i class="pc no">×</i>' +
          '<i class="pc hl">7</i><i class="pc hl">7</i><i class="pc hl">7</i>' +
        '</div>' +
        '<div class="tp-cap">这个宫里 7 的落脚点全挤在最下面这一行 —— 说明这个宫的 7 一定在这行里。</div>' +
        '<div class="tp-l">' +
          '<p><b>先看清结构：</b>一个 3×3 宫横跨三行三列，一行横跨三个宫。宫和行是重叠咬合的，不是两套分开的系统。</p>' +
          '<p><b>Pointing（宫内挤成一线）：</b>一个宫里某个数字的落脚点全挤在同一行，那这宫的该数字一定在这行上。而这一行只能有一个该数字、名额已经被这个宫占掉了 —— 于是这行在宫外的格子，都不能再是这个数字。</p>' +
          '<p><b>Claiming（线上挤进一宫）：</b>反过来，一行里某个数字的落脚点全落在同一个宫内，那这行的该数字一定在这个宫里。于是这个宫内在其他行上的格子，都不能再是这个数字。</p>' +
          '<p><b>一句话记住：</b>宫里的那个 7 和行里的那个 7 是同一个 7，它同时占了两边的名额 —— 哪边被占了，就到另一边的剩余位置上删。</p>' +
        '</div>' +
        '<div class="tp-k"><b>方向别搞反（最常见的错）：</b>Pointing 要删的是「宫外那条线上」的候选；Claiming 要删的是「宫内其他行上」的候选。记不住就问自己一句：<b>这个数字已经把这一个方向的格子排满了，那就去删另一个方向。</b></div>' },
    { lv: 4, name: '数对与数组', en: 'Naked · Hidden Subset',
      desc: '两个格子的候选恰好是同样两个数 → 这两个数已被它俩「包场」，同行列宫的其他格子都不能再放。',
      how: '找两个候选完全相同的格子（都只含 A、B）→ 这两个数被它俩包场，同单元其他格子的 A、B 全划掉。三个格同理（数组）。反过来「隐性数对」：两个数字只出现在同两格里 → 这两格的其他候选划掉。',
      when: '候选越记越少之后用最划算：两个格子候选一模一样，或两个数字只肯待在同两格里 —— 出现这种「包场」就能批量划掉一堆候选。',
      primer:
        '<div class="tp-hd">零基础先看：两个格子「包场」了两个数字</div>' +
        '<div class="tp-fig">' +
          '<i class="pc n sm">2·7</i><i class="pc n sm">2·7</i><i class="ln wide"></i>' +
          '<i class="pc x">2</i><i class="pc x">7</i>' +
        '</div>' +
        '<div class="tp-cap">两格的候选都只有 2 和 7 —— 这两个数被它俩包场，同单元其他格子的 2、7 全部作废。</div>' +
        '<div class="tp-l">' +
          '<p><b>为什么能包场：</b>一个单元里 9 格要放 9 个数，一格一个。如果两个格子的候选都只有 {2、7}，那 2 和 7 必须由这两格消化掉 —— 别处根本放不下它们。既然这两格已被 2、7 占满，同一单元里其他格子的 2 和 7 就都没位置了。</p>' +
          '<p><b>三个格同理（数组）：</b>三格的候选都落在 {2、7、9} 这三个数里，那这三个数被三格包场，同单元其他格子的 2、7、9 全划掉。</p>' +
          '<p><b>隐性数对是反过来的：</b>如果 2 和 7 在这个单元里只能出现在同两格里，那这两格一定是 2 和 7 —— 它们身上其他的候选（比如 5）可以放心划掉。</p>' +
          '<p><b>两边一起记：</b>显性数对看「格子的候选少而整齐」；隐性数对看「数字的落脚点少而集中」。前者从格子出发、后者从数字出发，和 L1 / L2 的关系完全一样。</p>' +
        '</div>' +
        '<div class="tp-k"><b>别用错的边界：</b>必须是「这两格的候选恰好就是这两个数」。一旦多出第三个候选（比如一格是 {2、7、5}），包场立刻不成立。宁可少用，也不要用错。</div>' },
    { lv: 5, name: '鱼型', en: 'X-Wing · Swordfish',
      desc: '某数字在两行里都只剩相同的两列可放 → 这两列的其他位置都可以排除它。三行三列则是剑鱼。',
      how: '挑一个数字，看它在两行里是不是都只剩相同的两列 → 是的话，这两列的其他位置都不能放它。三行三列对齐就是剑鱼。',
      when: '同一个数字在两行（或两列）里的落脚点刚好对齐成矩形时 —— 也就是「鱼型」。三行三列对齐叫剑鱼，删得更多。',
      primer:
        '<div class="tp-hd">零基础先看：四角对齐的矩形</div>' +
        '<div class="tp-fig g2">' +
          '<i class="pc hl">7</i><i class="pc hl">7</i><i class="pc hl">7</i><i class="pc hl">7</i>' +
        '</div>' +
        '<div class="tp-cap">两行里，7 的落脚点都只落在这同样的两列 —— 四个角正好连成一个矩形。</div>' +
        '<div class="tp-l">' +
          '<p><b>先只看一件事：</b>把某个数字（比如 7）在全盘的所有落脚点在心里点出来。别的数字一概不看，只看它。</p>' +
          '<p><b>X-Wing 的骨架：</b>假设第 2 行里 7 只能放在第 3 列或第 7 列；第 5 行里 7 也只能放在第 3 列或第 7 列。这四个位置连起来就是一个矩形。</p>' +
          '<p><b>关键推理：</b>第 2 行的 7 一定占这两列之一，第 5 行的 7 也一定占这两列之一。可一列只能有一个 7 —— 所以这两行的 7 必然把这两列「各占一个」，一个不剩。</p>' +
          '<p><b>结论：</b>这两列在其他行上的 7 全部可以删。因为这两列的 7 名额已经被第 2 行和第 5 行用光了。</p>' +
          '<p><b>剑鱼是同一件事放大：</b>三行三列对齐，一次能删掉更多。逻辑一个字没变，只是从 2×2 变成 3×3。</p>' +
        '</div>' +
        '<div class="tp-k"><b>最容易搞反的地方：</b>X-Wing 淘汰的是<b>两列</b>上的其他位置，不是两行上的。记法：<b>哪两行把名额占了，就去删那两列。</b></div>' },
    { lv: 6, name: 'XY-Wing · 唯一矩形', en: 'XY-Wing · Unique Rectangle',
      desc: '三个「二选一」的格子搭成一个三角，共同那个数字被揪出；或者四个角会构成「双解」，必须避开。',
      how: 'XY-Wing：找中心格 XY，和它同单元的两个二选一格 XZ、YZ；同时看得见 XZ 与 YZ 的格子不能是 Z。唯一矩形：四格若会构成「双解」形状，就必须避开，据此删数。',
      when: '盘面上冒出三个「二选一」格子搭成三角（XY-Wing），或四个角眼看要凑成可互换的「双解」形状（唯一矩形）时用 —— 后者靠「题目必须唯一解」这一条硬规矩。',
      primer:
        '<div class="tp-hd">零基础先看：三个「二选一」搭成一个三角</div>' +
        '<div class="tp-fig">' +
          '<i class="pc n sm">X·Z</i><i class="ln wide"></i><i class="pc n sm">X·Y</i>' +
          '<i class="ln wide"></i><i class="pc n sm">Y·Z</i>' +
        '</div>' +
        '<div class="tp-cap">中间的 XY 是中心格，跟左右两格都看得见（同行 / 同列 / 同宫）；左右两格互相看不见。</div>' +
        '<div class="tp-l">' +
          '<p><b>先认识「二选一」：</b>一个格子如果只剩两个候选，比如只可能是 2 或 7，就叫二值格。二值格是数独里最好用的东西，因为它把「猜」压缩成了「二选一」。</p>' +
          '<p><b>XY-Wing 的三格结构：</b>中心格是 {X、Y}，两个翅膀分别是 {X、Z} 和 {Y、Z}，且中心格必须同时看得见两个翅膀。</p>' +
          '<p><b>为什么只有两种情况：</b>中心格是 X，那 {X、Z} 那格的 X 被排除，它只能填 Z；中心格是 Y，那 {Y、Z} 那格的 Y 被排除，它也只能填 Z。两种情况已经穷尽了所有可能。</p>' +
          '<p><b>结论：</b>不管走哪条路，Z 一定出现在两个翅膀之一。所以任何同时看得见这两个翅膀的格子，都不可能是 Z。</p>' +
          '<p><b>唯一矩形走的是另一条路：</b>如果四个格子在两行两列上都是同样的两个候选，会形成「把这两个数互换、整盘依然合法」的对称形状 —— 也就是这道题有两个解。而数独题必须唯一解，所以这种形状一定不成立，据此把候选删掉。</p>' +
        '</div>' +
        '<div class="tp-k"><b>新手最常见的误判：</b>XY-Wing 删的<b>不是中心格</b>，是「同时看得见两个翅膀」的第三个格子。中心格只是桥梁，它自己不删。</div>' },
    { lv: 7, name: '链技巧', en: 'Simple Coloring · XY-Chain',
      desc: '同一个数字在某单元里只剩两个落脚点 → 这两格必然一真一假（强关系）。把这些强关系串成链、交替染成两种颜色：同色 = 同真同假，异色 = 必定一真一假。',
      how: '挑一个数字，找「只剩两个落脚点」的单元，把它们串成链并交替染两色（比如红 / 蓝）。两条用法：① 同色的两格若落在同一单元 → 不可能同时为真，这一整色都不能是这个数，全划掉；② 某个格子同时看得见一红一蓝两格 → 红蓝必有一真，它就不可能是这个数，划掉。',
      when: '某个数字在很多单元里都只剩两个落脚点时，最适合串链染色 —— 同色帮你「整片否决」，异色帮你「单点否决」。',
      /* 零基础补充（只在教程里展开）：很多零基础玩家卡在「红蓝到底代表什么」，先讲清再上棋盘 */
      primer:
        '<div class="tp-hd">零基础先看：红和蓝，到底在说什么？</div>' +
        '<div class="tp-sub">第一步 · 什么叫「搭档」，为什么它俩必定一真一假</div>' +
        '<div class="tp-l">' +
          '<p>只盯一个数字（比如 7）。如果它在某一行里只剩两个格子能放，那这两格必定<b>有一个是 7</b>（不然 7 没地方去），也<b>最多只有一个是 7</b>（一行不能放两个）。合起来就是：<b>恰好一真一假</b>。这样一对格子，就叫「搭档」。</p>' +
          '<p>把一串搭档首尾接起来（A 和 B 是搭档，B 和 C 也是搭档 ……），就成了链。</p>' +
        '</div>' +
        '<div class="tp-sub">第二步 · 搭档串起来，真假就一格一格翻面</div>' +
        '<div class="tp-fig">' +
          '<i class="pc b">7</i><i class="ln"></i><i class="pc r">7</i><i class="ln"></i>' +
          '<i class="pc b">7</i><i class="ln"></i><i class="pc r">7</i><i class="ln"></i><i class="pc b">7</i>' +
        '</div>' +
        '<div class="tp-cap">同一伙＝同真同假　　对手＝恰好一真一假</div>' +
        '<div class="tp-l">' +
          '<p>既然每一节都是「一真一假」，那整条链走下来只可能有两种结果：</p>' +
        '</div>' +
        '<div class="tp-tbl">' +
          '<div class="tp-tr hd"><i></i><i class="ca">A</i><i class="cb">B</i><i class="ca">C</i><i class="cb">D</i></div>' +
          '<div class="tp-tr"><i class="lb">假设一</i><i class="b">7</i><i class="off">不是</i><i class="b">7</i><i class="off">不是</i></div>' +
          '<div class="tp-tr"><i class="lb">假设二</i><i class="off">不是</i><i class="r">7</i><i class="off">不是</i><i class="r">7</i></div>' +
        '</div>' +
        '<div class="tp-cap2">看这张表：A 和 C 永远同一个答案，B 和 D 永远同一个答案，而 A 与 B 永远相反。特别注意「假设二」那一行 —— <b>A 依然是蓝的，内容却变成了「不是 7」</b>。</div>' +
        '<div class="tp-l">' +
          '<p><b>所以颜色到底是什么：</b>它不是「对 / 错」，也不是「是 7 / 不是 7」。颜色只是给格子贴了个组号 —— <b>同号的一组永远同生共死，异号的两组永远一个真一个假</b>。</p>' +
        '</div>' +
        '<div class="tp-k"><b>新手最大的误解：</b>以为蓝＝这格是 7。不是。蓝队完全可能整队都不是 7 —— 具体哪一队是真的，光看染色永远不知道。教程里叫红蓝、叫 A/B、叫单双，意思完全一样。</div>' +
        '<div class="tp-sub">第三步 · 那我该怎么染</div>' +
        '<div class="tp-l">' +
          '<p>随便挑链上一格先涂蓝，沿着连线走到下一格就涂红，再下一格又涂蓝 …… 颜色会自动分配好，全程不需要你判断真假。你只是在给「同命运的一伙」起名字。</p>' +
        '</div>' +
        '<div class="tp-sub">第四步 · 既然不知道真假，凭什么还能删格子</div>' +
        '<div class="tp-l">' +
          '<p>光染色确实一格都删不掉 —— 这是实话。但「两队」这个结构本身带着信息，它会让某些局面当场自爆：</p>' +
        '</div>' +
        '<ul class="tp-u">' +
          '<li><b>用法一（同色撞单元）：</b>两个同色的格子如果落在同一行 / 列 / 宫里，它们要么都是 7、要么都不是。若都是 7，这一行就有两个 7 —— 直接违规。于是「这一队是真的」当场被否掉，<b>整队同色格全不是这个数，一起划掉</b>。一次可能删好几个。</li>' +
          '<li><b>用法二（异色共见）：</b>有个格子（不必在链上）同时看得见一蓝一红。蓝红必有一个是真 7，所以不管哪队真，这格都会被那个 7 从线上压住 —— <b>它不可能是这个数，划掉它一个</b>。</li>' +
        '</ul>' +
        '<div class="tp-k"><b>一句话收尾：</b>颜色本身不带真假信息，带信息的是<b>颜色的组合关系</b>。同色撞进同一个单元 → 整队作废；异色被同一格共见 → 那个格子作废。记住这两句，这一招就通了。</div>' },
    { lv: 8, name: '强制链', en: 'Forcing Chain',
      desc: '假设某一格取某个值，只用最基础的推理往下推——推出矛盾，就反证这个假设不成立。这是兜底手段，几乎能处理任何局面。',
      how: '假设某一格取某个值，只用前面 L1–L4 的基础推理往下推；若推出矛盾，就反证这个假设不成立，排除该候选。',
      when: '前面 L1–L7 全试过还是推不动时的兜底招：挑一个有候选的格子做假设，往下硬推，推到矛盾就反证它不成立。',
      primer:
        '<div class="tp-hd">零基础先看：这一招其实就是「假如……会怎样」</div>' +
        '<div class="tp-fig">' +
          '<i class="pc hl sm">7?</i><i class="ln wide"></i><i class="pc no">×</i>' +
        '</div>' +
        '<div class="tp-cap">先假设某格是 7，然后只用最基础的规则往下推 —— 推出矛盾，就说明这个假设是假的。</div>' +
        '<div class="tp-l">' +
          '<p><b>它一点都不神秘，你其实早就在用：</b>卡住的时候会想「假如这格填 7 呢？」，然后顺着往下试几步。强制链只是把这一步做得更系统、更短、更可靠。</p>' +
          '<p><b>完整四步：</b>① 挑一个候选最少的格子；② 假设它取其中某个值；③ 只用「同行 / 同列 / 同宫不能重复」这一条往下推；④ 一旦推出「同一行要放两个 7」这类硬矛盾，就说明这个假设是错的，把这个候选划掉。</p>' +
          '<p><b>为什么不违反「不许猜」：</b>猜是随便填一个然后不管对错；强制链是故意设一个前提，再用矛盾把它否掉。每一步都可验证，结论百分百可靠，跟运气无关。</p>' +
          '<p><b>推不出矛盾怎么办：</b>说明这条路当下走不到死胡同（注意：这并不代表假设成立），换一个假设、或者换一格再来。这正是它被放到 L8 当兜底招的原因 —— 稳妥，但费力。</p>' +
        '</div>' +
        '<div class="tp-k"><b>省力技巧：</b>优先挑<b>候选只有两个</b>的格子做假设。这类格子一假设，另一半立刻确定，往往三五步就能撞出矛盾或者走通全程。</div>' }
  ];
  var LV_LABEL = ['', '入门', '简单', '中等', '困难', '进阶', '挑战', '大师', '极限'];

  /* ---------------- 状态 ---------------- */
  /* zoom 支持探测：手机端自动缩放靠它；不支持就老老实实按原尺寸布局（不硬撑，避免布局错乱） */
  var ZOOM_OK = (function () {
    try {
      if (window.CSS && CSS.supports && typeof CSS.supports === 'function') {
        if (CSS.supports('zoom', '0.75')) return true;
      }
    } catch (e) {}
    try { return ('zoom' in document.documentElement.style); } catch (e2) {}
    return false;
  })();

  /* fitBoard / fitScale 的自检数据（排查手机端缩放用，浏览器控制台里看 window.__sdFit） */
  var D = {}; try { window.__sdFit = D; } catch (e) {}

  var S = {
    tierKey: null, tier: null, puzIdx: 0,
    puzzle: null, sol: null, grid: null, given: null, notes: null,
    sel: -1, autoCheck: true, autoTip: false, focus: false,
    // autoTip=false（默认）：棋盘上绝自动不出现任何答案——点空白格就是点空白格，什么都不冒。
    // autoTip=true（「全盘自明」开关，用户主动点开）：所有一眼格一起亮幽灵答案，主动偷懒模式。
    curDigit: 0, mustN: 0, mustSel: 0,
    // mustSel=选中空格的「9 差 1」缺数（0=无）。触发条件极保守：只有所在行/列/宫
    // 已填满 8 个、只剩这一个空格时，缺的那个数不用想都知道 → 数字键亮绿。
    // 唯一余数（靠排除算出唯一候选）也不亮 —— 用户：那是我自己数一下就能得出的，别替我数。
    hist: [], elapsed: 0, tick: null, paused: false,
    mistakes: 0, hints: 0, hintCost: 0, used: {}, solved: false, coached: false, noteMode: false,
    /* 连击：连续填对累加；填错 / 擦除 / 撤销归零（笔记不算落子，不影响连击） */
    combo: 0,
    hint: null, hintSeq: [],
    /* 引擎候选状态：排除类技巧（L3 起）必须逐累积，否则会卡在同一条排除上 */
    cands: null, elim: null,
    /* 卡点复盘：stuckAt = 最近一次有效操作的时间戳，用来量化「在这一点卡了多久」 */
    stuckAt: 0,
    /* 当前视图：play=做题（主界面） / skills=技巧图鉴 / about=关于&玩法 */
    view: 'play'
  };

  /* ---------------- 纠错开关的两种行为（2026-10-31） ----------------
     一个开关管两件事，用户原话：
       · 纠错「开」：填错当场标红 + 计数 + 闷响震动；**填对的格子锁定**，防手滑改掉
       · 纠错「关」：不判对错、不标红（连同行同列同宫撞数也不染）、不计数、不锁格 ——
         填对了也能改，填错了也没提示，全凭自己核对（即业界说的 Paper Mode / 纸上模式）
     开关是设备级偏好，存 sd.check。 */
  function lockedCell(i) {
    return !!S.autoCheck && !!(S.grid && S.sol && S.grid[i] && S.grid[i] === S.sol[i]);
  }
  function applyCheck() {
    var b = $('btnCheck');
    if (!b) return;
    var on = !!S.autoCheck;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.textContent = '纠错 ' + (on ? '开' : '关');
    b.title = on
      ? '纠错开：填错当场标红并计数；已填对的格子会锁定，防手滑改掉（点一下关掉）'
      : '纠错关：不判对错、不标红、不计错误、不锁格 —— 像在纸上做题，填错了自己发现（点一下打开）';
  }

  /* ============================================================
     卡点复盘本（Stuck-point Review）
     ------------------------------------------------------------
     每次申请提示时，自动把「提示前的局面 + 玩家当时的笔记 + 这一步的技法」存成一张卡。
     用户可以随时回到那个局面、重演推理链、并做自测。
     三条设计原则：
     ① 快照只存「提示前」的局面 —— 天然不含答案，复盘不剧透。
     ② 必须连「玩家当时的笔记」一起存 —— 复盘的价值就在于还原你当时看到的东西。
     ③ 「看过」≠「会做」：必须过自测才标记「已掌握」，否则一直留在「待复习」。
     ============================================================ */
  var RW = {
    cards: [],        // 卡点卡片（最新在前）
    view: 'list',     // list | detail
    cur: null,        // 当前查看的卡
    qa: {},           // 自测作答情况
    qaPick: {},       // 自测当时点了哪个选项（重绘后要贴回去）
    replay: false     // 详情页是否处于「已重演」状态
  };
  var CARD_MAX = 300;
  var cells = [], refs = [], boxCls = [];

  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  /* 纠错开关要在第一帧之前落定（这块代码跑在 paint 之前）：
     否则从「纠错关」用回来的人会先看到一帧红格子，等于偷偷判了一次对错。 */
  S.autoCheck = LS.get('sd.check', true) !== false;

  /* ============================================================
     反馈模块（音效 + 震动）—— WebAudio 纯合成，零外部资源
     ------------------------------------------------------------
     五种声音都回答「棋馆里该是什么响动」：
       ok    = 棋子落枰：正弦 800Hz 快速衰减，一声闷实的「笃」，只收 120ms
       err   = 木头磕到桌沿：200Hz / 205Hz 两个几乎同频的正弦互打拍，低哑一拍
       done  = 三音上行小琶音：C5-E5-G5，收束用，不浮夸
       ntOn  = 记候选：1200Hz 纸笔「嗒」，45ms
       ntOff = 划掉候选：930Hz 更闷的一「嗒」，一听就知道是划掉不是记上
     自动播放策略：AudioContext 只在「首次用户交互」时创建并 resume，
     页面加载阶段一个都不建 → 不会触发 Chrome 的 autoplay 警告。
     开关存 sd.sfx（默认开，与主题同为设备级偏好，不按账号隔离）。
     关了就是全静音：连 AudioContext 都不建，震动也一起停（指令 5 合并为「反馈」）。
     ============================================================ */
  var Sfx = (function () {
    var AC = null, on = LS.get('sd.sfx', true) !== false, busNode = null;

    /* ---- 主总线（2026-10-31 第二次真机反馈「还能再大点」）----------------------
       上一版只是把每个音的起始增益从 0.22 提到 0.62，已经是单音不削波的上限，
       再往上直接顶到 1.0 就会被硬切、发糊。真正的解法是把峰值交给软限幅：
       各音先汇进一条主总线（MASTER 倍增益），再过一层「0.7 以下线性、0.7 以上
       用 tanh 压成谐波」的曲线。听感上响度主要来自谐波密度，所以既更响又不刺。
       峰值仍被钳在 1.0 以内，不会溢出到硬削波。 */
    var MASTER = 1.45, KNEE = 0.7;
    function softCurve() {
      var n = 1024, c = new Float32Array(n), i, x, a, y;
      for (i = 0; i < n; i++) {
        x = (i / (n - 1)) * 2 - 1;
        a = x < 0 ? -x : x;
        y = a <= KNEE ? a : KNEE + (1 - KNEE) * Math.tanh((a - KNEE) / (1 - KNEE));
        c[i] = x < 0 ? -y : y;
      }
      return c;
    }
    /* 总线只建一次；WaveShaper 不被老旧内核支持时退回直连，音量只少那层谐波 */
    function bus(c) {
      if (busNode) return busNode;
      var g = null;
      try {
        g = c.createGain();
        g.gain.value = MASTER;
        var sh = c.createWaveShaper();
        sh.curve = softCurve();
        sh.oversample = '2x';
        g.connect(sh); sh.connect(c.destination);
      } catch (e) {
        try { if (g) g.connect(c.destination); } catch (e2) {}
        if (!g) return null;
      }
      busNode = g;
      return g;
    }

    /* 取（或惰性建）AudioContext。闭掉时返回 null —— 不建、不响、不震。 */
    function ac() {
      if (!on) return null;
      if (!AC) {
        var C = window.AudioContext || window.webkitAudioContext;
        if (!C) return null;
        /* latencyHint:'interactive' —— 默认是 'balanced'，手机扬声器上能听出 80~120ms
           的「慢半拍」；指定 interactive 后浏览器给最小缓冲。老内核不认这个参数会抛，
           所以再兜一次无参构造。 */
        try { AC = new C({ latencyHint: 'interactive' }); }
        catch (e) { try { AC = new C(); } catch (e2) { return null; } }
      }
      if (AC.state !== 'running') {
        try { var p = AC.resume(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      }
      return AC;
    }

    /* 一个音：起始频率 f0 → 收尾频率 f1（木头味靠这记下滑），dur 秒，g0 起始音量 */
    function tone(c, f0, f1, dur, g0, delay) {
      var t = c.currentTime + (delay || 0);
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(g0, t + 0.002);    // 2ms 起音：再短会「咔」，敲击感够
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);  // 快速衰减 = 木头不余响
      o.connect(g); g.connect(bus(c) || c.destination);
      o.start(t); o.stop(t + dur + 0.02);
    }

    function buzz(n) {
      if (!on || !navigator.vibrate) return;
      try { navigator.vibrate(n); } catch (e) {}
    }

    function play(kind) {
      if (!on) return;
      /* 震动（指令 5）：填错 30ms 一下；完成 [30,50,80] 三段；填对不震，免得一路麻手 */
      if (kind === 'err') buzz(30);
      else if (kind === 'done') buzz([30, 50, 80]);
      var c = ac();
      if (!c) return;
      try {
        /* 音量（2026-10-31 第二次真机反馈「再大一些」）：
           各音起始增益再抬一档，剩下的响度交给主总线的 MASTER 1.45 + 软限幅。
           峰值落在 0.86~0.98（软限幅后），不会硬削波；谐波变密 = 小喇叭上更「响」。 */
        if (kind === 'ok') {
          tone(c, 800, 742, 0.12, 0.78);          // 主音：800Hz 略微下滑
          tone(c, 1600, 1600, 0.05, 0.16);        // 高频泛音，给木头一点「脆」
        } else if (kind === 'err') {
          tone(c, 200, 196, 0.22, 0.56);          // 低哑，两音差 4~5Hz 互相打拍
          tone(c, 205, 201, 0.22, 0.36);
        } else if (kind === 'done') {
          tone(c, 523.25, 523.25, 0.20, 0.42, 0);    // C5
          tone(c, 659.25, 659.25, 0.20, 0.40, 0.09); // E5
          tone(c, 783.99, 783.99, 0.34, 0.38, 0.18); // G5
        } else if (kind === 'ntOn' || kind === 'ntOff') {
          /* 候选笔记：纸笔的「嗒」，比落子轻、比落子高，短到 40~50ms。
             记上 = 高一点（1200Hz），划掉 = 低一点（930Hz），一耳朵就能分清做了哪个动作。 */
          var hi = kind === 'ntOn';
          tone(c, hi ? 1200 : 930, hi ? 1120 : 880, 0.045, hi ? 0.54 : 0.44);
          tone(c, hi ? 2400 : 1860, 0, 0.02, 0.12);  // 泛音：纸面的「沙」
        } else if (kind === 'open' || kind === 'close') {
          /* 弹层开合（2026-10-31 用户反馈「每日挑战好像没有音效」）：
             比落子和笔记都轻，只在「界面动了一下」这件事上给一记回应。
             开 = 往上挑一点（1120→1060，收尾还是下滑，保持木头味），关 = 明显下行。 */
          if (kind === 'open') {
            tone(c, 1120, 1060, 0.05, 0.30);
            tone(c, 2240, 0, 0.018, 0.08);
          } else {
            tone(c, 1000, 820, 0.06, 0.24);
          }
        } else if (kind === 'start') {
          /* 开一局：两音上行（C6→G6），比通关的 C5-E5-G5 更短更轻 ——
             要让人听见「开始了」，不能听着像「做完了」。 */
          tone(c, 1046.5, 1046.5, 0.08, 0.32, 0);
          tone(c, 1568.0, 1568.0, 0.11, 0.24, 0.075);
        }
      } catch (e) {}
    }

    function set(v) { on = !!v; LS.set('sd.sfx', on); }
    function isOn() { return on; }
    function toggle() { set(!on); return on; }
    return { play: play, set: set, on: isOn, toggle: toggle, warm: ac };
  })();

  /* 首次用户交互解锁音频（浏览器自动播放策略要求）。
     只解锁一次：任何一种交互发生后即摘掉三个监听，之后不再插手。 */
  (function () {
    function unlock() {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
      document.removeEventListener('touchstart', unlock, true);
      Sfx.warm();
    }
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    document.addEventListener('touchstart', unlock, true);

    /* 常驻唤醒（不摘）：iOS 切后台/锁屏会把 AudioContext 挂起，回来后第一次点按要等
       resume 落地才出声，听感就是「慢半拍」。在触摸阶段就先唤醒一次，等 click 真正
       触发音效时上下文已经 running —— 只做一次 state 判断，没有额外开销。 */
    function keepAwake() { try { Sfx.warm(); } catch (e) {} }
    document.addEventListener('touchstart', keepAwake, { passive: true, capture: true });
    document.addEventListener('pointerdown', keepAwake, { passive: true, capture: true });
    if (document.addEventListener) document.addEventListener('visibilitychange', function () {
      if (!document.hidden) keepAwake();
    }, false);
  })();

  /* ---------------- 账号（Demo 本地账号） ----------------
     正式版走微信一键登录 + 服务端存档；Demo 里用本地账号模拟「每个玩家自己的进度」：
     注册/登录后，技巧解锁、卡点本、拼图收集、做题记录都按账号隔离保存；
     出题顺序也按账号各自洗牌 —— 不同的人看到的题不一样，做过的不再重复出。 */
  var ACC = { name: '' };   // 当前账号名（'' = 游客，沿用旧存储键，兼容老数据）
  function ukey(k) { return ACC.name ? 'sd.u.' + ACC.name + '.' + k.slice(3) : k; }
  function hashPwd(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
  function shuffled(n) {
    var a = [], i; for (i = 0; i < n; i++) a.push(i);
    for (var j = n - 1; j > 0; j--) { var k = Math.floor(Math.random() * (j + 1)), t = a[j]; a[j] = a[k]; a[k] = t; }
    return a;
  }
  /* 出题池：按账号各自洗牌的顺序，跳过「做过的」题（完成 / 进行中 / 放弃都算）；
     全部做完 → 重洗一轮并清空该档记录与「已完成」，开始新一轮 */
  function pickPuzzle(tierKey, listLen) {
    var ord = LS.get(ukey('sd.ord'), {});
    var o = ord[tierKey];
    if (!Array.isArray(o) || o.length !== listLen) { o = shuffled(listLen); ord[tierKey] = o; LS.set(ukey('sd.ord'), ord); }
    var done = LS.get(ukey('sd.done'), {});
    var d = done[tierKey] || [];
    var recs = getRecords(), attempted = {};
    for (var k in recs) if (recs[k].tier === tierKey) attempted[recs[k].idx] = 1;
    for (var i = 0; i < o.length; i++) if (d.indexOf(o[i]) < 0 && !attempted[o[i]]) return o[i];
    o = shuffled(listLen); ord[tierKey] = o; LS.set(ukey('sd.ord'), ord);
    done[tierKey] = []; LS.set(ukey('sd.done'), done);
    var r2 = getRecords(); for (var k2 in r2) if (r2[k2].tier === tierKey) delete r2[k2]; setRecords(r2);
    toast('这一档已经刷完一轮，重新洗题开始');
    return o[0];
  }
  function markDone(tierKey, puzIdx) {
    var done = LS.get(ukey('sd.done'), {});
    var d = done[tierKey] || [];
    if (d.indexOf(puzIdx) < 0) { d.push(puzIdx); done[tierKey] = d; LS.set(ukey('sd.done'), done); }
  }

  /* ---------------- 做题记录：所有做过的题（完成 / 进行中 / 放弃）都留痕，按账号隔离 ----------------
     原本只有「已完成」进 sd.done 并被排除；现在扩展到「所有做过的」，并多一个「已做」界面可回看 / 续做。 */
  function recKey(tk, idx) { return tk + ':' + idx; }
  function getRecords() { return LS.get(ukey('sd.records'), {}) || {}; }
  function setRecords(r) { LS.set(ukey('sd.records'), r); }
  function getRecord(id) { return getRecords()[id] || null; }
  /* 上次没下完的那局（2026-10-30）：启动时用来「接着上次」。
     取最近一条 status==='progress'、**至少落过一手**、且带盘面的记录。
     为什么需要它：以前 boot 一律 newGame(上次难度) 随机换一题，顺手把上一条进行中
     标成「放弃」—— 进度其实一直存在 sd.records 里，只是没人去「已做」页手动续，
     用户看到的就是「退出就没了」。
     为什么要求 moves>0：只是打开看一眼就退出的话不该被算作「没下完」，
     否则每次进小工具都困在同一题、换题只能手动点「换一题」。 */
  function lastProgressRecord() {
    var r = getRecords(), best = null;
    for (var k in r) {
      var x = r[k];
      if (!x || x.status !== 'progress' || !x.grid || x.idx == null) continue;
      if (!((x.moves || 0) > 0)) continue;
      if (!best || (x.updatedAt || 0) > (best.updatedAt || 0)) best = x;
    }
    return best;
  }
  function filledCount() { var n = 0; for (var i = 0; i < 81; i++) if (S.grid[i]) n++; return n; }
  function delRecord(id) {
    var r = getRecords(); if (!r[id]) return;
    var t = r[id].tier, i = r[id].idx; delete r[id]; setRecords(r);
    var d = LS.get(ukey('sd.done'), {});                 // 一并从「已完成」里摘掉，让该题重新可被随机出到
    if (d[t]) { var k = d[t].indexOf(i); if (k >= 0) { d[t].splice(k, 1); LS.set(ukey('sd.done'), d); } }
    updateRecBadge();
  }
  /* 开局时把上一条「进行中」的题标为「放弃」（若不是同一题）；当前题由 paint→syncActiveRecord 置回「进行中」 */
  function markPrevAbandon(curId) {
    var r = getRecords(); for (var k in r) if (k !== curId && r[k].status === 'progress') r[k].status = 'abandon';
    setRecords(r);
  }
  /* 每步落子后由 paint 调用：把当前题进度 / 用时 / 快照写进记录 */
  function syncActiveRecord() {
    if (!S.puzzle || S.view !== 'play' || S.tierKey == null || S.puzIdx == null) return;
    /* 草稿态绝不落盘：此时 S.grid 指向的是草稿副本，存进 localStorage
       等于把假设当成真实进度，退出后「已做」列表也会跟着错 */
    if (D.active) return;
    var id = recKey(S.tierKey, S.puzIdx), r = getRecords(), rec = r[id] || { id: id, tier: S.tierKey, idx: S.puzIdx, grade: S.grade, startedAt: Date.now() };
    rec.status = S.solved ? 'done' : 'progress';
    rec.filled = filledCount(); rec.total = 81; rec.time = S.elapsed; rec.updatedAt = Date.now();
    rec.moves = S.hist ? S.hist.length : 0;      // 落过几手：boot 只续「真的下过」的局
    rec.grid = S.grid.join(''); rec.notes = S.notes.join(',');
    r[id] = rec; setRecords(r); updateRecBadge();
  }
  /* 通关时把记录定为「完成」 */
  function markRecordDone(tierKey, idx) {
    var id = recKey(tierKey, idx), r = getRecords(), rec = r[id] || { id: id, tier: tierKey, idx: idx, grade: S.grade, startedAt: Date.now() };
    rec.status = 'done'; rec.filled = filledCount(); rec.total = 81; rec.time = S.elapsed; rec.updatedAt = Date.now();
    rec.moves = S.hist ? S.hist.length : 0;
    rec.grid = S.grid.join(''); rec.notes = S.notes.join(',');
    r[id] = rec; setRecords(r); updateRecBadge();
  }
  /* 从「已做」列表点开：进行中 / 放弃 → 续做（还原上次盘面）；完成 → 重玩（重新开局） */
  function openRecord(id) {
    var rec = getRecord(id); if (!rec) return;
    newGame(rec.tier, rec.idx);
    if (rec.status !== 'done' && rec.grid) {
      S.grid = (rec.grid + '').split('').map(Number);
      if (rec.notes) { var ns = (rec.notes + '').split(',').map(Number); if (ns.length === 81) S.notes = ns; }
      if (typeof rec.time === 'number') S.elapsed = rec.time;
      resetElim(); buildBoard(); paint(); updateStatus(); startTimer();
    }
    showView('play');
  }
  function updateRecBadge() {
    var all = getRecords(), n = Object.keys(all).length;
    var b = $('recBadge'); if (b) { b.hidden = n === 0; b.textContent = n > 99 ? '99+' : n; }
    var c = $('recCount'); if (c) c.textContent = n;
  }

  /* ---------------- 触屏能力检测（尽早执行，避免首屏闪一下桌面样式） ----------------
     为什么不用纯 CSS 媒体查询：@media (hover:none) / (pointer:coarse) 在部分安卓 WebView、
     混合输入设备（触摸屏笔记本）上不上报，样式会漏掉；JS 检测 + class 更可靠，也便于自动化验证。
       html.touch   —— 有触摸输入 → 放大触摸目标、把快捷键说明换成触屏说明
       html.nohover —— 没有悬停能力 → 清掉 hover 粘滞效果 */
  (function detectTouch() {
    var root = document.documentElement;
    var mm = window.matchMedia ? window.matchMedia.bind(window) : null;
    var hasTouch = (navigator.maxTouchPoints > 0) || ('ontouchstart' in window) ||
      !!(mm && mm('(pointer:coarse)').matches);
    var canHover = !!(mm && mm('(hover:hover)').matches);
    var wide = window.innerWidth > 900;
    // 触摸屏笔记本（宽屏 + 有鼠标）保留 hover 反馈，只放大触摸目标；手机 / 窄屏触摸设备清掉 hover
    var noHover = hasTouch && !(canHover && wide);
    if (hasTouch) root.classList.add('touch');
    if (noHover) root.classList.add('nohover');
  })();

  /* ---------------- 工具 ---------------- */
  function $(id) { return document.getElementById(id); }
  function clone(a) { return a.slice(0); }
  function two(n) { return (n < 10 ? '0' : '') + n; }
  function fmtTime(s) { return two(Math.floor(s / 60)) + ':' + two(s % 60); }
  function idx(r, c) { return r * 9 + c; }
  function parseCells(str) {
    var out = [], m, re = /R(\d)C(\d)/g;
    while ((m = re.exec(str))) out.push(idx(+m[1] - 1, +m[2] - 1));
    return out;
  }
  var toastT = null;
  function toast(msg) {
    var el = $('toast'); el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove('on'); }, 2000);
  }

  /* ---------------- 弹层栈：Esc / 点遮罩 / 返回手势 三条通道 ----------------
     记录体 {el, close, mask}；三条通道都走 modalCloseTop()，只关栈顶一层。
     完成弹窗 mask:false —— 点遮罩不关，防手滑丢掉结算画面（只留按钮和 Esc）。
     历史里只维持一条「哨兵」条目：栈 0→1 压入，1→0 收回；手机返回键因此是
     逐层退，而不是一按就退出整页。 */
  var MStack = [], mSelfBack = 0, mClosing = false;

  function mFind(el) {
    for (var i = MStack.length - 1; i >= 0; i--) if (MStack[i].el === el) return i;
    return -1;
  }
  function mUnpush() { try { mSelfBack++; history.back(); } catch (e) { mSelfBack--; } }
  function mPush() { try { history.pushState({ sdModal: 1 }, ''); } catch (e) {} }

  /* K-3：弹层的无障碍语义与焦点管理（role=dialog / aria-modal / 移入 / 归还） */
  function mFocusables(el) {
    var list = el.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
    return Array.prototype.filter.call(list, function (n) {
      return n.offsetWidth > 0 || n.offsetHeight > 0 || n === document.activeElement;
    });
  }
  function mFocusIn(el) {
    if (!el || el.hidden || el.contains(document.activeElement)) return;
    var t = el.querySelector('.dfoot .btn.pri') || el.querySelector('.box button:not([disabled])') ||
            el.querySelector('.dwhead button') || mFocusables(el)[0];
    if (!t) { el.setAttribute('tabindex', '-1'); t = el; }
    try { t.focus({ preventScroll: true }); } catch (e) { try { t.focus(); } catch (e2) {} }
  }
  function mRestore(rec) {
    var p = rec && rec.prev;
    if (!p || p === document.body || p === document.documentElement) return;
    if (!document.contains(p)) return;
    try { p.focus({ preventScroll: true }); } catch (e) {}
  }

  function modalOpen(el, closeFn, opt) {
    if (!el || mFind(el) >= 0) return;
    var empty = !MStack.length;
    var rec = {
      el: el,
      close: closeFn || function () { el.hidden = true; },
      mask: !(opt && opt.mask === false),
      prev: document.activeElement
    };
    MStack.push(rec);
    /* K-3：凡是进栈的都是模态层 —— 补语义，并把焦点移进去（已经在里面就不抢） */
    if (!el.hasAttribute('role')) el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
      var hd = el.querySelector('.dwhead b, .box h2, h2, .hp-hd b');
      var nm = hd ? hd.textContent.replace(/\s+/g, ' ').trim() : '';
      el.setAttribute('aria-label', nm || '对话框');
    }
    setTimeout(function () { mFocusIn(el); }, 60);
    if (rec.mask && !el.__sdMask) {          /* 遮罩通道：点本体以外区域即关（只在栈顶生效） */
      el.__sdMask = 1;
      el.addEventListener('click', function (ev) {
        if (ev.target !== el) return;
        if (MStack.length && MStack[MStack.length - 1].el === el) modalCloseTop();
      });
    }
    if (empty) mPush();
  }

  function modalCloseTop(fromHistory) {
    if (!MStack.length) return false;
    var rec = MStack.pop();
    mClosing = true;
    try { rec.close(); } catch (e) {}
    mClosing = false;
    mRestore(rec);                            /* K-3：焦点回到打开它的那个按钮 */
    if (!MStack.length) { if (!fromHistory) mUnpush(); }
    else if (fromHistory) mPush();           /* 退掉一层后补回哨兵，保证还能继续逐层退 */
    return true;
  }

  /* 被别的逻辑关掉时（切页 / 登录成功 / 采纳提示）同步摘掉记录，别留死层 */
  function mSync(el) {
    var i = mFind(el); if (i < 0) return;
    var rec = MStack[i];
    MStack.splice(i, 1);
    mRestore(rec);
    if (!MStack.length && !mClosing) mUnpush();
  }

  window.addEventListener('popstate', function () {
    if (mSelfBack > 0) { mSelfBack--; return; }   /* 自己补的那次 back，忽略 */
    if (MStack.length) modalCloseTop(true);
  });

  /* ---------------- 引擎候选状态 ----------------
     说明：L3 及以上的「排除类」技巧，结论必须累积在候选状态里才有意义。
     每次从盘面重算候选 = 忘掉之前所有排除 = 永远卡在同一条排除提示上。
     所以这里维护一份 elim 掩码，叠在「由盘面推出的基础候选」之上。 */
  function refreshCands() {
    var base = E.initCandidates(S.grid);
    S.cands = new Int16Array(81);
    for (var i = 0; i < 81; i++)
      S.cands[i] = S.grid[i] ? 0 : (base[i] & ~S.elim[i]);
  }
  function resetElim() { S.elim = new Array(81).fill(0); refreshCands(); }

  /* ---------------- 建棋盘 ---------------- */
  function buildBoard() {
    var board = $('board'); board.innerHTML = ''; cells = []; refs = []; boxCls = [];
    /* J-B1 无障碍：棋盘是一张 9×9 网格，读屏按 grid/gridcell 播报；
       棋盘整体只占一个 Tab 位，进入后用方向键选格（不塞 81 个 Tab 位）。 */
    board.setAttribute('role', 'grid');
    board.setAttribute('aria-label', '数独棋盘，9 行 9 列，用方向键选格，数字键填数');
    board.setAttribute('tabindex', '0');
    for (var i = 0; i < 81; i++) {
      var r = Math.floor(i / 9), c = i % 9;
      var cls = '';
      if (c === 2 || c === 5) cls += ' c3';
      if (r === 2 || r === 5) cls += ' r3';
      if (r === 8) cls += ' b3';
      boxCls[i] = cls;

      var el = document.createElement('div');
      el.className = 'cell' + cls;
      el.dataset.i = i;
      el.setAttribute('role', 'gridcell');
      el.setAttribute('tabindex', '-1');
      el.setAttribute('aria-rowindex', r + 1);
      el.setAttribute('aria-colindex', c + 1);
      var v = document.createElement('span'); v.className = 'v';
      var nd = document.createElement('div'); nd.className = 'notes';
      var spans = [];
      for (var d = 1; d <= 9; d++) { var sp = document.createElement('span'); nd.appendChild(sp); spans.push(sp); }
      var gh = document.createElement('span'); gh.className = 'ghost';
      var gd = document.createElement('span'); gd.className = 'ghostdel';
      var or = document.createElement('span'); or.className = 'order';
      el.appendChild(nd); el.appendChild(v); el.appendChild(gh); el.appendChild(gd); el.appendChild(or);

      (function (ii) {
        el.addEventListener('click', function () { onCell(ii); });
      })(i);

      board.appendChild(el);
      cells.push(el);
      refs.push({ v: v, box: nd, notes: spans, ghost: gh, gdel: gd, order: or });
    }
    /* 键盘用户 Tab 进棋盘时给一个起点，否则焦点到了但没格子选中，方向键才现选 */
    board.addEventListener('focus', function () {
      if (S.sel < 0) { S.sel = 0; if (S.grid[0]) S.curDigit = S.grid[0]; paint(); }
    });
  }

  /* ---------------- 键盘：两行并存 ----------------
     上行（大字 + 实底）= 填「确定数」，下行（小字 + 淡底虚线）= 记「候选笔记」。
     不再有「笔记模式」开关 —— 点哪一行就是哪种操作，一眼可辨。 */
  function makeDigitKey(d, isNote) {
    var b = document.createElement('button');
    b.className = 'key ' + (isNote ? 'nt' : 'dg');
    b.type = 'button';
    b.dataset.digit = d;
    b.dataset.kind = isNote ? 'note' : 'val';
    /* J-B1：键盘键给读屏一个明确动作，而不是只念一个数字 */
    b.setAttribute('aria-label', isNote ? ('记候选 ' + d) : ('填入 ' + d));
    b.innerHTML = String(d) + '<span class="sub"></span>';
    b.addEventListener('click', function () { put(d, isNote); });
    return b;
  }

  /* 手绘描边小图标（去 emoji 化） */
  var FL = '<svg class="icf" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 Q14.8 6.8 16.2 9.3 Q18 12.5 16.6 15.5 Q15.2 18.4 12 19.5 Q8.8 18.4 7.4 15.5 Q6 12.5 7.8 9.3 Q8.7 7.7 9.8 6.3 Q10 8.2 11.2 9 Q10.9 6 12 3.5 Z"/></svg>';
  var STARS = '<svg class="stw" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 L14.3 9.2 L20.5 9.6 L15.7 13.5 L17.3 19.5 L12 16.2 L6.7 19.5 L8.3 13.5 L3.5 9.6 L9.7 9.2 Z"/></svg>';
  var PZT = '<svg class="pzt-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 5.5 H9 Q8.5 3 11 3 Q13.5 3 13 5.5 H15.5 Q17 5.5 17 7 V9.5 Q19.5 9 19.5 11.5 Q19.5 14 17 13.5 V16 Q17 17.5 15.5 17.5 H7 Q5.5 17.5 5.5 16 V13.5 Q3 14 3 11.5 Q3 9 5.5 9.5 V7 Q5.5 5.5 6.5 5.5 Z"/></svg>';

  function buildPad() {
    var pad = $('pad'); pad.innerHTML = '';

    function row(cls, labelText, groupName) {
      if (labelText) {
        var lb = document.createElement('div');
        lb.className = 'rowlabel';
        lb.innerHTML = '<span>' + labelText + '</span>';
        pad.appendChild(lb);
      }
      var r = document.createElement('div');
      r.className = 'row ' + cls;
      if (groupName) {                       /* K-3：键盘分三组，读屏能听出「这一组是什么键」 */
        r.setAttribute('role', 'group');
        r.setAttribute('aria-label', groupName);
      }
      pad.appendChild(r);
      return r;
    }

    /* K-3：DOM 顺序改成 填写 → 工具 → 笔记（Tab 走位＝桌面视觉顺序）；
       手机上工具排本来就靠 .row.fn{order:-1} 提到最前，桌面靠 order 规则，
       两种视觉都不受影响，只有 Tab 顺序变了。 */
    var r1 = row('dg', '确定数 · 点一下填进去', '填写数字键，1 到 9，点一下把数字填进当前格');
    var r3 = row('fn', null, '工具键：提示、擦除、撤销、重置笔记、聚焦');
    var r2 = row('nt', '候选笔记 · 点一下记/取消', '笔记候选键，1 到 9，点一下在格子里记或取消这个小数字');
    for (var d = 1; d <= 9; d++) { r1.appendChild(makeDigitKey(d, false)); r2.appendChild(makeDigitKey(d, true)); }

    [
      { id: 'hint', label: '<svg class="kb-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 Q16.3 3.5 16.3 8.2 Q16.3 10.8 14.4 12.5 Q13.4 13.4 13.4 14.8 H10.6 Q10.6 13.4 9.6 12.5 Q7.7 10.8 7.7 8.2 Q7.7 3.5 12 3.5 Z M10.4 17.4 H13.6 M11 19.8 H13"/></svg>', sub: '提示' },
      { id: 'erase', label: '⌫', sub: '擦除' },
      { id: 'undo', label: '↶', sub: '撤销' },
      { id: 'auto', label: '⋯', sub: '重置笔记' },
      { id: 'focus', label: '◎', sub: '聚焦' }
    ].forEach(function (df) {
      var b = document.createElement('button');
      b.className = 'key fn'; b.id = 'key-' + df.id;
      b.type = 'button';
      b.setAttribute('aria-label', df.sub);       /* J-B1：功能键只念图标上的字看不清，补可读名 */
      b.innerHTML = df.label + '<span class="sub">' + df.sub + '</span>';
      b.addEventListener('click', function () { fnKey(df.id); });
      r3.appendChild(b);
    });
  }

  function fnKey(id) {
    if (id === 'hint') return doHint();
    if (id === 'erase') return erase();
    if (id === 'undo') return undo();
    if (id === 'auto') return autoNotes();
    if (id === 'focus') return toggleFocus();
  }

  function toggleFocus() {
    S.focus = !S.focus;
    var kf = $('key-focus');
    if (kf) kf.classList.toggle('on', S.focus);
    var mb = $('btnFocus');
    if (mb) { mb.setAttribute('aria-pressed', S.focus ? 'true' : 'false'); mb.textContent = '聚焦 ' + (S.focus ? '开' : '关'); }
    paint();
    toast(S.focus ? '聚焦：其他格子变灰，专心想当前这一格' : '已退出聚焦');
  }

  function toggleTip() {
    S.autoTip = !S.autoTip;
    var t = $('btnTip');
    if (t) t.setAttribute('aria-pressed', S.autoTip ? 'true' : 'false');
    paint();
    toast(S.autoTip ? '已开启「全盘自明」：所有一眼格直接亮答案（偷懒模式）'
                    : '已关闭：棋盘不冒答案，键盘只在「行/列/宫 9 差 1」时亮缺的数');
  }

  /* ---------------- 自明必填：唯一余数 / 隐性唯一 ----------------
     用户诉求：一横、一竖、或一个小九宫格只剩一个数时，直接把答案亮出来，
     其他格变灰（聚焦模式下）。这里只用「当前盘面 + 候选」做最基础的两类判定，
     不涉及任何高阶技巧 —— 对玩家而言这就是「一眼看得出」的那一步。 */
  function findMust(base) {
    var out = {}, i, d, k, u;
    // ① 唯一余数：这一格只剩一个候选
    for (i = 0; i < 81; i++) {
      if (S.grid[i]) continue;
      var n = 0, last = 0;
      for (d = 1; d <= 9; d++) if (base[i] & E.V(d)) { n++; last = d; }
      if (n === 1) out[i] = last;
    }
    // ② 隐性唯一：某数字在这一行/列/宫只剩一个格子放得下
    for (u = 0; u < E.UNITS.length; u++) {
      var cs = E.UNITS[u].cells;
      for (d = 1; d <= 9; d++) {
        var cnt = 0, spot = -1, placed = false;
        for (k = 0; k < cs.length; k++) {
          var ci = cs[k];
          if (S.grid[ci] === d) { placed = true; break; }
          if (!S.grid[ci] && (base[ci] & E.V(d))) { cnt++; spot = ci; }
        }
        if (placed || cnt !== 1) continue;
        if (out[spot] != null && out[spot] !== d) continue;   // 冲突（盘面有误）时不提示
        out[spot] = d;
      }
    }
    return out;
  }

  /* ---------------- 新局 ---------------- */
  function newGame(tierKey, puzIdx) {
    if (D.active) draftExit(true);      // 换题 / 切难度 / 从「已做」续做：先悄悄退掉草稿
    var t = null;
    for (var i = 0; i < BANK.tiers.length; i++) if (BANK.tiers[i].key === tierKey) t = BANK.tiers[i];
    if (!t) t = BANK.tiers[0];
    var list = t.puzzles;
    if (puzIdx == null) puzIdx = pickPuzzle(t.key, list.length);   // 按账号自己的出题池：跳过做过的
    var p = list[puzIdx % list.length];

    S.tierKey = t.key; S.tier = t; S.puzIdx = puzIdx % list.length;
    S.tierIdx = BANK.tiers.indexOf(t);
    S.puzzle = p.g.split('').map(Number);
    S.sol = p.sol.split('').map(Number);
    S.grid = clone(S.puzzle);
    S.given = S.puzzle.map(function (x) { return x > 0; });
    S.notes = new Array(81).fill(0);
    S.notesAuto = false; S.notesSnap = null; autoNotesLabel(false);
    S.sel = -1; S.hist = []; S.elapsed = 0; S.paused = false;
    S.mistakes = 0; S.hints = 0; S.hintCost = 0; S.used = {}; S.solved = false;
    S.combo = 0;                                   // 换新题，连击重新起算
    S.curDigit = 0; S.hint = null; S.hintSeq = [];
    S.stuckAt = Date.now();
    S.daily = null;                                // 每日挑战标记：只有从「每日挑战」入口开局才置值
    S.chal = null;                                 // 挑战链接标记（指令 10）
    var _cb = $('chalBanner'); if (_cb) _cb.remove();
    document.getElementById('view-play').classList.remove('haschal');
    $('pad').classList.remove('locked');
    $('board').style.visibility = 'visible';
    S.grade = p.grade; S.steps = p.steps; S.clues = p.clues;
    markPrevAbandon(recKey(S.tierKey, S.puzIdx));   // 把上一条「进行中」的题记成「放弃」
    resetElim();

    buildBoard();
    renderTiers();
    clearHint(true);
    paint();
    updateStatus();
    startTimer();
    $('btnApply').hidden = true;
    $('hintNext').hidden = true;
  }

  /* 按历史表现推荐档位：取「已通关 ≥3 题的最难一档」的下一档；全新玩家 → 入门。
     依据 playtest 结论：小白在中等以上档挫败感明显，应从低档循序渐进。 */
  function tierProgress() {
    var done = LS.get(ukey('sd.done'), {}), map = {};
    BANK.tiers.forEach(function (t) { map[t.key] = (done[t.key] || []).length; });
    return map;
  }
  function suggestTierKey() {
    var map = tierProgress(), last = -1;
    BANK.tiers.forEach(function (t, i) { if ((map[t.key] || 0) >= 3) last = i; });
    if (last < 0) return BANK.tiers[0].key;
    return BANK.tiers[Math.min(last + 1, BANK.tiers.length - 1)].key;
  }
  function totalDone() {
    var d = LS.get(ukey('sd.done'), {}), n = 0;
    for (var k in d) n += (d[k] || []).length;
    return n;
  }
  /* 新手引导条：只在「一道题都没通关过、且没手动关掉」时出现 */
  function showNewbie() {
    var el = $('newbie'); if (!el) return;
    el.hidden = !(totalDone() === 0 && !LS.get(ukey('sd.seen'), 0));
    if (!el.hidden) {
      modalOpen(el, function () { LS.set(ukey('sd.seen'), 1); el.hidden = true; });
    }
  }

  function renderTiers() {
    var box = $('tiers'); box.innerHTML = '';
    var rec = suggestTierKey();
    BANK.tiers.forEach(function (t) {
      var b = document.createElement('button');
      b.className = 'tier' + (t.key === rec ? ' rec' : '');
      b.setAttribute('aria-pressed', t.key === S.tierKey ? 'true' : 'false');
      var lvs = t.puzzles.map(function (p) { return p.grade; });
      var mx = Math.max.apply(null, lvs);
      b.innerHTML = t.name + '<span class="lv">L' + mx + '</span>' +
        (t.key === rec ? '<span class="recb">推荐</span>' : '');
      b.title = t.blurb + (t.key === rec ? '（根据你的进度推荐）' : '');
      b.addEventListener('click', function () { newGame(t.key, null); });
      box.appendChild(b);
    });
    showNewbie();
  }

  /* ---------------- 计时 ---------------- */
  function startTimer() {
    clearInterval(S.tick);
    S.tick = setInterval(function () {
      if (S.paused || S.solved) return;
      if (D.active) return;                      // 草稿推演时间不计入本局用时
      S.elapsed++; updateStatus();
    }, 1000);
  }
  function togglePause() {
    if (S.solved) return;
    if (D.active) { toast('草稿推演中不能暂停 —— 直接填就行，填错也不会算错误'); return; }
    S.paused = !S.paused;
    $('board').style.visibility = S.paused ? 'hidden' : 'visible';
    $('pad').classList.toggle('locked', S.paused);
    paint();
    toast(S.paused ? '已暂停（空格继续）' : '继续');
  }

  /* ---------------- 状态渲染 ---------------- */
  function findConflicts() {
    var bad = {};
    for (var i = 0; i < 81; i++) {
      var v = S.grid[i];
      if (!v) continue;
      var p = E.PEERS[i];
      for (var k = 0; k < p.length; k++) if (S.grid[p[k]] === v) { bad[i] = 1; bad[p[k]] = 1; }
    }
    return bad;
  }

  function paint() {
    fitBoard();                      // 单屏锁定：每次重绘前校准棋盘尺寸（内部有缓存，不改尺寸时零开销）
    var conflict = findConflicts();
    var selV = S.sel >= 0 ? S.grid[S.sel] : 0;
    var peers = S.sel >= 0 ? E.PEERS[S.sel] : null;
    var seq = {}; S.hintSeq.forEach(function (c, n) { seq[c] = n + 1; });
    // 「依据单元」整组染色：L3 区块摒除 / L4 数对等排除类提示，把推理所依据的整条线/整宫
    // 一起淡淡染色（引擎 step.unit 给出单元格子），玩家一眼看清「结论是从哪一整块推出来的」
    var hunit = {}, hfocus = {};
    if (S.hint && S.hint.unit) S.hint.unit.forEach(function (c) { if (c !== S.hint.i) hunit[c] = 1; });
    if (S.hint && S.hint.focus) S.hint.focus.forEach(function (c) { if (c !== S.hint.i) hfocus[c] = 1; });

    // 自明必填：仅在盘面无冲突、且未解完时计算（有错时算出来的没意义）
    // 计数始终反映盘面事实（状态栏要能一直看到「还有几格一眼可填」），
    // 开关只决定「画不画幽灵数字 / 上不上高亮」。
    var noErr = !S.solved && !D.active && !Object.keys(conflict).length;
    var candBase = noErr ? E.initCandidates(S.grid) : null;
    var mustAll = noErr ? findMust(candBase) : {};
    S.mustN = Object.keys(mustAll).length;
    // 棋盘幽灵答案只存在于「全盘自明」模式（用户主动点开的偷懒模式）。
    // 默认模式棋盘上绝不冒答案 —— 点一下空格就蹦答案等于替玩家做题（用户明确反感）。
    var must = S.autoTip ? mustAll : {};
    // 键盘提示（最保守一档）：仅当选中空格所在的「某一行 / 某一列 / 某一宫」已填 8 个数
    // （9 差 1）→ 缺的那个数直接亮绿、其余键淡出。其余任何情况键盘都不给答案。
    S.mustSel = 0;
    if (noErr && S.sel >= 0 && !S.grid[S.sel]) {
      var sr = (S.sel / 9) | 0, sc = S.sel % 9;
      var unitAt = [
        function (k) { return sr * 9 + k; },                                    // 所在行
        function (k) { return k * 9 + sc; },                                    // 所在列
        function (k) { var br = sr - sr % 3, bc = sc - sc % 3;                  // 所在宫
                       return (br + ((k / 3) | 0)) * 9 + bc + (k % 3); }
      ];
      for (var ui = 0; ui < 3 && !S.mustSel; ui++) {
        var empties = 0, sum = 0;
        for (var k = 0; k < 9; k++) {
          var v2 = S.grid[unitAt[ui](k)];
          sum += v2;
          if (!v2) empties++;
        }
        if (empties === 1) S.mustSel = 45 - sum;   // 1..9 总和 45，缺数 = 45 - 已填和
      }
    }
    // 视觉强度分级（仅全盘自明模式有意义）：格子少 → 脉冲吸引；一大片 → 淡显
    var mustLv = S.mustN <= 6 ? 2 : (S.mustN <= 14 ? 1 : 0);

    // 当前「关注数字」：优先选中格的值，其次用户刚在键盘上点过的数字
    var hiDigit = selV || S.curDigit || 0;

    for (var i = 0; i < 81; i++) {
      var el = cells[i], R = refs[i], v = S.grid[i];
      var cls = 'cell' + boxCls[i];
      if (v) {
        if (S.given[i]) cls += ' given'; else cls += ' user';
        if (!D.active && S.autoCheck && v !== S.sol[i]) cls += ' err';
      }
      /* 冲突染红也归「纠错」管：纸上模式下一律不染 —— 同行同列同宫重了数也不告诉，
         全凭自己核对（这是纸上模式的核心承诺，别为了「好心」把它加回来）。 */
      if (!D.active && S.autoCheck && conflict[i]) cls += ' err';
      /* 草稿态：假设数单独上色；矛盾格（重数 / 候选被清空）单独标灰叉 */
      if (D.active) {
        if (v && !D.frz[i]) cls += ' dnew';
        if (D.bad[i]) cls += ' dbad';
        if (D.anchor && D.anchor.i === i) cls += ' danchor';
      }
      if (peers && peers.indexOf(i) >= 0) cls += ' peer';
      if (hiDigit && v === hiDigit && i !== S.sel) cls += ' same';
      if (must[i] != null && !v) cls += ' must m' + mustLv;
      if (i === S.sel) cls += ' sel';
      if (S.hint) {
        if (i === S.hint.i) cls += ' hdst';
        else if (seq[i]) cls += ' hsrc';
        else if (hfocus[i]) cls += ' hfocus';
        else if (hunit[i]) cls += ' hunit';
      }
      el.className = cls;

      /* J-B1 无障碍：每格都有一句可读标签 —— 「第3行第5列，题目给定 4」「第1行第2列，空格，候选 3 7」 */
      var _r = ((i / 9) | 0) + 1, _c = i % 9 + 1;
      var _lab = '第' + _r + '行第' + _c + '列，';
      if (v) {
        _lab += (S.given[i] ? '题目给定 ' : ((D.active && D.frz[i]) ? '盘面已有 ' : '你填的 ')) + v;
        if (D.active && !D.frz[i]) _lab += '（草稿假设）';
      } else if (S.notes[i]) {
        var _ns = [];
        for (var _d = 1; _d <= 9; _d++) if (S.notes[i] & E.V(_d)) _ns.push(_d);
        _lab += '空格，候选 ' + _ns.join(' ');
      } else { _lab += '空格'; }
      if (i === S.sel) _lab += '，已选中';
      el.setAttribute('aria-label', _lab);
      el.setAttribute('aria-selected', i === S.sel ? 'true' : 'false');

      R.v.textContent = v ? String(v) : '';
      var showNotes = !v && S.notes[i];
      R.box.style.display = showNotes ? '' : 'none';
      // 始终重写 9 个候选位（即使整块隐藏）——否则擦干净后 DOM 里会残留旧数字
      for (var d = 1; d <= 9; d++) {
        var on = showNotes && (S.notes[i] & E.V(d)) !== 0;
        R.notes[d - 1].textContent = on ? String(d) : '';
        R.notes[d - 1].className = (on && d === hiDigit) ? 'hi' : '';
      }
      R.ghost.textContent = ''; R.gdel.textContent = ''; R.order.textContent = '';
      /* 草稿态的矛盾格：借 .order 这个常驻但隐藏的角标位画一个 ×，
         既不用改 DOM 结构，也不会和「候选笔记」的小数字撞脸 */
      if (D.active && D.bad[i]) R.order.textContent = '×';

      // 自明必填 → 用陶土色「幽灵数字」直接亮出答案（点一下即可填入）
      if (must[i] != null && !v) { R.ghost.textContent = String(must[i]); }

      if (S.hint) {
        if (S.hint.kind === 'place' && i === S.hint.i) { R.ghost.textContent = String(S.hint.v); }
        if (S.hint.kind === 'elim' && i === S.hint.i) {
          var sp = R.notes[S.hint.v - 1];
          if (sp && sp.textContent) sp.className = 'hit';
          else R.gdel.textContent = String(S.hint.v);
        }
        /* 2026-10-29：步骤序号不再画进格子里 —— 格角的小数字和候选笔记长得一样，
           玩家分不清「这是在指路」还是「这是我记的候选」。序号只留在提示卡的文字链里。 */
      }
    }
    $('board').classList.toggle('focus', !!S.focus && S.mustN > 0);
    /* 提示激活时压暗无关格子的笔记（样式里 .board.hinting）：
       满盘小数字里只留被标出来的那几格是清楚的，玩家才不会再问「这到底是提示还是我的笔记」 */
    $('board').classList.toggle('hinting', !!S.hint);
    updateKeys();
    updateStatus();
    syncActiveRecord();
  }

  /* 键盘状态：① 数字填满 9 个 → 变灰禁用 ② 当前动作高亮 ③ 剩余个数
     ④ 选中格只剩一个答案 → 该数字键亮绿凸显，其余键淡出（不用再心里数排除） */
  function updateKeys() {
    var used = {};
    for (var i = 0; i < 81; i++) if (S.grid[i]) used[S.grid[i]] = (used[S.grid[i]] || 0) + 1;

    var sel = S.sel >= 0 ? S.sel : -1;
    var ans = (sel >= 0 && !S.grid[sel] && !S.paused && !S.solved) ? (S.mustSel || 0) : 0;
    document.querySelectorAll('.pad .key[data-digit]').forEach(function (b) {
      var d = +b.dataset.digit, isNote = b.dataset.kind === 'note';
      var cnt = used[d] || 0;
      var full = cnt >= 9;                       // 4️⃣ 已填满 9 个 → 灰掉不可选
      b.classList.toggle('done', full);
      b.disabled = full || S.paused || S.solved;
      b.title = full ? ('数字 ' + d + ' 已经填满 9 个了') : '';

      var sub = b.querySelector('.sub');
      if (sub) sub.textContent = full ? '✓' : String(9 - cnt);

      /* J-B1：把「还剩几个」和禁用原因一起念出来，读屏用户才知道这个键现在能不能用 */
      var _act = isNote ? '记候选 ' : '填入 ';
      b.setAttribute('aria-label', _act + d +
        (full ? '，已填满不可用' : '，还剩 ' + (9 - cnt) + ' 个待填'));
      b.setAttribute('aria-disabled', (full || S.paused || S.solved) ? 'true' : 'false');

      var act = false;
      if (sel >= 0 && !S.given[sel]) {
        if (isNote) act = !S.grid[sel] && !!(S.notes[sel] & E.V(d));
        else act = S.grid[sel] === d;
      }
      // 答案键用「亮绿」独占注意力；其余键淡出。答案键上不再叠 act 高亮，避免蓝绿打架
      b.classList.toggle('ans', ans === d);
      b.classList.toggle('dim', !!ans && !full && d !== ans);
      b.classList.toggle('act', act && ans !== d);
    });
  }

  function updateStatus() {
    var filled = 0;
    for (var i = 0; i < 81; i++) if (S.grid[i]) filled++;
    $('stTime').textContent = fmtTime(S.elapsed);
    $('stErr').textContent = S.mistakes;
    $('stHint').textContent = S.hints;
    if ($('stHint').parentNode) $('stHint').parentNode.title =
      '已用 ' + S.hints + ' 次提示 · 累计消耗 ' + S.hintCost + ' 点（L1-2=1 点 / L3-5=2 点 / L6+=3 点）';
    $('stGrade').textContent = 'L' + S.grade;
    $('bar').style.width = (filled / 81 * 100).toFixed(1) + '%';
    var sm = $('stMust'); if (sm) sm.textContent = S.mustN;
    draftSync();                     // 草稿胶囊 / 棋盘虚线框跟着每次重绘走
  }

  /* ============================================================
     草稿盘（Draft board）—— 给「强制链」推演用
     ------------------------------------------------------------
     用户诉求：「推强制链要写大量假设草稿，一去涂改，原本的草稿就毁了」。
     做法：把当前盘面深拷贝成 D，之后所有填写只写 D；退出即回原盘 ——
     原盘那套数组（S.grid / notes / elim / hist）从头到尾一个字节都不动，
     所以不需要任何「备份 → 还原」逻辑（那套才是真会出错的地方）。

     三条铁律：
     ① 草稿里原盘已有的数字全部冻结，只能填空白格 —— 草稿永远是「原盘 + 假设」。
     ② 只报「逻辑矛盾」（重数 / 候选被清空 / 某单元缺某数却无处可放），
        绝不比对 S.sol。比对答案就是替玩家判对错，等于偷答案。
     ③ 草稿产出的一切（用时、错误数、连击、成绩记录、卡点本、结算）一律不落账。
     ============================================================ */
  var D = {
    active: false,
    grid: null, notes: null, hist: [],
    frz: null,          // 进入那刻盘面已填的格子（Int8Array，1=冻结）
    anchor: null,       // { i, v } 第一个假设落在哪
    bad: {},            // 格子级矛盾
    unitMsg: '',        // 单元级矛盾文案
    bak: null,          // 进入时备份的 S 字段（退出时原样接回）
    tExit: 0            // 退出二次确认的时间窗
  };

  /* 「第 N 步」= 盘上还剩几个假设数。从盘面直接数，撤销/擦除都自动跟上 */
  function draftSteps() {
    if (!D.active) return 0;
    var n = 0;
    for (var i = 0; i < 81; i++) if (S.grid[i] && !D.frz[i]) n++;
    return n;
  }

  /* 只做逻辑判定，永不读 S.sol —— 这是「不偷答案」的唯一实现点 */
  function draftCheck() {
    var bad = {}, i, d, u, k, g = S.grid;
    var dup = findConflicts();                                   // 同行 / 同列 / 同宫重数
    for (var q in dup) bad[q] = 1;
    var base = E.initCandidates(g);
    for (i = 0; i < 81; i++) if (!g[i] && !base[i]) bad[i] = 1;  // 候选被清空
    var msg = '';
    for (u = 0; u < E.UNITS.length && !msg; u++) {
      var cs = E.UNITS[u].cells;
      for (d = 1; d <= 9; d++) {
        var placed = false, spot = 0;
        for (k = 0; k < 9; k++) {
          var ci = cs[k];
          if (g[ci] === d) { placed = true; break; }
          if (!g[ci] && (base[ci] & E.V(d))) spot++;
        }
        if (!placed && spot === 0) {
          msg = E.unitName(u) + '缺 ' + d + '，却没有任何空格放得下'; break;
        }
      }
    }
    D.bad = bad; D.unitMsg = msg;
    draftFixAnchor();
    return { bad: bad, msg: msg };
  }

  /* 锚点必须始终指向「盘上还留着假设值的那一格」。
     撤销 / 擦除 / 再点一次取消 都可能把锚点那格清空 —— 不修的话会留下两个假象：
     ① 空心格上挂着一圈紫环；② 「回假设点」把已经被自己否掉的数又填回去。 */
  function draftFixAnchor() {
    if (D.anchor && S.grid[D.anchor.i] !== D.anchor.v) D.anchor = null;
    if (!D.anchor) {
      for (var i = 0; i < 81; i++) if (S.grid[i] && !D.frz[i]) { D.anchor = { i: i, v: S.grid[i] }; break; }
    }
  }

  /* 落下一个假设之后：查矛盾 → 直接给「这条假设成不成立」的结论 */
  function draftAfterPut(i, d) {
    var r = draftCheck(), at = E.cellName(i) + '=' + d;
    var dead = !!r.msg || Object.keys(r.bad).length > 0;
    if (dead) {
      toast('假设 ' + at + ' 推出矛盾（' + (r.msg || '有格子被逼到没数可填，或出现重数') +
            '）→ 所以 ' + E.cellName(i) + ' 不能是 ' + d);
      return;
    }
    var empty = 0;
    for (var k = 0; k < 81; k++) if (!S.grid[k]) empty++;
    if (!empty) toast('假设 ' + at + ' 一路填到解完了 → 这条假设成立');
  }

  function draftSync() {
    var bd = $('board'); if (bd) bd.classList.toggle('drafting', D.active);
    var ew = $('stErrWrap'); if (ew) ew.hidden = D.active;
    var sd = $('stDraft');
    if (sd) {
      sd.hidden = !D.active;
      var n = $('dfSteps'); if (n) n.textContent = draftSteps();
      var dead = D.active && (!!D.unitMsg || Object.keys(D.bad || {}).length > 0);
      sd.classList.toggle('dead', dead);
      sd.setAttribute('aria-label', D.active
        ? ('草稿推演中，已落 ' + draftSteps() + ' 个假设' + (dead ? '，已推出矛盾' : '') + '。点一下退出草稿')
        : '草稿');
    }
    var bm = $('btnDraftMini');
    if (bm) {
      var hasAnchor = D.active && D.anchor && draftSteps() > 1;
      bm.textContent = !D.active ? '开草稿' : (hasAnchor ? '回假设点' : '退草稿');
      bm.setAttribute('aria-pressed', D.active ? 'true' : 'false');
    }
    var hb = $('btnDraft');
    if (hb) hb.hidden = !(S.hint && S.hint.level >= 8) || D.active;
    /* 窄屏常驻「草稿」胶囊：进草稿后让位给 stDraft 步数胶囊，解完/暂停也不显示 */
    var dop = $('btnDraftOpen');
    if (dop) dop.hidden = !!D.active || !!S.solved;
  }

  function draftEnter() {
    if (D.active) { toast('已经在草稿里了'); return; }
    if (S.solved) { toast('这题已经解完了，不用再推'); return; }
    if (S.paused) { toast('先取消暂停'); return; }

    D.frz = new Int8Array(81);
    for (var i = 0; i < 81; i++) D.frz[i] = S.grid[i] ? 1 : 0;
    /* 只存引用，不复制：退出时把引用接回去，原盘一个字都没被改过 */
    D.bak = {
      grid: S.grid, notes: S.notes, elim: S.elim, hist: S.hist,
      combo: S.combo, curDigit: S.curDigit, notesAuto: S.notesAuto, notesSnap: S.notesSnap
    };
    D.grid = S.grid.slice(0); D.notes = S.notes.slice(0);
    D.hist = []; D.anchor = null; D.bad = {}; D.unitMsg = ''; D.tExit = 0;
    D.active = true;

    S.grid = D.grid; S.notes = D.notes; S.elim = new Array(81).fill(0); S.hist = D.hist;
    refreshCands();                       // 草稿自己的候选（推链要用）
    S.combo = 0; S.curDigit = 0; S.sel = -1;
    S.notesAuto = false; S.notesSnap = null; autoNotesLabel(false);
    clearHint(true); renderHintEmpty();
    draftSync(); paint();
    toast('草稿已开启：随便填、随便改，原盘面一格不动');
  }

  function draftExit(silent) {
    if (!D.active) return;
    var n = draftSteps();
    /* 二次确认（3 秒窗）：只在有假设时才拦一下，空草稿直接退 */
    if (!silent && n > 0 && Date.now() - D.tExit > 3000) {
      D.tExit = Date.now();
      toast('草稿里有 ' + n + ' 个假设，再点一次就丢掉（原盘面不会变）');
      return;
    }
    var b = D.bak;
    S.grid = b.grid; S.notes = b.notes; S.elim = b.elim; S.hist = b.hist;
    refreshCands();
    S.combo = b.combo; S.curDigit = 0; S.sel = -1;
    S.notesAuto = false; S.notesSnap = null; autoNotesLabel(false);
    S.hint = null; S.hintSeq = [];
    D.active = false; D.grid = D.notes = null; D.hist = [];
    D.frz = null; D.anchor = null; D.bad = {}; D.unitMsg = ''; D.bak = null; D.tExit = 0;
    clearHint(true); renderHintEmpty(); draftSync(); paint();
    if (!silent) toast(n > 0 ? '草稿已丢弃，回到原盘面（一格没变）' : '已退出草稿');
  }

  /* 回到假设点：清掉锚点之后的所有推演，只留第一个假设 */
  function draftAnchorBack() {
    if (!D.active) return;
    var a = D.anchor;
    if (!a) { toast('还没有落下假设'); return; }
    for (var i = 0; i < 81; i++) {
      if (D.frz[i]) continue;                 // 冻结格永远不动
      S.grid[i] = 0; S.notes[i] = 0;
    }
    S.grid[a.i] = a.v; S.notes[a.i] = 0;
    D.hist = []; S.hist = D.hist;
    resetElim(); draftCheck(); draftSync(); paint();
    toast('已回到假设点：只留下 ' + E.cellName(a.i) + '=' + a.v);
  }

  /* ---------------- 输入 ---------------- */
  function onCell(i) {
    if (S.paused) return;
    S.sel = i;
    // 2️⃣ 选中已填数字的格子 → 自动把它设为「关注数字」，同值 + 同行列宫一起亮
    if (S.grid[i]) S.curDigit = S.grid[i];
    paint();
  }

  function pushHist() {
    S.hist.push({ g: clone(S.grid), n: clone(S.notes) });
    if (S.hist.length > 200) S.hist.shift();
  }

  /* 连击彩头（指令 6）：只在 5 的倍数时报一句，绝不每子都弹，免得打断节奏。
     文案跟着棋馆的口吻走（笔锋 / 枰上 / 满座），不用「太棒啦」这类浮夸词。
     棋盘外框脉冲走 CSS class：加 → 200ms 动画 → 320ms 后摘掉。 */
  function comboPraise(n) {
    var msg = n === 5  ? '落子如飞，笔头未顿'
            : n === 10 ? '十子连珠，学园生辉'
            : n === 15 ? '十五子一气呵成，卷面生风'
            : n === 20 ? '二十子连下，满座皆静'
            : '连下 ' + n + ' 子，笔锋未钝';
    toast(msg);
    var b = $('board'); if (!b) return;
    b.classList.remove('cpulse');
    void b.offsetWidth;                          // 强制重排：同一 class 能连续触发第二次
    b.classList.add('cpulse');
    clearTimeout(S._cpT);
    S._cpT = setTimeout(function () { b.classList.remove('cpulse'); }, 320);
  }

  /* isNote=false：填确定数（上行大字键）
     isNote=true ：切换候选笔记（下行小字键） */
  function put(d, isNote) {
    if (S.paused || S.solved) return;
    var i = S.sel;
    if (i < 0) { toast('先点一个格子'); return; }
    /* 草稿态：原盘面已有的数（题目给定 + 你自己填的）全部冻结，只能填空白格。
       这条让草稿永远是「原盘 + 假设」，不会出现「我是不是把原盘的数改了」的怀疑。 */
    if (S.given[i]) { toast('这是题目给定的数字，不能改'); return; }
    if (D.active && D.frz[i]) { toast('草稿里原盘面已有的数不能改 —— 只能往空白格里填假设'); return; }
    /* 锁定（2026-10-31 用户要求）：纠错开着时已经填对的格子不再接受改动 ——
       防手滑把好不容易推对的数点掉。纠错关着时不锁：那里本来就不判对错，锁了等于泄底。
       想改已填对的格子：点「纠错 开」关掉它，或者用草稿盘推演。 */
    if (!D.active && lockedCell(i)) { toast('这一格已经填对了，不用再改（想改就先关掉纠错）'); return; }

    // 4️⃣ 该数字已经填满 9 个 → 不允许再填
    var used = 0;
    for (var q = 0; q < 81; q++) if (S.grid[q] === d) used++;
    if (used >= 9) { toast('数字 ' + d + ' 已经填满 9 个了'); return; }

    pushHist();
    if (isNote) {
      if (S.grid[i]) { toast('这一格已经填了确定数，先擦掉再记笔记'); S.hist.pop(); return; }
      S.notes[i] ^= E.V(d);
      /* 笔记音（2026-10-30 用户反馈「填写候选数没有音效」）：记上 / 划掉两种音高。
         位置放最早 —— 先响再做候选重算和重绘，别让一帧重绘把声音拖慢 */
      Sfx.play((S.notes[i] & E.V(d)) ? 'ntOn' : 'ntOff');
      // 玩家手动划掉/恢复笔记要同步进引擎候选（elim 掩码）：
      //  - 划掉 → 记入 elim：提示不会再让你重复划掉同一个数（否则引擎候选里它还在，同一提示反复出现）
      //  - 恢复 → 从 elim 撤销：提示允许再次引用这个候选
      if (S.notes[i] & E.V(d)) S.elim[i] &= ~E.V(d);
      else S.elim[i] |= E.V(d);
      refreshCands();
      // 记/取消笔记不触发全盘同值高亮（用户：笔记是候选推演，不是场上出现的数字）
      // → 清掉关注数字，盘面回到无联动状态，避免残留上一次确定数的高亮
      S.curDigit = 0;
    } else {
      if (S.grid[i] === d) {
        /* 再点一次=取消，算撤子。草稿里要重判：矛盾可能消失，锚点可能被取消掉 */
        S.grid[i] = 0; resetElim(); S.combo = 0;
        if (D.active) { draftCheck(); draftSync(); }
      }
      else {
        S.grid[i] = d; S.notes[i] = 0;
        var p = E.PEERS[i];
        for (var k = 0; k < p.length; k++) S.notes[p[k]] &= ~E.V(d);
        // 新增一个数字只会让盘面更受限，之前的排除结论依然成立 → 保留 elim
        refreshCands();
        if (D.active) {
          /* 草稿：一律中性落子音，绝不按「填得对不对」分音效 ——
             木鱼声一响就等于告诉玩家这条假设成不成立，比红框泄得更彻底 */
          Sfx.play('ok');
          if (!D.anchor) D.anchor = { i: i, v: d };
          draftAfterPut(i, d);
        } else {
          if (S.autoCheck && d !== S.sol[i]) {
            S.mistakes++;
            // 试错摩擦引导：连错 3 次仍未引导过 → 把提示语换成「改用候选笔记」的建议
            // （笔记不参与校验，随便记不会判错，比硬猜更稳）
            if (S.mistakes >= 3 && !S.coached) {
              S.coached = true;
              toast('又填错了 —— 别硬猜：用下方「候选笔记」把不可能的候选划掉，笔记不会被判错');
            } else {
              toast('这个数字和正确答案不一样');
            }
          }
          /* 反馈（指令 4/5）：填对一声木鱼；填错一声闷响 + 30ms 轻震。
             「纠错」关掉时不能拿声音替玩家判对错 —— 那时一律给中性落子音，
             否则「有声音=对、没声音=错」比红框泄得更彻底。
             纸上模式同理：连击计数和「五连击表扬」也得停 —— 那也是一条对错信号。 */
          if (!S.autoCheck) {
            S.combo = 0;
            Sfx.play('ok');
          } else if (d === S.sol[i]) {
            S.combo++;
            Sfx.play('ok');
            if (S.combo % 5 === 0) comboPraise(S.combo);
          } else {
            S.combo = 0;
            Sfx.play('err');
          }
        }
      }
    }
    // 只有「填确定数」才联动全盘同值高亮
    if (!isNote) S.curDigit = d;
    exitAutoNotes();                 // 手动落子/改笔记 = 离开「自动补笔」状态
    S.stuckAt = Date.now();
    clearHint(true);
    paint();
    if (!D.active) checkDone();      // 草稿填满 ≠ 通关，绝不进结算
  }

  function erase() {
    if (S.paused || S.solved) return;
    var i = S.sel; if (i < 0) return;
    if (S.given[i]) { toast('题目给定的数字不能擦'); return; }
    if (D.active && D.frz[i]) { toast('草稿里原盘面已有的数不能擦'); return; }
    if (!D.active && lockedCell(i)) { toast('这一格已经填对了，不用擦（想改就先关掉纠错）'); return; }
    pushHist();
    exitAutoNotes();
    S.combo = 0;                                   // 擦除打断连击
    if (S.notes[i]) S.notes[i] = 0;
    else S.grid[i] = 0;
    resetElim();               // 擦除让盘面变宽松，旧排除可能不再成立 → 全部重来
    S.stuckAt = Date.now();
    if (D.active) { draftCheck(); draftSync(); }   // 擦掉之后矛盾可能消失，要重判
    clearHint(true); paint();
  }

  function undo() {
    if (S.paused) return;
    var h = S.hist.pop();
    if (!h) { toast('没有可撤销的操作'); return; }
    S.grid = h.g; S.notes = h.n; S.solved = false;
    exitAutoNotes();
    S.combo = 0;                                   // 撤销等于收回那一子，连击从头算
    resetElim();
    S.stuckAt = Date.now();
    if (D.active) { draftCheck(); draftSync(); }
    clearHint(true); paint();
  }

  /* 一键重置笔记 ⇄ 撤销重置（同一个键切换）：
     第一次点 = 清掉所有手写痕迹（含写错的笔记、划掉记录、提示排除），从盘面
     重算一份标准候选；再点一次 = 还原成重置前你自己的笔记（含 elim 掩码）。
     中途手动改笔记/填数字/撤销 → 视为离开「自动」状态，按钮复位，下次点重新补。 */
  function autoNotesLabel(on) {
    var b = $('key-auto'); if (!b) return;
    b.innerHTML = (on ? '⤺' : '⋯') + '<span class="sub">' + (on ? '撤销重置' : '重置笔记') + '</span>';
    b.classList.toggle('on', !!on);
  }
  function exitAutoNotes() {
    if (!S.notesAuto) return;
    S.notesAuto = false; S.notesSnap = null;
    autoNotesLabel(false);
  }
  function autoNotes() {
    if (S.paused || S.solved) return;
    pushHist();
    if (S.notesAuto) {                     // 再点一下 = 撤销这次重置
      if (S.notesSnap) {
        S.notes = clone(S.notesSnap.notes);
        S.elim = S.notesSnap.elim; refreshCands();
      }
      else for (var j = 0; j < 81; j++) S.notes[j] = 0;
      S.notesAuto = false; S.notesSnap = null;
      autoNotesLabel(false);
      paint();
      toast('已撤销重置，回到你自己的笔记');
      return;
    }
    S.notesSnap = { notes: clone(S.notes), elim: S.elim.slice() };   // 连划掉痕迹一起快照，撤销时全还原
    /* 真重置：elim 掩码归零（手写划掉 / 提示排除的痕迹全部清掉），
       再从盘面直接重算标准候选 —— 手写的错误笔记这次一定会被清掉 */
    resetElim();
    var base = E.initCandidates(S.grid);
    for (var i = 0; i < 81; i++) S.notes[i] = S.grid[i] ? 0 : base[i];
    S.notesAuto = true;
    autoNotesLabel(true);
    paint();
    toast('笔记已重置为盘面标准候选，手写的痕迹都清掉了（再点一下可撤销）');
  }

  /* ============================================================
     拼图收集：4 主题 × 4 图 × 16 块 = 256 块
     - 每通关一局 → 随机解锁「当前进行中的那张图」的 1 块
     - 限幅推进：一张图集满 16 块，才自动进入下一张（按清单 01→16 顺序）
     - 纯收集展示 + 解锁时「块飞到对应位置」动画
     素材：PUZZLE_DATA（16 张卡通风插画，每张切成 4×4）
     ============================================================ */
  var PZ = (function () {
    // 扁平化：所有图按顺序排成一张总表（跨主题线性推进）
    var LEVELS = [], TOTAL_PIECES = 0, META = {}, CELL = 140, PAD = 34, MIME = 'image/webp', SHAPES = [];
    // 数据可能晚到（外链异步加载），故抽成 build() 可重建；数据就绪后由 onDataReady() 重跑
    function build() {
      LEVELS = [];
      (window.PUZZLE_DATA && window.PUZZLE_DATA.themes || []).forEach(function (th) {
        th.levels.forEach(function (lv) {
          LEVELS.push({ id: lv.id, themeName: th.name, title: lv.title, pieces: lv.pieces });
        });
      });
      TOTAL_PIECES = LEVELS.length * 16;
      META = window.PUZZLE_DATA || {};
      CELL = META.cell || 140; PAD = META.pad || 34; MIME = META.mime || 'image/webp';
      SHAPES = META.shapes || [];
    }
    build();

    // 存储：curIdx = 当前进行到第几张图（LEVELS 索引）；got = { 图id: [已解锁块索引] }
    var S0 = LS.get(ukey('sd.pz2'), { curIdx: 0, got: {} });
    function save() { LS.set(ukey('sd.pz2'), S0); }
    function reload() { S0 = LS.get(ukey('sd.pz2'), { curIdx: 0, got: {} }); render(); }

    function curLevel() { return LEVELS[Math.min(S0.curIdx, LEVELS.length - 1)]; }
    function gotArr(id) { return S0.got[id] || (S0.got[id] = []); }
    function count() {
      var n = 0; Object.keys(S0.got).forEach(function (k) { n += S0.got[k].length; });
      return n;
    }
    // 已集满的图数量（curIdx 已推进到的位置）
    function doneLevels() {
      var d = 0;
      for (var i = 0; i < LEVELS.length; i++) {
        if ((S0.got[LEVELS[i].id] || []).length >= 16) d++; else break;
      }
      return d;
    }

    /* 完赛结算：解锁「当前图」随机一块。返回本次新解锁的块信息（供结算弹层+动画） */
    function onSolved() {
      if (S0.curIdx >= LEVELS.length) return null; // 全部集完
      var lv = curLevel();
      var got = gotArr(lv.id);
      if (got.length >= 16) {
        // 当前图已满，推进
        S0.curIdx++;
        save();
        return onSolved();
      }
      // 随机抽一块未解锁的
      var remain = [];
      for (var i = 0; i < 16; i++) if (got.indexOf(i) < 0) remain.push(i);
      var pick = remain[Math.floor(Math.random() * remain.length)];
      got.push(pick);
      if (got.length >= 16) S0.curIdx++; // 这张集满，下次自动下一张
      save();
      render();  // 立即刷新拼图墙 + 徽章
      return { levelId: lv.id, idx: pick, levelTitle: lv.title, themeName: lv.themeName,
               gotCount: got.length, done: got.length >= 16,
               pieceImg: lv.pieces[pick] ? ('data:' + MIME + ';base64,' + lv.pieces[pick].data) : null };
    }

    /* 当前「查看」的是第几张图（LEVELS 索引）。默认跟随进度 curIdx，
       用户在图鉴里点别的图可临时切换查看，不影响推进逻辑。 */
    var viewIdx = null; // null = 跟随 curIdx
    function viewLevel() {
      var idx = (viewIdx == null) ? Math.min(S0.curIdx, LEVELS.length - 1) : viewIdx;
      return LEVELS[idx];
    }

    /* 根据容器宽度动态算单块尺寸，保证 4×4 + 凸起 padding 不横向溢出 */
    function calcCell() {
      var stage = $('pzStage');
      if (!stage) return CELL;
      var panel = stage.parentElement; // .panel
      // panel.clientWidth 含左右 padding(各18px)，可用宽度要减掉
      var avail = panel ? (panel.clientWidth - 40) : 560;
      // 每块本体 + 两侧凸起 padding 的总宽要放进容器
      var c = Math.floor((avail - PAD * 2) / 4);
      c = Math.max(64, Math.min(CELL, c));
      return c;
    }

    /* 渲染主图区：只渲染「当前查看的这一幅」的 4×4 凸凹网格 */
    function renderStage() {
      var stage = $('pzStage'); if (!stage) return;
      var lv = viewLevel();
      // 贴纸数据尚未异步加载完成：先显示占位，等 onDataReady() 重建后再渲染
      if (!lv) { stage.innerHTML = '<div class="pz-loading">贴纸素材加载中…</div>'; return; }
      var got = gotArr(lv.id);
      var full = got.length >= 16;
      var cell = calcCell();
      // 凸起 padding 随 cell 等比缩放，保证凸凹比例协调
      var pad = Math.round(PAD * cell / CELL);
      var html = '<div class="pz-grid" style="--pzcell:' + cell + 'px;--pad:' + pad + 'px">';
      for (var i = 0; i < 16; i++) {
        var on = got.indexOf(i) >= 0;
        var piece = lv.pieces[i];
        var rr = (piece && piece.r != null) ? piece.r : Math.floor(i / 4);
        var cc = (piece && piece.c != null) ? piece.c : (i % 4);
        var shape = SHAPES[i] || SHAPES[(rr * 4 + cc)] || '';
        html += '<div class="pz-cell ' + (on ? 'on' : 'off') + '" data-idx="' + i +
          '" style="--cx:' + cc + ';--ry:' + rr + '">';
        if (on && piece) {
          html += '<img src="data:' + MIME + ';base64,' + piece.data + '" alt="">';
        } else {
          // 未解锁块：凸凹形状剪影 + 半透明原图底纹 + 卡纸立体感 + 编号
          var pimg = piece && piece.data ? piece.data : '';
          html += '<svg class="pz-ghost" viewBox="-40 -40 220 220" preserveAspectRatio="none">' +
            '<defs>' +
            '<clipPath id="pzclip' + i + '"><path d="' + shape + '"/></clipPath>' +
            '<linearGradient id="pzShadeGrad" x1="0" y1="0" x2="1" y2="1">' +
            '<stop class="pz-shade-hi" offset="0"/>' +
            '<stop offset=".42" stop-color="rgba(255,255,255,0)"/>' +
            '<stop class="pz-shade-lo" offset="1"/>' +
            '</linearGradient>' +
            '</defs>' +
            '<g clip-path="url(#pzclip' + i + ')">' +
            (pimg ? '<image class="pz-ghost-img" href="data:' + MIME + ';base64,' + pimg + '" x="-40" y="-40" width="220" height="220" preserveAspectRatio="none"/>' : '') +
            '<rect class="pz-ghost-tint" x="-40" y="-40" width="220" height="220"/>' +
            '<rect class="pz-ghost-shade" x="-40" y="-40" width="220" height="220"/>' +
            '</g>' +
            '<path class="pz-ghost-edge" d="' + shape + '"/>' +
            '</svg>' +
            '<span class="pz-ghost-n">' + (i + 1) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
      stage.innerHTML = html;

      // 标题 + 进度
      $('pzStageTitle').textContent = lv.title;
      var sn = $('pzStageN');
      sn.textContent = got.length + ' / 16';
      sn.className = 'pz-stage-n' + (full ? ' full' : '');
    }

    /* 渲染图鉴列表：主题分组，每张图一行，可点击切换查看 */
    function renderIndex() {
      var idx = $('pzIndex'); if (!idx) return;
      var html = '';
      var themeMap = {};
      LEVELS.forEach(function (lv) {
        (themeMap[lv.themeName] = themeMap[lv.themeName] || []).push(lv);
      });
      Object.keys(themeMap).forEach(function (tn) {
        var lvs = themeMap[tn];
        var doneCount = lvs.filter(function (l) { return (S0.got[l.id] || []).length >= 16; }).length;
        html += '<div class="pz-theme"><div class="pz-theme-h">' + tn +
          ' <span class="pz-theme-n">' + doneCount + ' / ' + lvs.length + ' 幅</span></div>' +
          '<div class="pz-levels">';
        lvs.forEach(function (lv) {
          var got = gotArr(lv.id);
          var full = got.length >= 16;
          var cur = viewLevel() && viewLevel().id === lv.id;
          var isProgress = LEVELS[S0.curIdx] && LEVELS[S0.curIdx].id === lv.id;
          // 未解锁：只允许查看当前进行中的和已完成的（线性推进）
          var locked = !full && !isProgress;
          html += '<div class="pz-lv' + (full ? ' full' : '') + (cur ? ' cur' : '') +
            (locked ? ' locked' : '') + '" data-lvid="' + lv.id + '">' +
            '<span class="pz-lv-ico">' + (full ? '✓' : (isProgress ? '▶' : '<svg class="lki" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5 V7.5 Q8.5 4.5 12 4.5 Q15.5 4.5 15.5 7.5 V10.5 M12 14 V16.5"/></svg>')) + '</span>' +
            '<span class="pz-lv-t">' + lv.title + '</span>' +
            '<span class="pz-lv-bar"><i style="width:' + Math.round(got.length / 16 * 100) + '%"></i></span>' +
            '<span class="pz-lv-n">' + got.length + ' / 16</span>' +
            '</div>';
        });
        html += '</div></div>';
      });
      idx.innerHTML = html;

      // 绑定点击：切换到查看该图（锁定项不可点）
      idx.querySelectorAll('.pz-lv').forEach(function (el) {
        el.addEventListener('click', function () {
          if (el.classList.contains('locked')) return;
          var id = el.getAttribute('data-lvid');
          var i = LEVELS.findIndex(function (l) { return l.id === id; });
          if (i >= 0) { viewIdx = i; renderStage(); renderIndex(); }
        });
      });
    }

    /* 渲染：主图区 + 图鉴列表 + 进度/规则 */
    function render() {
      var stage = $('pzStage'); if (!stage) return;
      // 贴纸数据尚未异步加载完成：仅放占位，等 onDataReady() 再来整页渲染
      if (!LEVELS.length) { stage.innerHTML = '<div class="pz-loading">贴纸素材加载中…</div>'; return; }
      // 保证 viewIdx 不越界
      if (viewIdx != null && (viewIdx < 0 || viewIdx >= LEVELS.length)) viewIdx = null;

      renderStage();
      renderIndex();

      var n = count();
      $('pzCount').textContent = n + ' / ' + TOTAL_PIECES;
      renderRail();                            /* v4：左栏拼图卡同步 */
      var cl = curLevel();
      if (n >= TOTAL_PIECES) {
        $('pzCurLevel').textContent = '全部集齐！';
        $('pzCurTheme').textContent = '★';
        $('pzCap').innerHTML = '<b>256 块全部点亮！</b>这 16 幅插画是你一局一局攒出来的。';
      } else {
        $('pzCurLevel').textContent = cl.title;
        $('pzCurTheme').textContent = cl.themeName;
        $('pzCap').innerHTML = '每通关一局，随机点亮当前这幅「' + cl.title + '」的一块 —— 集满 16 块再解锁下一幅。';
      }
      var bd = $('pzBadge');
      if (n > 0) { bd.hidden = false; bd.textContent = n; } else bd.hidden = true;

      // 怎么收集的规则说明
      var pt = $('pzTasks');
      if (pt) {
        pt.innerHTML =
          '<div class="pzt"><span class="pzic"><svg class="pzg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8 H17 Q21 8 20.5 12.5 Q20.2 15.5 18 15.5 Q16.5 15.5 15.5 13.5 H8.5 Q7.5 15.5 6 15.5 Q3.8 15.5 3.5 12.5 Q3 8 7 8 Z M7.2 10.4 V12.4 M6.2 11.4 H8.2"/><circle cx="15.4" cy="10.9" r="0.4"/><circle cx="17.3" cy="12.3" r="0.4"/></svg></span><span>每通关任意难度一局，随机点亮<b>当前这幅</b>的一块</span><span class="st2">随时可得</span></div>' +
          '<div class="pzt"><span class="pzic">' + PZT + '</span><span>集满一幅的 16 块，自动进入下一幅（按主题顺序推进）</span><span class="st2">限幅推进</span></div>' +
          '<div class="pzt"><span class="pzic"><svg class="pzp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 16 L9 11.5 L13 15 L15.5 12.8 L20 16.5"/><circle cx="9" cy="8.8" r="1.1" fill="currentColor" stroke="none"/></svg></span><span>4 个主题、16 幅原创插画，共 256 块等你集齐</span><span class="st2">长期目标</span></div>';
      }
    }

    /* 预览模式已移除：正式版不做「一键注入假进度」的调试入口，
       拼图只能通过「通关一局解锁一块」真实获得。 */

    return { onSolved: onSolved, render: render, count: count, reload: reload,
             rail: function () {                  /* v4：左栏拼图卡要的进度摘要 */
               var lv = curLevel();
               return { title: lv ? lv.title : '', got: lv ? (S0.got[lv.id] || []).length : 0,
                        total: 16, gotAll: count(), totalAll: TOTAL_PIECES };
             },
      get TOTAL() { return TOTAL_PIECES; }, lastGain: 0,
      onDataReady: function () { build(); render(); } };
  })();
  window.PZ = PZ; // 暴露给异步外链脚本的 onload，用于数据晚到后重建贴纸墙
  // 保险：若外链数据在主逻辑解析时已先到，立即重建（绝大多数情况数据晚到，由脚本 onload 触发）
  if (window.PUZZLE_DATA) PZ.onDataReady();

  /* ============================================================
     每日挑战（Daily Challenge）
     ------------------------------------------------------------
     按日期确定性出题：任何人、任何设备在同一天打开，看到的是同一道题
     （日期 → 种子 → 档位轮换 + 题序），不用服务端也能「全网同题」。
     完成即点亮当日打卡，连续完成累计连续天数。
     ============================================================ */
  var DAILY = (function () {
    function dayKey(dt) {
      dt = dt || new Date();
      return dt.getFullYear() + '-' + two(dt.getMonth() + 1) + '-' + two(dt.getDate());
    }
    /* 昨天（按日历日，不是 24 小时前） */
    function prevKey(dk) {
      var p = dk.split('-');
      var d = new Date(+p[0], +p[1] - 1, +p[2]);
      d.setDate(d.getDate() - 1);
      return dayKey(d);
    }
    function meta(dk) {
      dk = dk || dayKey();
      var p = dk.split('-'), y = +p[0], m = +p[1], d = +p[2];
      var doy = Math.floor((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86400000);
      var seed = y * 10000 + m * 100 + d;
      var t = BANK.tiers[doy % BANK.tiers.length];
      var i = (seed * 7919 + 104729) % t.puzzles.length;
      return { key: dk, tier: t, tierKey: t.key, tierIdx: BANK.tiers.indexOf(t), puzIdx: i, grade: t.puzzles[i].grade };
    }
    function stat() { return LS.get(ukey('sd.dchallenge'), { last: '', streak: 0, days: {} }); }
    function isDoneToday() { return !!stat().days[dayKey()]; }
    function onSolved() {
      if (!S.daily) return 0;
      var dk = S.daily, st = stat();
      if (st.days[dk]) return 0;                 // 当日已完成，不重复计
      st.days[dk] = { t: S.elapsed, m: S.mistakes, h: S.hints };
      st.streak = (st.last === prevKey(dk) || st.last === dk) ? (st.streak || 0) + 1 : 1;
      st.last = dk;
      LS.set(ukey('sd.dchallenge'), st);
      render();
      return st.streak;
    }
    function start() {
      /* 从面板里开局：面板跟着关掉，但那一下不出「关闭」音，只留开局这一声 */
      var ov = $('dailyOv');
      if (ov && !ov.hidden) quietClose = true;
      closeIfOpen();
      quietClose = false;
      var mt = meta();
      newGame(mt.tierKey, mt.puzIdx);
      S.daily = mt.key;
      Sfx.play('start');
      toast('每日挑战开始 · 今天是「' + mt.tier.name + '」题');
    }
    /* 面板开着才关（nextAct 也会调 start()，那时栈顶不是它，别误关别的层） */
    function closeIfOpen() {
      var el = $('dailyOv');
      if (!el || el.hidden) return;
      var top = MStack[MStack.length - 1];
      if (top && top.el === el) modalCloseTop();
      else { el.hidden = true; mSync(el); }
    }
    /* 顶栏小按钮的状态：未打卡挂暖黄小点，已完成整枚转暖黄 */
    function render() {
      var btn = $('dailyBtn'); if (!btn) return;
      var mt = meta(), st = stat();
      var done = st.days[mt.key];
      btn.classList.toggle('done', !!done);
      var dot = $('dailyBtnDot'); if (dot) dot.hidden = !!done;
      var tx = $('dailyBtnTxt'); if (tx) tx.textContent = done ? '已打卡' : '每日挑战';
      btn.title = done
        ? '今日挑战已完成 · 用时 ' + fmtTime(done.t) + '，点开看打卡图'
        : '每日挑战：今天是一道「' + mt.tier.name + '」题，点开看打卡图';
      var ov = $('dailyOv');
      if (ov && !ov.hidden) renderPanel();
      renderRail();                              /* v4：左栏打卡卡同步 */
    }
    /* 打卡图：近 6 周（42 格）热力图。列 = 周日→周六，行 = 周。
       已打卡 = 暖黄实心 + 日号；过去漏打卡 = 虚线浅格；未来 = 极淡；今天多一圈墨环。 */
    function heatHtml() {
      var st = stat(), d = new Date();
      function pad(n) { return n < 10 ? '0' + n : '' + n; }
      var todayKey = dayKey();
      var base = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      base.setDate(base.getDate() - base.getDay());               /* 本周日 */
      var start = new Date(base); start.setDate(start.getDate() - 35);  /* 6 周共 42 天 */
      var dows = ['日', '一', '二', '三', '四', '五', '六'];
      var html = '<div class="dh-h"><b>打卡图</b><span>最近 6 周</span>' +
        '<i class="dh-leg"><span class="dh-on"></span>已打卡' +
        '<span class="dh-off"></span>漏打</i></div><div class="dh-grid">';
      for (var w = 0; w < 7; w++) html += '<span class="dh-dow">' + dows[w] + '</span>';
      for (var r = 0; r < 6; r++) {
        for (w = 0; w < 7; w++) {
          var cur = new Date(start); cur.setDate(start.getDate() + r * 7 + w);
          var key = cur.getFullYear() + '-' + pad(cur.getMonth() + 1) + '-' + pad(cur.getDate());
          var fut = key > todayKey;
          var cls = 'dh-c ' + (fut ? 'dh-fut' : (st.days[key] ? 'dh-on' : 'dh-off'));
          if (key === todayKey) cls += ' dh-today';
          html += '<span class="' + cls + '" title="' + key + (st.days[key] ? ' · 已打卡' : '') + '">' +
                  (fut ? '' : cur.getDate()) + '</span>';
        }
      }
      return html + '</div>';
    }
    function renderPanel() {
      var mt = meta(), st = stat(), done = st.days[mt.key];
      function pad(n) { return n < 10 ? '0' + n : '' + n; }
      var d = new Date();
      var days = 0, mN = 0, mk = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      for (var k in st.days) { days++; if (k.indexOf(mk) === 0) mN++; }
      $('dvDate').textContent = (d.getMonth() + 1) + '月' + d.getDate() + '日';
      $('dvBody').innerHTML =
        '<div class="dv-today">' +
          '<span class="dv-tag">今天</span>' +
          '<div class="dv-tt"><b>' + mt.tier.name + '</b><span class="lv">L' + mt.grade + '</span>' +
            '<span class="dv-sub">每天 0 点换题 · 全网同一道</span></div>' +
          '<div class="dv-st">' + (done
            ? '<b class="ok">✓ 已完成 · ' + fmtTime(done.t) + '</b><span>错误 ' + done.m + ' · 提示 ' + done.h + '</span>'
            : '<b>还没做</b><span>今天打完就点亮一格</span>') + '</div>' +
        '</div>' +
        heatHtml() +
        '<div class="dv-nums">' +
          '<div class="dv-num"><b>' + (st.streak || 0) + '</b><span>连续天数</span></div>' +
          '<div class="dv-num"><b>' + mN + '</b><span>本月打卡</span></div>' +
          '<div class="dv-num"><b>' + days + '</b><span>累计打卡</span></div>' +
        '</div>' +
        '<button class="bigbtn dv-go" id="dvStart" type="button">' +
          (done ? '再打一次今天的题' : '开始挑战') + '</button>';
      var go = $('dvStart');
      if (go) go.addEventListener('click', start);
    }
    function openPanel() {
      renderPanel();
      $('dailyOv').hidden = false;
      modalOpen($('dailyOv'), closePanel);
      Sfx.play('open');
    }
    /* quietClose：从面板里点「开始挑战」时，面板要关掉，但那一下不该有「关」的声音 ——
       否则关一声紧接着开一局一声，听着像误触了两下。start() 里临时置真。 */
    var quietClose = false;
    function closePanel() {
      $('dailyOv').hidden = true; mSync($('dailyOv'));
      if (!quietClose) Sfx.play('close');
      quietClose = false;
    }
    function init() {
      var b = $('dailyBtn');
      if (b) b.addEventListener('click', function () {
        /* K-3：先把焦点落在按钮上，面板关闭后焦点才回得来 */
        try { this.focus({ preventScroll: true }); } catch (e) {}
        openPanel();
      });
      var x = $('dvClose');
      if (x) x.addEventListener('click', function () { closeIfOpen(); });
      render();
    }
    /* 挑战局（可能是旧日期）通关后补记成绩：已有记录就不覆盖，免得刷掉当天真正那一局 */
    function save(dk, t, m, h) {
      var st = stat();
      if (st.days[dk]) return false;
      st.days[dk] = { t: t, m: m, h: h };
      LS.set(ukey('sd.dchallenge'), st);
      render();
      return true;
    }
    /* 本月打卡月历（指令 2）：7 列网格，今天以前的日期都显示，已打卡暖黄点亮、未打卡灰格、未来不显示 */
    function calHtml() {
      var st = stat(), d = new Date();
      var y = d.getFullYear(), m = d.getMonth(), today = d.getDate();
      function pad(n) { return n < 10 ? '0' + n : '' + n; }
      var first = new Date(y, m, 1).getDay();           // 0=周日 … 6=周六
      var dows = ['日', '一', '二', '三', '四', '五', '六'];
      var html = '<div class="cal"><div class="cal-h">' + FL + ' 卷卷羊已连续陪你做题 <b>' + (st.streak || 0) + '</b> 天</div><div class="cal-grid">';
      for (var i = 0; i < 7; i++) html += '<span class="cal-dow">' + dows[i] + '</span>';
      for (var b = 0; b < first; b++) html += '<span class="cal-cell cal-blank"></span>';
      for (var day = 1; day <= today; day++) {
        var key = y + '-' + pad(m + 1) + '-' + pad(day);
        html += '<span class="cal-cell ' + (st.days[key] ? 'on' : 'off') + '">' + day + '</span>';
      }
      html += '</div></div>';
      return html;
    }
    return { meta: meta, stat: stat, onSolved: onSolved, start: start, render: render, isDoneToday: isDoneToday, dayKey: dayKey, save: save, calHtml: calHtml, init: init, openPanel: openPanel, heatHtml: heatHtml };
  })();

  /* ============================================================
     挑战链接（指令 10）：「来挑战我这局」
     ------------------------------------------------------------
     链接：?challenge=2026-10-24-medium&t=311&m=1&h=0
       challenge = 日期 + 难度档位（可读、短，转发时不会被截断成乱码）
       t / m / h = 发起人成绩（用时秒 / 错误 / 提示）；缺省就是「超越发起人」模式
     关键点：题目由「日期 + 档位」唯一确定（与每日挑战同一套算法），
     所以好友点开看到的盘面跟你刚才一模一样 —— 有可比性才算对战。
     ============================================================ */
  var CHAL = (function () {
    function tierOf(key) {
      for (var i = 0; i < BANK.tiers.length; i++) if (BANK.tiers[i].key === key) return BANK.tiers[i];
      return null;
    }
    /* 定题算法与 DAILY.meta 完全一致：同日期 + 同档位 → 同一题 */
    function puzOf(dk, t) {
      var p = String(dk).split('-'), y = +p[0], m = +p[1], d = +p[2];
      if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return -1;
      var seed = y * 10000 + m * 100 + d;
      return (seed * 7919 + 104729) % t.puzzles.length;
    }
    function scoreOf() {
      function n(k) {
        var r = new RegExp('[?&]' + k + '=(\\d+)').exec(location.search);
        return r ? +r[1] : -1;
      }
      var t = n('t');
      if (t < 0) return null;
      return { t: t, m: Math.max(0, n('m')), h: Math.max(0, n('h')) };
    }
    /* 格式不对就当没带参数：坏链接绝不该把应用卡住，也不该开出一局错题 */
    function parse() {
      var m = /[?&]challenge=([^&]+)/.exec(location.search);
      if (!m) return null;
      var raw = m[1];
      try { raw = decodeURIComponent(raw); } catch (e) {}
      var mm = /^(\d{4}-\d{2}-\d{2})-([a-z]+)$/.exec(raw);
      if (!mm) return null;
      var t = tierOf(mm[2]); if (!t) return null;
      var pi = puzOf(mm[1], t); if (pi < 0) return null;
      return { dk: mm[1], tier: t, tierKey: t.key, puzIdx: pi, score: scoreOf() };
    }
    function dateLabel(dk) { var p = dk.split('-'); return (+p[1]) + '月' + (+p[2]) + '日'; }
    /* 挑战链接的站点根（2026-10-31 修）：
       小工具容器里页面是包内的本机文件，location.origin 是 "null"（file:// 下），
       拼出来的链接好友根本打不开。既然小工具发不出可用的自链接，就统一指向线上站点；
       线上站点不带 sharecode 会整站 403，所以分享用的 sharecode 必须一起带上。
       网页端仍用当前 origin，且把当前 URL 里的 sharecode 原样带过去
       —— 否则从分享链接进来的玩家再发起挑战，发出去的新链接是不带码的死链。 */
    var WEB_BASE = 'https://juanjuanyang-sudoku.app.workbuddy.host/?sharecode=OUQT4PXSUZ&';
    function shareBase() {
      var http = (location.protocol === 'http:' || location.protocol === 'https:');
      /* __XHS_BUILD 由 build-xhs.js 写在 main.js 开头 —— 构建期常量，比运行时探测可靠：
         小工具里到底是 file:// 还是容器内的 http://，运行时不一定判得准，但「这个包是
         发给小工具的那份」在构建时是确定的。网页端没有这个常量 → 行为完全不变。 */
      if (window.__XHS_BUILD || ENV.xhs || !http) return WEB_BASE;
      var sc = /[?&]sharecode=([^&]+)/.exec(location.search);
      return location.origin + location.pathname + '?' + (sc ? 'sharecode=' + sc[1] + '&' : '');
    }
    /* 发起「挑战我」链接：把这局的时间 / 错误 / 提示一并带上 */
    function linkFor(dk, tierKey) {
      return shareBase() + 'challenge=' + dk + '-' + tierKey +
        '&t=' + Math.max(0, Math.round(S.elapsed)) + '&m=' + S.mistakes + '&h=' + S.hints;
    }
    function start() {
      var c = parse();
      if (!c) return false;
      newGame(c.tierKey, c.puzIdx);
      c.isToday = (c.dk === DAILY.dayKey());
      S.chal = c;
      /* 只有「今天这一局」才计入今日打卡：拿旧日期链接刷连续天数不算本事 */
      if (c.isToday) S.daily = c.dk;
      paintBanner();
      return true;
    }
    /* 常驻横幅：说清「你在跟谁、哪天的哪一局、对手成绩多少」，可手动收起 */
    function paintBanner() {
      var c = S.chal, host = $('view-play'); if (!host) return;
      var old = $('chalBanner'); if (old) old.remove();
      if (!c) return;
      var d = document.createElement('div');
      d.className = 'chalbanner'; d.id = 'chalBanner';
      var sc = c.score
        ? '好友 ' + fmtTime(c.score.t) + ' · 错 ' + c.score.m + ' · 提示 ' + c.score.h
        : '好友没留成绩 —— 这是超越他的机会';
      d.innerHTML =
        '<span class="cb-tx">你正在挑战好友的 <b>' + dateLabel(c.dk) + ' ' + c.tier.name + '局</b></span>' +
        '<span class="cb-sc">' + sc + '</span>' +
        '<button class="cb-x" id="cbX" type="button" title="收起横幅" aria-label="收起">×</button>';
      host.insertBefore(d, host.firstChild);
      host.classList.add('haschal');      /* 宽屏靠它把新手条往下让 */
      var x = $('cbX');
      if (x) x.addEventListener('click', function () { d.remove(); host.classList.remove('haschal'); });
    }
    return { parse: parse, start: start, linkFor: linkFor, dateLabel: dateLabel, paintBanner: paintBanner };
  })();

  /* ============================================================
     能力画像（Player Profile）
     ------------------------------------------------------------
     只在「通关」时记一笔（record）：局数、用时、错误、提示、
     各难度通关数与最快用时、各技巧使用次数、每日打卡天数。
     全部存本机、按账号隔离 —— 画像是你自己的成长记录。
     ============================================================ */
  var STATS = (function () {
    function stat() {
      return LS.get(ukey('sd.stats'),
        { games: 0, time: 0, hints: 0, mistakes: 0, tech: {}, tiers: {}, daily: 0, bestStreak: 0 });
    }
    function record() {
      var st = stat();
      st.games++; st.time += S.elapsed; st.hints += S.hints; st.mistakes += S.mistakes;
      var t = st.tiers[S.tierKey] || (st.tiers[S.tierKey] = { done: 0, best: 0 });
      t.done++;
      if (!t.best || S.elapsed < t.best) t.best = S.elapsed;
      for (var k in S.used) { var lv = +k; if (lv) st.tech[lv] = (st.tech[lv] || 0) + S.used[k]; }
      var dst = DAILY.stat();
      if (S.daily) st.daily++;
      if ((dst.streak || 0) > (st.bestStreak || 0)) st.bestStreak = dst.streak;
      LS.set(ukey('sd.stats'), st);
    }
    function render() {
      var st = stat(), dst = DAILY.stat();
      /* 总览 */
      var top = $('statsTop');
      if (st.games === 0) {
        top.innerHTML = '<div class="empty">还没有通关记录。<br>先解出第一题，画像就开始生长 —— 每一局都会沉淀成数据。</div>';
      } else {
        var hh = Math.floor(st.time / 3600), mm = Math.floor(st.time % 3600 / 60);
        var avgHint = st.games ? (st.hints / st.games).toFixed(1) : '0';
        top.innerHTML =
          '<div class="stgrid">' +
          '<div class="stcard"><b>' + st.games + '</b><span>通关局数</span></div>' +
          '<div class="stcard"><b>' + (hh > 0 ? hh + '时' : '') + mm + '分</b><span>累计用时</span></div>' +
          '<div class="stcard"><b>' + avgHint + '</b><span>场均提示</span></div>' +
          '<div class="stcard"><b>' + (st.games ? Math.round(st.mistakes / st.games * 10) / 10 : 0) + '</b><span>场均错误</span></div>' +
          '</div>';
      }
      /* 分难度战绩 */
      var tr = '';
      BANK.tiers.forEach(function (t) {
        var s = st.tiers[t.key] || { done: 0, best: 0 };
        var pct = t.puzzles.length ? Math.round(s.done / t.puzzles.length * 100) : 0;
        tr += '<div class="strow"><span class="stn">' + t.name + '</span>' +
          '<span class="stbar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="stv">' + s.done + ' / ' + t.puzzles.length + ' 题' +
          (s.best ? ' · 最快 <b>' + fmtTime(s.best) + '</b>' : '') + '</span></div>';
      });
      $('statsTiers').innerHTML = tr || '<div class="empty">暂无记录</div>';
      /* 技巧使用分布 */
      var mxT = 0, row = '';
      for (var lv = 1; lv <= 8; lv++) mxT = Math.max(mxT, st.tech[lv] || 0);
      for (lv = 1; lv <= 8; lv++) {
        var n = st.tech[lv] || 0;
        var pct2 = mxT ? Math.round(n / mxT * 100) : 0;
        row += '<div class="strow' + (n ? '' : ' dim') + '"><span class="stn">L' + lv + ' ' + TECHS[lv - 1].name + '</span>' +
          '<span class="stbar"><i style="width:' + pct2 + '%"></i></span>' +
          '<span class="stv">' + n + ' 步</span></div>';
      }
      $('statsTech').innerHTML = row;
      /* 每日挑战 */
      var days = 0; for (var dk in dst.days) days++;
      $('statsDaily').innerHTML =
        DAILY.calHtml() +
        '<div class="empty">' +
        '' + FL + ' 当前连续打卡 <b>' + (dst.streak || 0) + '</b> 天 · 累计打卡 <b>' + days + '</b> 天' +
        (st.bestStreak ? ' · 最佳连续 <b>' + st.bestStreak + '</b> 天' : '') +
        '<br>每天一道全网同题，难度按日期轮换 —— 把推理变成每天的小习惯。</div>';
    }
    return { stat: stat, record: record, render: render };
  })();

  /* ============================================================
     v4 桌面左栏三卡（2026-11-02）：每日挑战打卡 / 拼图收集 / 最近技巧
     ------------------------------------------------------------
     只在 ≥1120 的三栏版式里由 CSS 显示（.railcards），手机与中等屏
     完全不渲染内容。数据全部读既有模块（DAILY / PZ / STATS），
     不新增存储；各模块状态变化时自行调 renderRail() 刷新。
     ============================================================ */
  function renderRail() {
    var rd = $('railDaily'), rp = $('railPz'), rt = $('railTech');
    if (!rd && !rp && !rt) return;
    if (rd) {
      try {
        var dst = DAILY.stat();
        rd.innerHTML =
          '<div class="rc-h"><b>每日挑战</b><span>' +
            (dst.streak ? '连击 ' + dst.streak + ' 天' : '从今天开始') + '</span></div>' +
          DAILY.heatHtml();
      } catch (e) { rd.innerHTML = ''; }
    }
    if (rp) {
      try {
        var info = PZ.rail();
        var cells = '', i;
        for (i = 0; i < info.total; i++) cells += '<i class="rz-c' + (i < info.got ? ' on' : '') + '"></i>';
        rp.innerHTML =
          '<div class="rc-h"><b>拼图收集</b><span>' + info.gotAll + ' / ' + info.totalAll + '</span></div>' +
          '<div class="rc-sub">' + info.title + ' · ' + info.got + '/' + info.total + ' 块</div>' +
          '<div class="rz-grid">' + cells + '</div>';
      } catch (e) { rp.innerHTML = ''; }
    }
    if (rt) {
      try {
        var stt = STATS.stat();
        var rows = [], lv;
        for (lv = 1; lv <= 8; lv++) {
          var n = stt.tech[lv] || 0;
          if (n > 0) rows.push({ lv: lv, n: n });
        }
        rows.sort(function (a, b) { return b.n - a.n; });
        rt.innerHTML = '<div class="rc-h"><b>最近技巧</b><span>累计</span></div>' +
          (rows.length
            ? rows.slice(0, 3).map(function (r) {
                return '<div class="rc-trow"><span>' + TECHS[r.lv - 1].name + '</span><b>×' + r.n + '</b></div>';
              }).join('')
            : '<div class="rc-empty">卡住点「提示」，用过的招会记在这里</div>');
      } catch (e) { rt.innerHTML = ''; }
    }
  }

  /* ============================================================
     战绩分享卡（Canvas 绘制，可直接保存 PNG）
     ------------------------------------------------------------
     通关结算里生成一张固定配色的卡片图：战绩 + 迷你终盘 + 产品信息。
     用于社交分享（比赛社区加分项），不依赖任何外部图片资源。
     ============================================================ */
  /* 战绩分享卡：奶油纸 + 双栏（左战绩 / 右迷你终盘），640×680 横竖比接近 1:1，
     比原来的 640×1040 竖长条矮一大截，结算弹层里放得下 */
  function drawShareCard(cv, data) {
    var W = 640, H = 680;
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    function rr(x, y, w, h, r) {
      g.beginPath();
      g.moveTo(x + r, y);
      g.arcTo(x + w, y, x + w, y + h, r);
      g.arcTo(x + w, y + h, x, y + h, r);
      g.arcTo(x, y + h, x, y, r);
      g.arcTo(x, y, x + w, y, r);
      g.closePath();
    }
    /* 背景：奶油卡纸渐变 + 顶部羊圈绿条 + 贴纸墨描边 */
    var bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#FFF9EC'); bg.addColorStop(1, '#F3EAD8');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.fillStyle = '#5F7D57'; g.fillRect(0, 0, W, 9);
    g.strokeStyle = '#2B2B26'; g.lineWidth = 2.5;
    rr(20, 20, W - 40, H - 40, 26); g.stroke();
    /* 左上：品牌 + 日期（奶油 pop 标题字） */
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.font = '900 42px "ZCOOL KuaiLe","Yuanti SC","Microsoft YaHei",sans-serif';
    g.lineWidth = 7; g.lineJoin = 'round'; g.strokeStyle = '#2B2B26';
    g.strokeText('卷卷羊 · 数独学园', 52, 98);
    g.fillStyle = '#FFF9EC'; g.fillText('卷卷羊 · 数独学园', 52, 98);
    g.lineWidth = 1;
    g.fillStyle = '#4A5546'; g.font = '20px sans-serif';
    g.fillText('会教你的数独 · 教推理，不给答案', 52, 126);
    g.textAlign = 'right';
    g.fillText(data.date, W - 52, 98);
    /* 难度徽章：绿色胶囊 */
    g.textAlign = 'left';
    var tierTxt = data.tierName + ' · L' + data.grade;
    g.font = 'bold 26px sans-serif';
    var tw = g.measureText(tierTxt).width;
    g.fillStyle = '#5F7D57'; rr(52, 148, tw + 40, 46, 23); g.fill();
    g.fillStyle = '#FFF9EC'; g.textBaseline = 'middle';
    g.fillText(tierTxt, 72, 148 + 23);
    g.textBaseline = 'alphabetic';
    /* 大字用时 */
    g.fillStyle = '#4A5546'; g.font = '20px sans-serif';
    g.fillText('本局用时', 52, 266);
    g.fillStyle = '#2B2B26'; g.font = 'bold 84px sans-serif';
    g.fillText(data.time, 52, 348);
    /* 错误 / 提示：两个小卡 */
    [['错误', data.mistakes, 52], ['提示', data.hints, 174]].forEach(function (b) {
      g.fillStyle = '#FFF9EC';
      rr(b[2], 374, 110, 78, 14); g.fill();
      g.strokeStyle = '#2B2B26'; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = '#2B2B26'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center';
      g.fillText('' + b[1], b[2] + 55, 406);
      g.fillStyle = '#4A5546'; g.font = '18px sans-serif';
      g.fillText(b[0], b[2] + 55, 434);
      g.textAlign = 'left';
    });
    /* 最高技巧 + 每日打卡 + 拼图进度 */
    g.fillStyle = '#4A5546'; g.font = '20px sans-serif';
    g.fillText(data.maxTech ? '最高技巧 L' + data.maxTech + ' ' + data.maxTechName : '全程只用了「唯一余数」', 52, 494);
    var extraY = 0;
    if (data.streak) {
      g.fillStyle = '#E8654F'; g.font = 'bold 20px sans-serif';
      g.fillText('每日挑战 · 已连续 ' + data.streak + ' 天', 52, 530);
      extraY += 32;
    }
    if (data.pz) {
      g.fillStyle = '#E8654F'; g.font = 'bold 20px sans-serif';
      g.fillText('拼图 +1 · ' + data.pz.name + '（' + data.pz.n + ' / 16）', 52, 530 + extraY);
      extraY += 32;
    }
    /* 挑战局（指令 10）：分享卡上明写「来挑战我这局」，对方拿到链接就能同盘对打 */
    if (data.chal) {
      g.fillStyle = '#E8654F'; g.font = 'bold 20px sans-serif';
      g.fillText('点链接来挑战我这局 · ' + data.chal.date + ' ' + data.chal.tier, 52, 530 + extraY);
    }
    /* 底部：细分隔线 + 署名 */
    g.strokeStyle = 'rgba(43,43,38,.3)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(52, 600); g.lineTo(W - 52, 600); g.stroke();
    g.textAlign = 'left'; g.fillStyle = '#4A5546'; g.font = '18px sans-serif';
    g.fillText('WorkBuddy「1024 造物挑战」参赛作品', 52, H - 34);
    /* 右侧：迷你终盘 */
    var B = 252, cell = B / 9, bx = W - 52 - B, by = 150;
    g.fillStyle = '#FFF9EC';
    g.fillRect(bx, by, B, B);
    for (var i = 0; i <= 9; i++) {
      var th = i % 3 === 0 ? 2.5 : 1;
      g.strokeStyle = i % 3 === 0 ? '#2B2B26' : 'rgba(43,43,38,.22)';
      g.lineWidth = th;
      g.beginPath(); g.moveTo(bx, by + i * cell); g.lineTo(bx + B, by + i * cell); g.stroke();
      g.beginPath(); g.moveTo(bx + i * cell, by); g.lineTo(bx + i * cell, by + B); g.stroke();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (var r = 0; r < 9; r++) for (var c = 0; c < 9; c++) {
      var v = data.grid[r * 9 + c];
      if (!v) continue;
      g.font = (data.given[r * 9 + c] ? 'bold ' : '') + Math.floor(cell * .56) + 'px sans-serif';
      g.fillStyle = data.given[r * 9 + c] ? '#2B2B26' : '#D9679B';
      g.fillText('' + v, bx + c * cell + cell / 2, by + r * cell + cell / 2 + 1);
    }
    g.textBaseline = 'alphabetic';
  }


  /* 指令 3 · 通关动画：先波浪点亮 81 格（对角线顺序），再落学士帽章，结束后弹完成弹窗。
     S.solved 已在 checkDone 置真，put() 会因 S.solved 拦输入，无需额外锁。 */
  function playWinFx(onDone) {
    var board = $('board');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !board || !board.children.length) { onDone(); return; }
    var cells = board.children;
    for (var i = 0; i < cells.length; i++) {
      var r = (i / 9) | 0, c = i % 9, d = r + c;
      cells[i].style.animationDelay = (d * 45) + 'ms';
      cells[i].classList.add('win');
    }
    document.body.classList.add('winfx');           // 触发学士帽章落下
    var waveMs = 16 * 45 + 560;                     // 对角线最远一格(16)起跳 + 动画时长
    setTimeout(function () {
      setTimeout(function () {
        for (var i = 0; i < cells.length; i++) { cells[i].classList.remove('win'); cells[i].style.animationDelay = ''; }
        document.body.classList.remove('winfx');
        if (S.solved) onDone();                     // 波浪 + 盖印结束 → 弹完成弹窗（期间若已开新局则丢弃）
      }, 460);                                      // 等盖章动画(.42s)落定
    }, waveMs);
  }

  function checkDone() {
    if (S.solved) return;
    for (var i = 0; i < 81; i++) if (!S.grid[i]) return;
    if (Object.keys(findConflicts()).length) return;
    S.solved = true;
    markDone(S.tierKey, S.puzIdx);                  // 做题记录：这题做过了，之后不再出
    markRecordDone(S.tierKey, S.puzIdx);            // 同步「已做」记录：标记为完成
    clearInterval(S.tick);
    Sfx.play('done');                               // 三音上行 + [30,50,80] 震动（指令 4/5）
    PZ.lastGain = PZ.onSolved();                    // 完赛 → 解锁一块拼图
    DAILY.streakNow = DAILY.onSolved();             // 每日挑战：打卡 + 连续天数
    if (S.chal && !S.daily) DAILY.save(S.chal.dk, S.elapsed, S.mistakes, S.hints);  // 挑战局补记成绩
    STATS.record();                                 // 能力画像：沉淀本局数据
    playWinFx(showDone);                            // 指令 3：波浪 + 盖印动画后再弹结算
  }

  /* ---------------- 提示（核心「教学」能力） ---------------- */
  /* 提示分级消耗（用于变现定价设计）：越靠后的高级技巧越「贵」——
     L1/L2 基础（便宜）· L3–L5 进阶（中等）· L6+ 高级（贵）。
     实测小闲/小进的提示集中在 L3，故 L3 定价低于 L6+，兑换点自然落在高阶技巧上。 */
  function hintCost(lv) { return lv <= 2 ? 1 : lv <= 5 ? 2 : 3; }
  /* 提示浮层显隐收口：不自动消失（用户指令 J）——一直留着直到点「收起」/
     采纳提示 / 切页等主动操作；半透遮罩不挡死关键内容 */
  function hideHintSheet() {
    var hp = $('hintPanel'); if (hp) hp.hidden = true;
    mSync(hp);
  }
  function showHintSheet() {
    var hp = $('hintPanel'); if (!hp) return;
    hp.hidden = false;
    modalOpen(hp, hideHintSheet);
  }

  function clearHint(silent) {
    S.hint = null; S.hintSeq = [];
    $('hintTag').textContent = '待提示';
    $('btnApply').hidden = true;
    $('hintNext').hidden = true;
    hideHintSheet();                       // 提示卡是棋盘上方浮层，清掉就收起
    if (!silent) {
      $('hintBox').innerHTML = '<div class="empty">点「教我下一步」，我会告诉你<b>这一步该看哪里、用什么技巧</b>，而不是直接给答案。</div>';
    }
  }

  function renderHintEmpty() {
    $('hintBox').innerHTML = '<div class="empty">点「教我下一步」，我会告诉你<b>这一步该看哪里、用什么技巧</b>，而不是直接给答案。</div>';
  }

  function doHint() {
    if (S.paused) { toast('先取消暂停'); return; }
    if (S.solved) { toast('已经解完啦'); return; }
    if (D.active) { toast('草稿推演中 —— 先退出草稿（点状态行的草稿胶囊）再用提示'); return; }
    var conf = findConflicts();
    if (Object.keys(conf).length) { toast('先把红色冲突的格子改对，我才能继续推'); return; }
    var wrong = [];
    for (var i = 0; i < 81; i++) if (S.grid[i] && S.grid[i] !== S.sol[i]) wrong.push(i);
    if (wrong.length) {
      S.sel = wrong[0]; paint();
      toast('这一步之前先检查 R' + (Math.floor(wrong[0] / 9) + 1) + 'C' + (wrong[0] % 9 + 1) + '，它填错了');
      return;
    }

    // 以玩家当前笔记为准校正引擎候选（兜底：擦除 / 手动改笔记等路径可能绕过 elim 掩码）。
    // 有笔记的空格：引擎候选 = 基础候选 ∩ 玩家笔记 —— 玩家手动划掉的数，提示不会再点名
    var baseC = E.initCandidates(S.grid);
    for (var bi = 0; bi < 81; bi++) {
      if (S.grid[bi] || !S.notes[bi]) continue;
      S.cands[bi] = baseC[bi] & S.notes[bi];
      S.elim[bi] = baseC[bi] & ~S.notes[bi];
    }
    var act = E.nextHintState(S.grid, S.cands, 8);
    if (!act) { toast('当前局面已经推不动了，检查一下填入的数字'); return; }

    S.hint = act; S.hints++;
    S.hintCost += hintCost(act.level);
    S.used[act.level] = (S.used[act.level] || 0) + 1;
    unlockSkill(act.level);
    renderRail();                            /* v4：左栏「最近技巧」同步 */
    S.sel = act.i;
    S.hintSeq = parseCells(act.reason || '');
    if (S.hintSeq.indexOf(act.i) < 0) S.hintSeq.push(act.i);
    S.hintSeq = S.hintSeq.filter(function (v, i2, a) { return a.indexOf(v) === i2; });

    // 卡点快照：此刻的盘面 / 笔记 / 候选 + 这一步的技法，一起存进复盘本
    RW.hintCard = captureCard(act);

    paint();
    S.hintStep = 0;                        // 每条新提示都从第一步讲起
    renderHintCard();
    showHintSheet();                       // 弹出棋盘上方浮层提示（不自动消失，点「收起」才收）
    $('btnApply').hidden = false;
    $('hintTag').textContent = 'L' + act.level;
  }

  /* 提示卡分步渲染：一条小信息一步（这一步 → 为什么 → 原理 → 消耗/存卡），
     看懂点「下一步 ▸」再亮下一条；已看的步骤直接隐去（不再是暗着的一行），卡片只留当前这一步。
     未亮的步骤仍在 DOM 里（只是 display:none），方便无障碍与测试读取全文。 */
  function renderHintCard() {
    var a = S.hint; if (!a) return;
    if (typeof S.hintStep !== 'number') S.hintStep = 0;
    var t = TECHS[a.level - 1] || { name: '技巧', en: '', desc: '' };
    var where = 'R' + (Math.floor(a.i / 9) + 1) + 'C' + (a.i % 9 + 1);
    var action = a.kind === 'place'
      ? '在 <b>' + where + '</b> 填入 <b>' + a.v + '</b>'
      : '把 <b>' + where + '</b> 里的候选 <b>' + a.v + '</b> 划掉';
    var steps = [];

    steps.push('<div class="txt"><b style="color:var(--text)">这一步：</b>' + action +
      (a.kind === 'place' ? ' <span style="color:var(--text3)">（粗环=落点，细环=依据格）</span>'
                          : ' <span style="color:var(--text3)">（粗环=要处理的格子，细环=线索格' +
                            (a.unit ? '，淡色整片=依据的整行/列/宫' : '') + '）</span>') +
      '</div>');

    var chainHtml = '';
    if (a.kind === 'elim' && S.hintSeq.length > 1) {
      chainHtml = '<div style="margin-top:6px;font-size:11.5px;color:var(--text3);line-height:1.8">' +
        '看这条线：' + S.hintSeq.map(function (c, n) {
          return '<b style="color:var(--amber)">' + (n + 1) + '</b>.R' + (Math.floor(c / 9) + 1) + 'C' + (c % 9 + 1);
        }).join(' → ') + '</div>';
    }
    if (a.reason) steps.push('<div class="txt"><b style="color:var(--text)">为什么：</b>' + a.reason + '</div>' + chainHtml);
    /* 强制链的显式链：独立字段（不进 reason，否则 parseCells 会把链上格子全点亮） */
    if (a.chain) steps.push('<div class="txt"><b style="color:var(--text)">这条链：</b><span style="color:var(--text2)">' + a.chain + '</span></div>');
    steps.push('<div class="txt"><b style="color:var(--text2)">原理（' + t.name + '）：</b>' + t.desc + '</div>');
    steps.push('<div class="cost">本次提示消耗 <b>' + hintCost(a.level) + '</b> 点（L' + a.level +
      ' 级）· 本局累计 <b>' + S.hintCost + '</b> 点</div>' +
      '<div class="savedline">已把<b>提示前的局面</b>存进卡点本' +
      '<button class="lnk" id="hintUnsave">不要这条</button></div>');

    var n = steps.length;
    var html = '<div class="hintcard">' +
      '<div class="hd"><span class="lvbadge">L' + a.level + '</span>' +
      '<span class="tech">' + t.name + (t.en ? ' · ' + t.en : '') + '</span>' +
      '<span class="stepmark">' + (S.hintStep + 1) + ' / ' + n + '</span></div>';
    steps.forEach(function (s, i) {
      if (i < S.hintStep) {
        /* 已讲的步骤：彻底不显现（用户指令：折叠=完全不显示），卡片只留当前这一步；
           仍保留在 DOM 里（display:none），方便无障碍与测试读取全文 */
        html += '<div class="hstep past" style="display:none">' + s + '</div>';
      } else {
        html += '<div class="hstep' + (i > S.hintStep ? ' future' : '') + '">' + s + '</div>';
      }
    });
    /* 翻页按钮已上移到标题栏（应用/收起之间）：还有下一条就显示，讲完了自动收起；
       正文底部只留终态的「✓ 讲完了」。按钮是静态元素，点击绑定在 init 里只绑一次 */
    html += (S.hintStep >= n - 1 ? '<div class="hrow"><span class="hdone">✓ 讲完了，试着上手吧</span></div>' : '') + '</div>';
    $('hintBox').innerHTML = html;
    S.hintSteps = n;                              // 标题栏按钮靠它判断是否还有下一条
    $('btnApply').hidden = false;
    $('hintNext').hidden = S.hintStep >= n - 1;
    var un = $('hintUnsave');
    if (un) un.addEventListener('click', function () {
      if (RW.hintCard) removeCard(RW.hintCard.id, true);
      this.parentNode.innerHTML = '这条没有存进卡点本';
    });
  }

  function applyHint() {
    var a = S.hint; if (!a) return;
    S.combo = 0;                                  // 采纳提示 = 没自己推出来，连击清零（指令 4）
    pushHist();
    if (a.kind === 'place') {
      S.grid[a.i] = a.v; S.notes[a.i] = 0;
      var p = E.PEERS[a.i];
      for (var k = 0; k < p.length; k++) S.notes[p[k]] &= ~E.V(a.v);
    } else {
      // 把这次排除同时记进：① 引擎候选状态（推理要延续）② 玩家看得见的笔记
      S.elim[a.i] |= E.V(a.v);
      S.notes[a.i] &= ~E.V(a.v);
      if (!S.notes[a.i]) {
        var c = E.initCandidates(S.grid);
        S.notes[a.i] = c[a.i] & ~E.V(a.v);
      }
    }
    exitAutoNotes();                 // 采纳提示 = 盘面变化，离开「自动补笔」状态
    refreshCands();
    S.stuckAt = Date.now();
    clearHint(true);
    clearHint(false);
    renderHintEmpty();
    paint();
    checkDone();
  }

  /* ---------------- 技巧解锁 ---------------- */
  function unlockSkill(lv) {
    var u = LS.get(ukey('sd.unlocked'), []);
    if (u.indexOf(lv) < 0) { u.push(lv); LS.set(ukey('sd.unlocked'), u); toast('解锁新技巧：L' + lv + ' ' + (TECHS[lv - 1] || {}).name); }
    renderSkills();
  }
  function renderSkills() {
    var u = LS.get(ukey('sd.unlocked'), []);
    var box = $('skills');
    box.innerHTML = TECHS.map(function (t, i) {
      var has = u.indexOf(t.lv) >= 0;
      var cnt = S.used[t.lv] || 0;
      return '<div class="sk ' + (has ? 'unlocked' : 'locked') + '">' +
        '<div class="n">' + (has ? (t.lv === 8 ? '∞' : t.lv) : '?') + '</div>' +
        '<div class="b"><div class="t">L' + t.lv + ' ' + t.name +
          (cnt ? '<span class="c">本局用 ' + cnt + ' 次</span>' : '') + '</div>' +
        '<div class="d">' + t.desc + '</div>' +
        (has && t.when ? '<div class="h">什么时候用：' + t.when + '</div>' : '') +
        (has && t.how ? '<div class="h">怎么找：' + t.how + '</div>' : '') +
        (has ? '<div class="h"><button class="lnk" data-tut="' + t.lv + '">看个真实例子 →</button></div>' : '') +
        '</div></div>';
    }).join('');
    $('skillTag').textContent = u.length + ' / 8';
  }

  /* ============================================================
     卡点复盘本 · 实现
     ============================================================ */
  function cellName(i) { return 'R' + (Math.floor(i / 9) + 1) + 'C' + (i % 9 + 1); }
  function fmtDur(s) {
    if (s < 60) return s + ' 秒';
    return Math.floor(s / 60) + ' 分' + (s % 60 ? ' ' + (s % 60) + ' 秒' : '');
  }
  function bitsOf(mask) { var a = []; for (var d = 1; d <= 9; d++) if (mask & (1 << d)) a.push(d); return a; }
  /* 固定种子的洗牌：同一张卡的选项顺序每次都一样（便于复习时位置不漂移） */
  function shuffleSeeded(arr, seed) {
    var a = arr.slice(0), s = ((seed || 1) % 2147483646) || 1;
    function rnd() { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function loadCards() { var v = LS.get(ukey('sd.cards'), []); RW.cards = (v && v.length) ? v : []; }
  function saveCards() { LS.set(ukey('sd.cards'), RW.cards.slice(0, CARD_MAX)); }

  function byLevel() {
    var o = {};
    RW.cards.forEach(function (c) { o[c.step.level] = (o[c.step.level] || 0) + 1; });
    return o;
  }
  function cardStats() {
    var pend = 0, done = 0;
    RW.cards.forEach(function (c) { if (c.mastered) done++; else pend++; });
    return { total: RW.cards.length, pend: pend, done: done };
  }
  /* 卡点本每日任务：每天定一个「复习 N 张卡点」的小目标，完成进度本地留存。
     目标随待复习量自适应（最多 3 张，避免积压时目标虚高）。 */
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function dailyGoal() { return Math.max(1, Math.min(3, cardStats().pend || 3)); }
  function dailyState() {
    var v = LS.get(ukey('sd.daily'), null);
    if (!v || v.d !== todayStr()) { v = { d: todayStr(), n: 0 }; LS.set(ukey('sd.daily'), v); }
    return v;
  }
  function bumpDaily() { var v = dailyState(); v.n++; LS.set(ukey('sd.daily'), v); }
  function dailyText() {
    var v = dailyState(), g = dailyGoal();
    return '今日任务 ' + Math.min(v.n, g) + ' / ' + g + (v.n >= g ? ' ✓' : '');
  }
  function weakest() {
    var o = byLevel(), best = 0;
    for (var k in o) if (!best || o[k] > o[best]) best = k;
    return best ? { lv: +best, n: o[best] } : null;
  }

  /* 捕获一张卡点卡：提示前的盘面 + 当时的笔记 + 引擎候选 + 这一步的技法 */
  function captureCard(act) {
    var g = clone(S.grid);
    var id = S.tierKey + '#' + S.puzIdx + '#' + g.join('');
    var idx = -1;
    for (var i = 0; i < RW.cards.length; i++) if (RW.cards[i].id === id) { idx = i; break; }
    var stuck = S.stuckAt ? Math.round((Date.now() - S.stuckAt) / 1000) : 0;

    var card = {
      id: id, ts: Date.now(),
      tier: S.tierKey, puz: S.puzIdx, grade: S.grade, clues: S.clues,
      g: g,                                   // 提示前的盘面（不含答案）
      n: clone(S.notes),                      // 提示前玩家自己的笔记（复盘的关键）
      gv: S.given.map(Boolean),               // 哪些是题目给定数
      c: Array.prototype.slice.call(S.cands || []),  // 引擎当时的候选
      step: { kind: act.kind, i: act.i, v: act.v, level: act.level, reason: act.reason || '', chain: act.chain || '' },
      stuck: Math.min(stuck, 3600),
      applied: false, mastered: false, tries: 0
    };

    if (idx >= 0) {
      // 同一局面重复申请提示 → 只更新，不新增（避免「没看懂又点一次」刷出一堆重复卡）
      var old = RW.cards[idx];
      card.mastered = old.mastered; card.tries = old.tries; card.ts = old.ts;
      RW.cards.splice(idx, 1);
    }
    RW.cards.unshift(card);
    if (RW.cards.length > CARD_MAX) RW.cards.length = CARD_MAX;
    saveCards();
    renderCardBrief();
    if ($('drawer') && !$('drawer').hidden && RW.view === 'list') renderDrawer();
    return card;
  }

  function removeCard(id, silent) {
    for (var i = 0; i < RW.cards.length; i++) {
      if (RW.cards[i].id === id) {
        RW.cards.splice(i, 1);
        saveCards(); renderCardBrief();
        if ($('drawer') && !$('drawer').hidden) renderDrawer();
        if (!silent) toast('已删除这条卡点');
        return true;
      }
    }
    return false;
  }

  /* 清空：不用 confirm（某些环境不可用），改成「点两次」的二次确认 */
  var clearArm = 0;
  function onClear() {
    var b = $('dwClear');
    if (!RW.cards.length) { toast('卡点本是空的'); return; }
    if (Date.now() - clearArm > 3000) {
      clearArm = Date.now();
      b.textContent = '再点一次确认清空';
      setTimeout(function () { if (Date.now() - clearArm >= 3000) b.textContent = '清空'; }, 3200);
      return;
    }
    RW.cards = []; saveCards(); renderCardBrief(); renderDrawer();
    b.textContent = '清空';
    toast('卡点本已清空');
  }

  
  /* ---------------- 复制文本：三级兜底 ----------------
     ① navigator.clipboard.writeText —— 现代浏览器，要求安全上下文 + 剪贴板权限
     ② document.execCommand('copy') —— 老内核 / 内置浏览器 / 没权限时的老路
     ③ 两条都不行 → showCopyModal 把文字摆出来让用户长按复制

     2026-10-31 真机反馈：手机上 ① 被系统拒了，代码直接跳到 ③，弹层标题写「复制没成功」——
     看着像用户点错了。其实那是环境的限制，不是操作失误。现在 ① 失败先试 ②，
     只有 ② 也返回 false 才走 ③，且一律用说明性措辞。

     注：这一整段（连同下面的 legacyCopy）只在网页端有效 —— 小工具容器禁用剪贴板，
     device-capabilities.md §2 把 clipboard 与 execCommand 都列进禁用表，§6 还要求
     发布前按清单 grep 确认零残留，所以 build-xhs 会连注释一起剥掉。
     （注释里带 API 名，不剥也会被 grep 命中，别再把它挪到标记外面。） */
  /* 删掉之后 copyText 里的 typeof 判断会拿到 undefined，直接返回 false → 走可选文字弹层。 */
  function legacyCopy(text) {
    var ta = null, done = false;
    try {
      ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:0;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      /* iOS Safari 只认「可编辑 + Range 选中」，光调 select() 拿不到剪贴板内容 */
      try {
        ta.contentEditable = 'true';
        ta.readOnly = false;
        var r = document.createRange(); r.selectNodeContents(ta);
        var sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(r); }
        ta.setSelectionRange(0, String(text).length);
      } catch (e) { try { ta.select(); } catch (e2) {} }
      try { done = document.execCommand('copy'); } catch (e3) { done = false; }
    } catch (e4) { done = false; }
    if (ta && ta.parentNode) ta.parentNode.removeChild(ta);
    return !!done;
  }
  
  /* 统一成 Promise<boolean>：同步兜底也包一层，调用方只写一条链，不会出现「有时同步有时异步」 */
  function copyText(text) {
    return new Promise(function (resolve) {
      
      if (ENV.canClipboard) {
        try {
          var p = navigator.clipboard.writeText(text);
          if (p && typeof p.then === 'function') {
            p.then(function () { resolve(true); }, function () { resolve(legacyCopy(text)); });
            return;
          }
        } catch (e) {}
      }
      
      resolve(typeof legacyCopy === 'function' ? legacyCopy(text) : false);
    });
  }

  /* 文本兜底弹层：容器禁用剪贴板/下载时，把要带走的文字放进可选中的 textarea，
     用户长按全选复制。网页端不走到这里（ENV.canDownload / canClipboard 为真）。 */
  function showCopyModal(text, tip, opt) {
    opt = opt || {};
    var ov = document.createElement('div');
    ov.className = 'copyov';
    ov.innerHTML = '<div class="copybox"><h3>' + (tip || '长按下面的文字全选复制') + '</h3>' +
      (opt.note ? '<p class="cp-note">' + opt.note + '</p>' : '') +
      '<textarea readonly spellcheck="false"></textarea>' +
      '<button class="bigbtn cp-all" type="button">全选文字</button>' +
      '<button class="btn cp-close" type="button">关闭</button></div>';
    var ta = ov.querySelector('textarea');
    ta.value = text;
    document.body.appendChild(ov);
    /* 打开就整段选中：用户只要长按选中的文字 → 选「复制」，不用先自己拖选 */
    setTimeout(function () {
      try { ta.focus(); ta.setSelectionRange(0, String(text).length); ta.scrollTop = 0; ta.scrollLeft = 0; } catch (e) {}
    }, 40);
    function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
    ov.querySelector('.cp-all').addEventListener('click', function () {
      try { ta.focus(); ta.setSelectionRange(0, String(text).length); } catch (e) {}
      toast('已全选 · 长按选中的文字选「复制」');
    });
    ov.querySelector('.cp-close').addEventListener('click', close);
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    return ov;
  }

  function exportCards() {
    if (!RW.cards.length) { toast('卡点本是空的'); return; }
    try {
      var data = JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), cards: RW.cards }, null, 2);
      if (!ENV.canDownload) {
        showCopyModal(data, '卡点本已导出', {
          note: '点「全选文字」，再长按选中的文字选「复制」，贴到备忘录里存好。'
        });
        return;
      }
      var blob = new Blob([data], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'sudoku-review.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
      toast('已导出 ' + RW.cards.length + ' 条卡点');
    } catch (e) { toast('这个环境不支持导出'); }
  }

  /* ---------------- 缩略棋盘 ---------------- */
  function miniHtml(g, notes, opt) {
    opt = opt || {};
    var u = (opt.size || 76) / 9;
    var ord = {};
    (opt.src || []).forEach(function (c, n) { if (c !== opt.dst) ord[c] = n + 1; });
    var dstDelay = ((opt.src || []).length * 0.22).toFixed(2);

    var out = '<div class="mb' + (opt.dots ? ' mini' : '') + (opt.animate ? ' anim' : '') +
      '" style="--u:' + u.toFixed(2) + 'px">';
    var uset = {};
    (opt.unit || []).forEach(function (x) { uset[x] = 1; });
    for (var i = 0; i < 81; i++) {
      var r = (i / 9) | 0, c = i % 9, cls = 'mbc';
      if (c === 2 || c === 5) cls += ' e3';
      if (r === 2 || r === 5) cls += ' s3';
      if (uset[i] && i !== opt.dst && !ord[i]) cls += ' rvunit';
      var v = g[i], inner = '', style = '';
      if (v) {
        cls += (opt.given && opt.given[i]) ? ' gv' : ' uv';
        inner = String(v);
      } else if (notes && notes[i]) {
        /* 候选数照常全部显示（不藏、不替换）；链技巧只在候选格里把
           「正在追踪的那个数字」单独标出来，其余候选照旧 */
        var markV = (opt.chainV && (i === opt.dst || (opt.chain && opt.chain[i] !== undefined)))
          ? opt.chainV : 0;
        inner = '<i class="mbn">';
        for (var d = 1; d <= 9; d++) {
          var on = (notes[i] & (1 << d)) !== 0, sc = '';
          if (on) sc = (d === markV)
            ? ' class="on clm' + (i === opt.dst ? ' clk' : '') + '"'
            : ' class="on"';
          inner += '<s' + sc + '>' + (opt.dots ? '' : (on ? String(d) : '')) + '</s>';
        }
        inner += '</i>';
      }
      if (ord[i]) {
        cls += ' rvsrc';
        style = ' style="animation-delay:' + ((ord[i] - 1) * 0.22).toFixed(2) + 's"';
      }
      if (i === opt.dst) {
        cls += ' rvdst';
        style = ' style="animation-delay:' + dstDelay + 's"';
      }
      /* 链技巧专用：把同一条链上的格子按两种颜色染出来（0=蓝组 1=红组） */
      if (opt.chain && opt.chain[i] !== undefined) cls += opt.chain[i] ? ' clcb' : ' clca';
      out += '<b class="' + cls + '"' + style + '>' + inner + '</b>';
    }
    return out + '</div>';
  }

  /* ---------------- 侧栏摘要 ---------------- */
  function renderCardBrief() {
    var tag = $('cardTag'), box = $('cardBrief');
    var st = cardStats();
    // 顶栏卡点本按钮上的待复习徽章（有未掌握的就显示数字）
    var badge = $('navCardBadge');
    if (badge) {
      if (st.pend > 0) { badge.textContent = st.pend > 99 ? '99+' : String(st.pend); badge.hidden = false; }
      else badge.hidden = true;
    }
    /* J-B3 / K-1：左栏下部那张摘要卡（只在桌面三栏显示，手机/中等屏由 CSS 隐藏、不占位）。
       原本「没有卡点就整张藏起来」→ 新用户看到的是一大片空绿；现在空卡点也常驻，
       显示引导语，顺手把「最近 1~2 条卡点（难度 + 日期 + 一句话）」列出来。 */
    var ln = $('leftNote');
    if (ln) {
      var ltag = $('leftNoteTag'), lbody = $('leftNoteBody'), lbtn = $('leftNoteBtn');
      if (!st.total) {
        ltag.textContent = '还没有';
        if (lbody) lbody.innerHTML = '卡住时点键盘上的 <b>提示</b> —— 那一刻的盘面、你的笔记和用到的那一招会存进这里，之后回来重推。';
        if (lbtn) lbtn.textContent = '卡点本怎么用';
      } else {
        ltag.textContent = st.total + ' 条 · ' + st.pend + ' 待复习';
        if (lbody) {
          var recent = '';
          RW.cards.slice(0, 2).forEach(function (c) {
            var tt = TECHS[c.step.level - 1] || { name: '技巧' };
            var d2 = new Date(c.ts || Date.now());
            var act2 = c.step.kind === 'place'
              ? cellName(c.step.i) + ' 填入 ' + c.step.v
              : cellName(c.step.i) + ' 划掉 ' + c.step.v;
            recent += '<div class="ln-row">' +
              '<div class="ln-r1"><span class="lvbadge">L' + c.step.level + '</span><b>' + tt.name + '</b>' +
              '<i>' + (d2.getMonth() + 1) + '-' + d2.getDate() + '</i></div>' +
              '<div class="ln-r2">' + act2 + (c.mastered ? ' · 已掌握' : ' · 待复习') + '</div>' +
              '</div>';
          });
          lbody.innerHTML = recent + '<div class="ln-tip">' +
            (st.pend ? '还有 <b>' + st.pend + '</b> 条待复习，挑一条自己重推一遍最有用。'
                     : '都掌握了 ✓ 卡过的局面留着，手生时还能回来翻。') + '</div>';
        }
        if (lbtn) lbtn.textContent = '打开卡点本';
      }
    }
    if (!tag || !box) return;
    tag.textContent = st.total + ' 条';
    if (!st.total) {
      box.innerHTML = '<div class="empty" style="font-size:12.5px">还没有记录。一旦卡住、点了「教我下一步」，' +
        '这里会自动存下<b>当时的局面</b>和<b>用到的那一招</b>，之后可以回来重推。</div>';
      return;
    }
    var top = weakest();
    var dv = dailyState();
    box.innerHTML = '<div class="cbrief">' +
      '<span class="cbi"><b>' + st.pend + '</b>待复习</span>' +
      '<span class="cbi"><b>' + st.done + '</b>已掌握</span>' +
      '<span class="cbi' + (dv.n >= dailyGoal() ? ' w' : '') + '"><b>' + Math.min(dv.n, dailyGoal()) + '/' + dailyGoal() + '</b>今日复习</span>' +
      (top ? '<span class="cbi w">最常卡 L' + top.lv + ' <b>' + (TECHS[top.lv - 1] || {}).name + '</b></span>' : '') +
      '</div>';
  }

  /* ---------------- 抽屉 ---------------- */
  function openDrawer() {
    RW.view = 'list'; RW.cur = null; RW.replay = false; RW.qa = {}; RW.qaPick = {};
    $('drawer').hidden = false;
    renderDrawer();
    modalOpen($('drawer'), closeDrawer);
  }
  function closeDrawer() { $('drawer').hidden = true; mSync($('drawer')); }

  function renderDrawer() {
    $('dwTag').textContent = RW.cards.length + ' 条 · 待复习 ' + cardStats().pend + ' · ' + dailyText();
    var body = $('dwBody');
    if (RW.view === 'detail' && RW.cur) { body.innerHTML = detailHtml(RW.cur); bindDetail(); }
    else { body.innerHTML = listHtml(); bindList(); }
  }

  function listHtml() {
    if (!RW.cards.length) {
      return '<div class="dempty">卷卷羊先睡了……这里还没有卡点记录。<br><br>' +
        '玩法：遇到推不动的地方，点右下角的「教我下一步」。<br>' +
        '系统会把<b>那一刻的棋盘</b>、<b>你自己写的笔记</b>、<b>用到的那一招</b>一起存到这里，' +
        '之后随时回来重推一遍。</div>';
    }
    var st = cardStats();
    var o = byLevel(), maxn = 1;
    for (var k in o) maxn = Math.max(maxn, o[k]);
    var lvs = Object.keys(o).map(Number).sort(function (a, b) { return a - b; });

    var weak = '<div class="weakmap"><div class="wmttl">你的薄弱技巧图谱 <span>· 卡点按技巧等级分布</span></div>';
    lvs.forEach(function (lv) {
      var t = TECHS[lv - 1] || { name: '技巧' };
      weak += '<div class="wmrow"><span class="wl">L' + lv + '</span><span class="wn">' + t.name + '</span>' +
        '<i><b style="width:' + (o[lv] / maxn * 100).toFixed(1) + '%"></b></i><span class="wc">' + o[lv] + '</span></div>';
    });
    if (st.pend) weak += '<div class="wmnote">还有 <b>' + st.pend + '</b> 条待复习 —— 点开做一次自测，答对才算真正掌握。</div>';
    weak += '</div>';

    var list = '<div class="rlist">';
    RW.cards.forEach(function (c) {
      var t = TECHS[c.step.level - 1] || { name: '技巧' };
      var act = c.step.kind === 'place'
        ? '在 ' + cellName(c.step.i) + ' 填入 ' + c.step.v
        : '把 ' + cellName(c.step.i) + ' 的候选 ' + c.step.v + ' 划掉';
      list += '<div class="rcard" data-id="' + c.id + '">' +
        '<div class="rmb">' + miniHtml(c.g, c.n, { size: 76, dots: true, given: c.gv }) + '</div>' +
        '<div class="rinfo">' +
          '<div class="rtitle"><span class="lvbadge">L' + c.step.level + '</span>' + t.name +
            '<span class="rstate ' + (c.mastered ? 'ok' : 'pend') + '">' +
            (c.mastered ? '✓ 已掌握' : '待复习') + '</span></div>' +
          '<div class="rdesc">' + act + (c.stuck >= 5 ? ' · 卡了 ' + fmtDur(c.stuck) : '') +
            (c.tries ? ' · 自测 ' + c.tries + ' 次' : '') + '</div>' +
          '<div class="racts">' +
            '<button class="btn sm" data-act="open">复盘这一步</button>' +
            '<button class="btn sm gho" data-act="resume">↩ 回到卡点重推</button>' +
            '<button class="btn sm gho danger" data-act="del">删除</button>' +
          '</div>' +
        '</div></div>';
    });
    list += '</div>';

    return statsHtml(st) + weak + list;
  }

  function statsHtml(st) {
    var top = weakest();
    return '<div class="cardstats">' +
      '<div class="cstat"><b>' + st.total + '</b><span>卡点总数</span></div>' +
      '<div class="cstat hot"><b>' + st.pend + '</b><span>待复习</span></div>' +
      '<div class="cstat"><b>' + st.done + '</b><span>已掌握</span></div>' +
      (top ? '<div class="cstat w"><b>L' + top.lv + '</b><span>最常卡 · ' + (TECHS[top.lv - 1] || {}).name + '</span></div>' : '') +
      '</div>';
  }

  function bindList() {
    var cards = $('dwBody').querySelectorAll('.rcard');
    Array.prototype.forEach.call(cards, function (el) {
      var id = el.dataset.id;
      el.addEventListener('click', function (ev) {
        var btn = ev.target.closest ? ev.target.closest('button') : null;
        var act = btn ? btn.dataset.act : 'open';
        var card = null;
        for (var i = 0; i < RW.cards.length; i++) if (RW.cards[i].id === id) card = RW.cards[i];
        if (!card) return;
        if (act === 'del') return removeCard(id);
        if (act === 'resume') return resumeCard(card);
        RW.cur = card; RW.view = 'detail'; RW.replay = false; RW.qa = {}; RW.qaPick = {};
        renderDrawer();
      });
    });
  }

  /* ---------------- 详情 ---------------- */
  function buildQuiz(c) {
    var a = c.step, i = a.i, v = a.v, where = cellName(i);
    function mk(kind, ii, vv) {
      return kind === 'place' ? ('在 ' + cellName(ii) + ' 填入 ' + vv)
                              : ('把 ' + cellName(ii) + ' 的候选 ' + vv + ' 划掉');
    }
    var right = mk(a.kind, i, v);

    // 干扰项 A：同一个格子，换一个数字
    var cand = bitsOf((c.c && c.c[i]) || 0), alt = 0;
    for (var k = 0; k < cand.length; k++) if (cand[k] !== v) { alt = cand[k]; break; }
    if (!alt) alt = (v % 9) + 1;
    var d1 = mk(a.kind, i, alt);

    // 干扰项 B：同一个数字，换一个格子（取同行/列/宫里的另一个空格）
    var other = -1, peers = E.PEERS[i];
    for (var q = 0; q < peers.length; q++) if (!c.g[peers[q]]) { other = peers[q]; break; }
    var d2 = other >= 0 ? mk(a.kind, other, v) : mk(a.kind, i, alt === 9 ? 1 : alt + 1);

    var opts = shuffleSeeded([right, d1, d2], c.ts).map(function (t) { return { t: t, ok: t === right }; });

    // 第二问：这是哪一招
    var pool = [];
    for (var l = 1; l <= 8; l++) if (l !== a.level) pool.push(l);
    pool.sort(function (x, y) { return Math.abs(x - a.level) - Math.abs(y - a.level); });
    var lvRight = 'L' + a.level + ' ' + ((TECHS[a.level - 1] || {}).name || '');
    var lvOpts = shuffleSeeded([a.level, pool[0], pool[1]], c.ts + 7).map(function (lv) {
      var s = 'L' + lv + ' ' + ((TECHS[lv - 1] || {}).name || '');
      return { t: s, ok: lv === a.level };
    });

    return { q1: opts, q2: lvOpts };
  }

  function detailHtml(c) {
    var t = TECHS[c.step.level - 1] || { name: '技巧', en: '', desc: '' };
    var act = c.step.kind === 'place'
      ? '在 <b>' + cellName(c.step.i) + '</b> 填入 <b>' + c.step.v + '</b>'
      : '把 <b>' + cellName(c.step.i) + '</b> 里的候选 <b>' + c.step.v + '</b> 划掉';

    /* 强制链卡片：链文本里的格子一并进重演序列 → 「重演推理链」会按链路逐格点亮 */
    var seq = parseCells((c.step.reason || '') + (c.step.chain ? ' ' + c.step.chain : ''));
    if (seq.indexOf(c.step.i) < 0) seq.push(c.step.i);
    seq = seq.filter(function (x, n, arr) { return arr.indexOf(x) === n; });
    var chain = seq.filter(function (x) { return x !== c.step.i; });

    var q = buildQuiz(c);
    var replay = RW.replay;

    var board = miniHtml(c.g, c.n, {
      size: 306, given: c.gv,
      src: replay ? chain : [],
      dst: c.step.i,
      animate: replay
    });

    function optHtml(list, qi) {
      return list.map(function (o) {
        return '<button class="opt" data-q="' + qi + '" data-ok="' + (o.ok ? '1' : '0') + '">' + o.t + '</button>';
      }).join('');
    }

    var done = c.mastered;
    return '<button class="back" id="dwBack">← 返回卡点列表</button>' +
      '<div class="rvtop">' +
        '<div class="rvb">' + board + '</div>' +
        '<div class="rvside">' +
          '<div class="hintcard">' +
            '<div class="hd"><span class="lvbadge">L' + c.step.level + '</span>' +
              '<span class="tech">' + t.name + (t.en ? ' · ' + t.en : '') + '</span></div>' +
            '<div class="txt">' + t.desc + '</div>' +
            '<div class="txt" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--line)">' +
              '<b style="color:var(--text)">当时这一步：</b>' + act +
              '<br><span style="color:var(--text3)">牌面是你<b>卡住那一刻</b>的样子（' +
              (c.stuck >= 5 ? '当时卡了 ' + fmtDur(c.stuck) : '刚填到这一步') + '）</span></div>' +
            (c.step.chain ? '<div class="txt" style="margin-top:9px;font-size:12px;color:var(--text3)"><b style="color:var(--text)">这条链：</b>' + c.step.chain + '</div>' : '') +
            (chain.length ? '<div class="txt" style="margin-top:9px;font-size:12px;color:var(--text3)">看这条线：' +
              seq.map(function (x, n) {
                return '<b style="color:var(--amber)">' + (n + 1) + '</b>.' + cellName(x);
              }).join(' → ') + '</div>' : '') +
          '</div>' +
          '<div class="rvacts">' +
            '<button class="btn pri" id="rvReplay">▶ 重演推理链</button>' +
            '<button class="btn" id="rvResume">↩ 回到这个卡点重推</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="quiz">' +
        '<h4>自测：两问都答对才算「已掌握」' + (done ? ' <span class="okdone">✓ 已掌握</span>' : '') + '</h4>' +
        '<div class="qsub">这一步你当时没想出来 —— 现在把方法记住，才算真的会了。</div>' +
        '<div class="q" data-q="1"><p>① 这一步该怎么做？</p><div class="opts">' + optHtml(q.q1, 1) + '</div></div>' +
        '<div class="q" data-q="2"><p>② 用的是什么技巧？</p><div class="opts">' + optHtml(q.q2, 2) + '</div></div>' +
        '<div class="qres" id="qres" hidden></div>' +
      '</div>';
  }

  function bindDetail() {
    var c = RW.cur;
    $('dwBack').addEventListener('click', function () {
      RW.view = 'list'; RW.cur = null; RW.replay = false; renderDrawer();
    });
    // 重演：innerHTML 整个换新，节点是全新的，CSS 动画自然从头播
    $('rvReplay').addEventListener('click', function () {
      RW.replay = true; renderDrawer();
    });
    $('rvResume').addEventListener('click', function () { resumeCard(c); });

    var opts = $('dwBody').querySelectorAll('.opt');
    Array.prototype.forEach.call(opts, function (b) {
      b.addEventListener('click', function () {
        var qi = +b.dataset.q, ok = b.dataset.ok === '1';
        RW.qa['q' + qi] = ok;
        RW.qaPick['q' + qi] = b.textContent;
        // 就地标记，不重绘（重绘会打断已经播完的重演动画）
        var box = $('dwBody').querySelector('.q[data-q="' + qi + '"]');
        if (box) Array.prototype.forEach.call(box.querySelectorAll('.opt'), function (x) {
          x.disabled = true;
          if (x.dataset.ok === '1') x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        c.tries++;
        if (RW.qa.q1 != null && RW.qa.q2 != null) {
          var pass = !!(RW.qa.q1 && RW.qa.q2);
          var newly = pass && !c.mastered;
          if (pass) c.mastered = true;
          if (newly) bumpDaily();                       // 每日任务：今天掌握 1 张卡点 +1
          saveCards(); renderCardBrief();
          var mdone = 0; RW.cards.forEach(function (x) { if (x.mastered) mdone++; });
          showQuizResult(pass, c);
        }
      });
    });

    reapplyQuiz();
  }

  /* 重演会整体重绘 → 把已作答的状态重新贴回去（否则视觉上像没答过） */
  function reapplyQuiz() {
    ['1', '2'].forEach(function (qi) {
      var key = 'q' + qi;
      if (RW.qa[key] == null) return;
      var box = $('dwBody').querySelector('.q[data-q="' + qi + '"]');
      if (!box) return;
      var pick = RW.qaPick[key];
      Array.prototype.forEach.call(box.querySelectorAll('.opt'), function (x) {
        x.disabled = true;
        if (x.dataset.ok === '1') x.classList.add('right');
        else if (x.textContent === pick) x.classList.add('wrong');
      });
    });
    if (RW.qa.q1 != null && RW.qa.q2 != null) {
      showQuizResult(!!(RW.qa.q1 && RW.qa.q2), RW.cur);
    }
  }

  function showQuizResult(pass, c) {
    var box = $('qres'); if (!box) return;
    var t = TECHS[c.step.level - 1] || { name: '技巧' };
    box.className = 'qres ' + (pass ? 'pass' : 'fail');
    box.hidden = false;
    box.innerHTML = pass
      ? '<b>✓ 两问都对了。</b>这一招你已经认得出来了，已标记为「已掌握」。<br>' +
        '最后一步检验：点上面的「↩ 回到这个卡点重推」——<b>自己动手把它推出来</b>，才算真的吃透。'
      : '<b>再看看上面的解析。</b>记住这一招的关键是：' + t.desc + '<br>' +
        '不用急，这条会一直留在「待复习」，过两天回来重做一次就行。';
  }

  /* 回到卡点：把快照载入当前对局，从「你当时卡住的那一步」重新开始 */
  function resumeCard(c) {
    closeDrawer();
    newGame(c.tier, c.puz);
    S.grid = clone(c.g);
    S.notes = c.n ? clone(c.n) : new Array(81).fill(0);
    if (c.gv) S.given = c.gv.slice(0);
    S.solved = false; S.hint = null; S.hintSeq = [];
    S.stuckAt = Date.now();
    resetElim();
    clearHint(true); renderHintEmpty();
    paint();
    toast('已回到当时的卡点 · 这次自己推推看');
  }

  /* ---------------- 完成 ---------------- */
  function showDone() {
    var mx = 0;
    for (var k in S.used) mx = Math.max(mx, +k);
    var dailyLine = '';
    if (S.daily) {
      var dst = DAILY.stat();
      dailyLine = '<br>每日挑战完成 · 已连续 <b>' + (dst.streak || 1) + '</b> 天打卡';
    }
    /* 挑战局（指令 10）：把好友成绩摆在同一行比 —— 比「用时」是玩家最直觉的胜负线 */
    var chalLine = '';
    if (S.chal) {
      var cs = S.chal.score;
      if (cs) {
        var dt = Math.round(S.elapsed) - cs.t;
        chalLine = '好友 ' + fmtTime(cs.t) + ' · 你 ' + fmtTime(S.elapsed) + ' —— ' +
          (dt < 0 ? '快 ' + fmtTime(-dt) : dt === 0 ? '打平手' : '慢 ' + fmtTime(dt));
      } else {
        chalLine = '超越发起人的机会：你用了 ' + fmtTime(S.elapsed);
      }
    }
    // 拼图块奖励：独立成醒目卡片，展示本次获得的拼图块缩略图 + 进度
    var pzReward = '';
    if (PZ.lastGain) {
      var g = PZ.lastGain;
      pzReward = '<div class="pzreward' + (g.done ? ' done' : '') + '">' +
        '<div class="pzr-img">' +
          (g.pieceImg ? '<img src="' + g.pieceImg + '" alt="">' : '<svg class="pzi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 5.5 H9 Q8.5 3 11 3 Q13.5 3 13 5.5 H15.5 Q17 5.5 17 7 V9.5 Q19.5 9 19.5 11.5 Q19.5 14 17 13.5 V16 Q17 17.5 15.5 17.5 H7 Q5.5 17.5 5.5 16 V13.5 Q3 14 3 11.5 Q3 9 5.5 9.5 V7 Q5.5 5.5 6.5 5.5 Z"/></svg>') +
        '</div>' +
        '<div>' +
          '<div class="pzr-t">' + (g.done ? '<span class="pzr-win">' + STARS + '</span>集齐一整幅' : '<svg class="pzt-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 5.5 H9 Q8.5 3 11 3 Q13.5 3 13 5.5 H15.5 Q17 5.5 17 7 V9.5 Q19.5 9 19.5 11.5 Q19.5 14 17 13.5 V16 Q17 17.5 15.5 17.5 H7 Q5.5 17.5 5.5 16 V13.5 Q3 14 3 11.5 Q3 9 5.5 9.5 V7 Q5.5 5.5 6.5 5.5 Z"/></svg>拼图块奖励') + '</div>' +
          '<div class="pzr-d">' + g.themeName + ' · ' + g.levelTitle + '</div>' +
          '<div class="pzr-p">' + (g.done ? '这幅拼好啦，自动进入下一幅！' : '这幅进度 ' + g.gotCount + ' / 16' +
            '（全图 ' + PZ.count() + ' / ' + PZ.TOTAL + '）') + '</div>' +
        '</div>' +
      '</div>';
    }
    /* 指令 J-B4：结算别只有「再来一题」（随机换题）和「退出」。
       给一个语义定向的主入口：今日每日题还没打卡 → 直奔每日挑战；已打卡 → 进下一难度档。
       玩家从「刚赢一局」自然流向「再来一局」，而不是关掉页面。 */
    var nextLabel, nextAct;
    if (!DAILY.isDoneToday()) {
      nextLabel = '挑战今日每日题';
      nextAct = function () { DAILY.start(); };
    } else {
      var nIdx = Math.min((S.tierIdx || 0) + 1, BANK.tiers.length - 1);
      if (nIdx === (S.tierIdx || 0)) {
        nextLabel = '再战这一档';
        nextAct = function () { newGame(S.tierKey, null); };
      } else {
        nextLabel = '进入「' + BANK.tiers[nIdx].name + '」档';
        nextAct = function () { newGame(BANK.tiers[nIdx].key, null); };
      }
    }
    var ov = document.createElement('div');
    ov.className = 'doneov';
    ov.innerHTML =
      '<div class="box">' +
      '<div class="dhead">' +
        '<div class="em">' + STARS + '</div>' +
        '<h2>' + (S.mistakes === 0 && S.hints === 0 ? '完美通关！' : '解出来了！') + '</h2>' +
        '<div class="dstats">' +
          '<div class="dstat"><b>' + fmtTime(S.elapsed) + '</b><span>用时</span></div>' +
          '<div class="dstat"><b>' + S.mistakes + '</b><span>错误</span></div>' +
          '<div class="dstat"><b>' + S.hints + '</b><span>提示</span></div>' +
        '</div>' +
        '<div class="dtech">' + (mx ? '最高技巧 L' + mx + ' ' + (TECHS[mx - 1] || {}).name : '全程只用了「唯一余数」') + '</div>' +
        (dailyLine ? '<div class="ddaily">' + dailyLine.replace(/^<br>/, '') + '</div>' : '') +
        (chalLine ? '<div class="dchal">' + chalLine + '</div>' : '') +
      '</div>' +
      '<div class="dbody">' +
        pzReward +
        (S.daily ? '<button class="btn gho dchalbtn" id="doneChal" type="button">发起「挑战我」链接</button>' : '') +
        '<canvas class="sharecv" id="shareCv" title="长按或右键也可以保存"></canvas>' +
      '</div>' +
      '<div class="dfoot">' +
        '<button class="btn pri wide" id="doneGo" type="button">' + nextLabel + '</button>' +
        '<button class="btn gho" id="doneNext">再来一题</button>' +
        '<button class="btn gho" id="doneShare">保存分享卡</button>' +
        '<button class="btn gho wide sm" id="doneClose">看看棋盘</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    modalOpen(ov, function () { ov.remove(); }, { mask: false });   /* 遮罩点击不关：防误触丢结算 */
    var shareBtn = ov.querySelector('#doneShare');
    if (shareBtn) { shareBtn.disabled = true; shareBtn.title = '分享卡绘制中…'; }
    try {
      drawShareCard($('shareCv'), {
        date: (new Date().getMonth() + 1) + '月' + new Date().getDate() + '日',
        tierName: S.tier.name, grade: S.grade, time: fmtTime(S.elapsed),
        mistakes: S.mistakes, hints: S.hints, maxTech: mx,
        maxTechName: (TECHS[mx - 1] || {}).name || '',
        grid: S.grid, given: S.given, streak: S.daily ? (DAILY.stat().streak || 1) : 0,
        chal: S.chal ? { date: CHAL.dateLabel(S.chal.dk), tier: S.chal.tier.name } : null,
        pz: PZ.lastGain ? { name: PZ.lastGain.themeName + ' · ' + PZ.lastGain.levelTitle,
                            n: PZ.lastGain.gotCount } : null
      });
    } catch (e) { $('shareCv').hidden = true; }
    if (shareBtn) {                                  /* 绘制是同步的，画完才放开按钮 */
      shareBtn.disabled = false; shareBtn.title = '存成 PNG，发到社交平台';
    }
    ov.querySelector('#doneClose').addEventListener('click', function () { modalCloseTop(); });
    ov.querySelector('#doneGo').addEventListener('click', function () { modalCloseTop(); nextAct(); });
    ov.querySelector('#doneNext').addEventListener('click', function () { modalCloseTop(); newGame(S.tierKey, null); });
    ov.querySelector('#doneShare').addEventListener('click', function () {
      var cv = ov.querySelector('#shareCv');
      if (!cv || !cv.width) { toast('分享卡还没画好，稍等一下再点'); return; }
      var dataUrl;
      try { dataUrl = cv.toDataURL('image/png'); } catch (e0) { toast('分享卡还没准备好，稍等一下'); return; }
      function viaDownload() {
        try {
          var a = document.createElement('a');
          a.download = '卷卷羊数独学园-分享卡.png';
          a.href = dataUrl;
          document.body.appendChild(a); a.click(); a.remove();
          toast('分享卡已保存，发到社交平台还能为作品攒人气');
        } catch (e) { toast('这个浏览器不支持直接保存，试试长按 / 右键图片'); }
      }
      /* 小红书小工具：容器禁用 a[download]，改存系统相册；失败再退回下载 */
      if (ENV.xhs && ENV.bridge) {
        var r;
        try { r = ENV.miniTool.saveImageToPhotosAlbum({ filePath: dataUrl }); }
        catch (e1) { viaDownload(); return; }
        if (r && typeof r.then === 'function') r.then(function () { toast('分享卡已存入相册'); }, viaDownload);
        else viaDownload();
        return;
      }
      viaDownload();
    });
    /* 发起挑战（指令 10）：只有每日挑战局能发出「同一盘」的链接 ——
       题目由「日期 + 档位」确定，别的情况下拼出来的链接打不开同一局，那就不发。

       2026-10-31 用户报「点了没反应」。根因有两层：
       ① 提示条 .toast 的 z-index 是 70，比结算弹窗 .doneov 的 80 低 —— 复制成功的
          toast 被弹窗盖住，看起来就是「按钮死掉了」（CSS 那边已把 toast 提到 300）；
       ② 小工具里 location.origin 是 "null"，拼出的链接本身也不能用。
       现在除了修这两处，还让按钮**自己变字**给反馈（不依赖 toast），
       剪贴板被拒（同步抛 / Promise 拒绝）时一律退回手动复制弹层，不留死路。 */
    var cbtn = ov.querySelector('#doneChal');
    if (cbtn) cbtn.addEventListener('click', function () {
      var url = CHAL.linkFor(S.daily, S.tierKey);
      var label = cbtn.textContent, t1 = 0;
      function flash(txt) {
        cbtn.textContent = txt;
        if (t1) clearTimeout(t1);
        t1 = setTimeout(function () { cbtn.textContent = label; }, 2600);
      }
      function manual(tip) {
        flash('链接在弹窗里 · 长按复制');
        showCopyModal(url, tip || '复制链接，发给好友', {
          note: '点「全选文字」，再长按选中的文字选「复制」，就能发给好友了。'
        });
      }
      copyText(url).then(function (okd) {
        if (okd) {
          flash('✓ 链接已复制 · 发给好友');
          toast('挑战链接已复制 · 发给好友，他点开就是你这一局');
        } else manual();
      });
    });
  }

  /* ---------------- 主题 / 键盘 ---------------- */
  function setTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    LS.set('sd.theme', t);
  }
  /* 实体键盘「笔记模式」粘滞开关：像 Shift 一样整体翻转数字键的分工（PC 用，触屏隐藏） */
  function applyNoteMode() {
    var b = $('btnNote');
    if (b) { b.setAttribute('aria-pressed', S.noteMode ? 'true' : 'false'); b.textContent = '笔记 ' + (S.noteMode ? '开' : '关'); }
    var p = $('pad'); if (p) p.classList.toggle('notemode', !!S.noteMode);
  }
  function toggleNoteMode() {
    S.noteMode = !S.noteMode;
    LS.set('sd.notemode', !!S.noteMode);
    applyNoteMode();
    toast(S.noteMode ? '⌨️ 笔记模式开：数字键=记候选，小键盘=填确定（N 切回）'
                     : '⌨️ 笔记模式关：数字键=填确定，小键盘=记候选（N 切换）');
  }

  function bindKeys() {
    document.addEventListener('keydown', function (ev) {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      var k = ev.key;
      // 正在输入时（昵称 / 密码 / 存档码 等），数字、退格、空格、方向键一律交还给输入框。
      // 否则会被下面的棋盘快捷键抢走并 preventDefault，表现为「密码框打不进字，只能靠填充」。
      var tg = ev.target;
      var editing = !!tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' ||
                             tg.tagName === 'SELECT' || tg.isContentEditable === true);
      if (editing && k !== 'Escape') return;   // Esc 仍允许关弹层
      // Esc 逐层退出：抽屉 → 二级视图 → 提示高亮
      if (k === 'Escape') {
        if (modalCloseTop()) return;                    /* ① 栈顶弹层逐层关 */
        var moreOpen = document.querySelector('.more[open]');
        if (moreOpen) { moreOpen.open = false; return; } /* ② 棋局设置气泡 */
        if (!$('drawer').hidden) { closeDrawer(); return; }
        if (S.view !== 'play') { backToPlay(); return; }
        if (D.active) { draftExit(false); return; }      /* 草稿：Esc 退出（有假设会二次确认） */
        if (S.hint) { clearHint(true); paint(); }
        return;
      }
      // 不在做题页时，数字键与功能键一律不响应（避免在「关于」页翻着说明把棋盘改乱）
      if (S.view !== 'play') return;
      // 实体键盘分工（对齐屏上两行键盘）：
      //   主键盘 1-9 = 填确定数 · 小键盘 1-9 = 记候选笔记（NumLock 开启时）
      // 「笔记模式」粘滞开关（N 键 / 状态栏按钮）：像打字按住 Shift 一样整体翻转 ——
      //   开启后主键盘数字变笔记、小键盘变确定数；Shift 仍随时临时反转（Shift+数字=笔记）。
      // 手机不受影响：触屏设备隐藏切换按钮，屏上两行键盘照旧。
      var shiftMap = { '!': 1, '@': 2, '#': 3, '$': 4, '%': 5, '^': 6, '&': 7, '*': 8, '(': 9 };
      var np = (ev.code || '').indexOf('Numpad') === 0 && k >= '1' && k <= '9';
      var d = np ? +k : (k >= '1' && k <= '9' ? +k : (shiftMap[k] || 0));
      if (d) {
        var note = np ? !S.noteMode : !!S.noteMode;    // 默认分工：主键盘=确定，小键盘=笔记
        if (ev.shiftKey || shiftMap[k]) note = !note;  // Shift = 临时反转（像打字按住 Shift）
        put(d, note); ev.preventDefault(); return;
      }
      if (k === 'n' || k === 'N') { toggleNoteMode(); return; }
      if (k === '0' || k === 'Backspace' || k === 'Delete') { erase(); ev.preventDefault(); return; }
      if (k === 'h' || k === 'H') { doHint(); return; }
      if (k === 'u' || k === 'U') { undo(); return; }
      if (k === 'f' || k === 'F') { toggleFocus(); return; }
      if (k === ' ') { togglePause(); ev.preventDefault(); return; }
      var d = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 }[k];
      if (d != null) {
        ev.preventDefault();
        if (S.sel < 0) S.sel = 0;
        else { var n = S.sel + d, r = Math.floor(S.sel / 9), c = S.sel % 9;
          if (d === -1 && c === 0) return; if (d === 1 && c === 8) return;
          if (n < 0 || n > 80) return; S.sel = n; }
        if (S.grid[S.sel]) S.curDigit = S.grid[S.sel];
        paint();
      }
    });
  }

  /* ---------------- 视图切换：做题是独立界面，教学/说明类内容各占一页 ----------------
     做题页只留「解题必需」的东西（难度、状态、棋盘、键盘、提示卡）；技巧图鉴与
     玩法说明是长内容，塞进同一屏会把棋盘挤下去、手机上还得滚动，所以各做一个独立视图。
     卡点本仍然用抽屉：它是在做题过程中随手开合的动作，跳页面会打断心流。 */
  var RECORDS = (function () {
    function fmt(t) { t = t || 0; var m = Math.floor(t / 60), s = t % 60; return (m ? m + '分' : '') + s + '秒'; }
    var STATUS = { done: '完成', progress: '进行中', abandon: '放弃' };
    function render(filter) {
      filter = filter || 'all';
      var r = getRecords(), ids = Object.keys(r).sort(function (a, b) { return (r[b].updatedAt || 0) - (r[a].updatedAt || 0); });
      var list = $('recList'), empty = $('recEmpty'); if (!list) return;
      var items = ids.filter(function (id) { return filter === 'all' || r[id].status === filter; });
      list.innerHTML = '';
      if (empty) empty.hidden = items.length > 0;
      if (!items.length) { updateRecBadge(); return; }
      items.forEach(function (id) {
        var rec = r[id], pct = rec.total ? Math.round((rec.filled || 0) / rec.total * 100) : 0;
        var tn = (BANK.tiers.filter(function (t) { return t.key === rec.tier; })[0] || {}).name || rec.tier;
        var div = document.createElement('div'); div.className = 'rec-item';
        div.innerHTML =
          '<div class="rec-main">' +
            '<div class="rec-top"><span class="rec-badge rec-' + rec.status + '">' + (STATUS[rec.status] || rec.status) + '</span>' +
            '<span class="rec-tier">' + tn + ' · L' + (rec.grade || '?') + '</span>' +
            '<span class="rec-time">' + fmt(rec.time) + '</span></div>' +
            '<div class="rec-bar"><i style="width:' + pct + '%"></i></div>' +
            '<div class="rec-sub">已填 ' + (rec.filled || 0) + ' / ' + (rec.total || 81) + ' · ' + pct + '%</div>' +
          '</div>' +
          '<div class="rec-acts">' +
            '<button class="btn sm rec-open" data-act="open" data-id="' + id + '">' + (rec.status === 'done' ? '重玩' : '继续') + '</button>' +
            '<button class="btn sm rec-del" data-act="del" data-id="' + id + '">删除</button>' +
          '</div>';
        list.appendChild(div);
      });
      updateRecBadge();
    }
    return { render: render };
  })();
  /* ============================================================
     新手教程 · 实现
     每一招都配一个「真实局面」：从题库挑一道至少需要这一招的题，
     先用低一级的招数推到推不动 —— 剩下的那一步必然只能用这一招。
     所以教程里看到的例子，就是这招真正该出场的时刻（不是硬编的示意图）。
     ============================================================ */
  var TUT = (function () {
    var cur = 0;            // 当前章（1–8），0 = 还没选
    var seeds = {};         // 每章的「换一个例子」游标
    var last = {};          // 缓存最近一次生成的局面

    function poolFor(K) {
      var bank = window.SUDOKU_BANK, out = [];
      if (!bank || !bank.tiers) return out;
      bank.tiers.forEach(function (t) {
        (t.puzzles || []).forEach(function (p) { if ((p.grade || 0) >= K) out.push(p); });
      });
      return out;
    }

    /* 造一个「只能靠第 K 招」的局面：先用 L1..L(K-1) 推到穷尽，再取一次 K 级提示 */
    function gen(K, seed) {
      var pool = poolFor(K);
      if (!pool.length) return null;
      var tries = Math.min(pool.length, K >= 7 ? 40 : 24);
      for (var n = 0; n < tries; n++) {
        var p = pool[((seed || 0) + n) % pool.length];
        var g = [];
        for (var i = 0; i < 81; i++) g.push(p.g.charCodeAt(i) - 48);
        var c = E.initCandidates(g);
        /* 注意：引擎里 maxLevel = maxLevel || 8 —— 传 0 会被当成「不限级」，
           所以 L1 那一章（K-1 = 0）必须整个跳过预推，否则一上来就把题全解完了 */
        if (K > 1) {
          var guard = 0;
          while (guard++ < 400) {
            var a = E.nextHintState(g, c, K - 1);    // 低一级的招数全用光
            if (!a) break;
            E.applyAction(g, c, a);
          }
        }
        var step = E.nextHintState(g, c, K);
        if (step && step.level === K) return { g: g, c: c, step: step, at: (seed || 0) + n };
      }
      return null;
    }

    function renderNav() {
      var nav = $('tutNav'); if (!nav) return;
      nav.innerHTML = TECHS.map(function (t) {
        return '<button class="tn' + (t.lv === cur ? ' on' : '') + '" data-k="' + t.lv + '">' +
          'L' + t.lv + ' · ' + t.name + '</button>';
      }).join('');
    }

    function render() {
      var box = $('tutBody'); if (!box) return;
      if (!cur) { box.innerHTML = '<div class="empty">选一招开始看 ↓</div>'; return; }
      var K = cur, t = TECHS[K - 1];
      var hit = gen(K, seeds[K] || 0);
      if (!hit) {
        box.innerHTML = '<div class="empty">这一招暂时没找到合适的真实例子（题库里能用上它的题不多），' +
          '点「换一个例子」再试一次。</div>';
        return;
      }
      last[K] = hit;
      var st = hit.step;
      var seq = parseCells(st.reason || '');
      var where = 'R' + (Math.floor(st.i / 9) + 1) + 'C' + (st.i % 9 + 1);
      var act = st.kind === 'place'
        ? '在 <b>' + where + '</b> 填入 <b>' + st.v + '</b>'
        : '把 <b>' + where + '</b> 里的候选 <b>' + st.v + '</b> 划掉';

      /* 只把「看得懂这一步」所需要的候选显示出来，其余格子留白，避免 81 格全是小数字 */
      var keep = {};
      seq.forEach(function (x) { keep[x] = 1; });
      keep[st.i] = 1;
      (st.unit || []).forEach(function (x) { keep[x] = 1; });
      for (var i = 0; i < 81; i++) if (!hit.g[i] && (hit.c[i] & (1 << st.v))) keep[i] = 1;
      var notes = [];
      for (var j = 0; j < 81; j++) notes.push(keep[j] ? hit.c[j] : 0);

      /* 链技巧：引擎已经把整条链染色算好了，这里筛出当前分量画到棋盘上（0=蓝 1=红） */
      var chain = null;
      if (st.colors && st.components) {
        chain = {};
        for (var ck in st.colors) if (st.components[ck] === st.compId) chain[ck] = st.colors[ck];
      }

      var board = miniHtml(hit.g, notes, {
        size: 288, given: hit.g, src: seq.filter(function (x) { return x !== st.i; }),
        dst: st.i, unit: st.unit || [], chain: chain,
        chainV: chain ? st.chainDigit : 0
      });

      var steps = '';
      steps += row('这一步', act);
      if (st.reason) steps += row('为什么', st.reason);
      if (st.chain) steps += row('这条链', '<span style="color:var(--text2)">' + st.chain + '</span>');
      steps += row('怎么找', t.how);

      box.innerHTML =
        '<div class="tut-ch">' +
          '<div class="tut-hd"><span class="lvbadge">L' + K + '</span><b>' + t.name + '</b>' +
            '<span class="tut-en">' + t.en + '</span></div>' +
          '<div class="tut-desc"><b>这一招：</b>' + t.desc + '</div>' +
          '<div class="tut-when"><b>什么时候用：</b>' + t.when + '</div>' +
          (t.primer ? '<div class="tut-primer"><button class="tp-toggle" id="tpToggle">收起</button>' + t.primer + '</div>' : '') +
          '<div class="tut-wrap">' +
            '<div class="tut-board">' + board +
              '<div class="tut-legend">' +
                (chain ? '<span><i class="lg ca"></i>蓝色一组</span>' +
                         '<span><i class="lg cb"></i>红色一组</span>' : '') +
                '<span><i class="lg dst"></i>' + (chain ? '要划掉这个数' : '要动的格子') + '</span>' +
                (chain ? '' : '<span><i class="lg src"></i>依据格 / 线索格</span>') +
                '<span><i class="lg unit"></i>依据单元</span>' +
              '</div>' +
            '</div>' +
            '<div class="tut-steps">' +
              '<div class="tut-sub">这个真实局面里，这一招是这样用的：</div>' + steps +
            '</div>' +
          '</div>' +
          '<div class="tut-acts">' +
            '<button class="btn sm" id="tutPrev">← 上一招</button>' +
            '<button class="btn sm pri" id="tutAgain">换一个例子</button>' +
            '<button class="btn sm" id="tutNext">下一招 →</button>' +
          '</div>' +
        '</div>';

      var pv = $('tutPrev'); if (pv) { pv.disabled = (K <= 1); pv.addEventListener('click', function () { cur = Math.max(1, cur - 1); renderNav(); render(); }); }
      var nx = $('tutNext'); if (nx) { nx.disabled = (K >= 8); nx.addEventListener('click', function () { cur = Math.min(8, cur + 1); renderNav(); render(); }); }
      var ag = $('tutAgain'); if (ag) ag.addEventListener('click', function () { seeds[K] = ((seeds[K] || 0) + 1) % 9999; render(); });
      var tg = $('tpToggle');
      if (tg) tg.addEventListener('click', function () {
        var p = tg.parentNode;
        p.classList.toggle('fold');
        tg.textContent = p.classList.contains('fold') ? '展开' : '收起';
      });
    }

    function row(k, v) {
      return '<div class="tut-step"><b>' + k + '：</b><span>' + v + '</span></div>';
    }

    return {
      show: function () { if (!cur) cur = 1; renderNav(); render(); },
      open: function (k) { cur = k || 1; renderNav(); render(); },
      render: render, renderNav: renderNav
    };
  })();

  var VIEWS = ['play', 'skills', 'about', 'puzzle', 'stats', 'records', 'tutorial'];

  /* ---------------- 单屏锁定 ----------------
     做题页固定为一屏：页面本身不滚动（手机 / PC 同规则）。
     棋盘尺寸同时受宽度和剩余高度约束 —— 由这里实测后写进 --stage，
     棋盘 / 键盘 / 提示按钮全部对齐这个宽度。「教我下一步」和键盘永远可见。 */
  /* 安全区实测（只在无边框容器里非 0：小红书小工具 viewport-fit=cover）。
     网页端恒为 0，所以下面凡是减 SAFE.b 的地方，网页端数字与原来一模一样。
     为什么必须量：fitScale 的预算基准是 window.innerHeight，它把刘海和 Home 条都算进了
     「可用高度」，容器里据此算出来的版面会一头顶到 Home 条上（键盘压住小白条）。 */
  var _safe = null;
  function safeInsets() {
    if (_safe) return _safe;
    function m(p) {
      try {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;left:0;top:0;width:0;height:' + p + ';visibility:hidden;pointer-events:none';
        (document.body || document.documentElement).appendChild(d);
        var v = d.getBoundingClientRect().height; d.remove(); return v || 0;
      } catch (e) { return 0; }
    }
    _safe = { t: m('env(safe-area-inset-top,0px)'), b: m('env(safe-area-inset-bottom,0px)') };
    return _safe;
  }

  function fitBoard() {
    var vp = $('view-play'); if (!vp) return;
    var wrap = vp.querySelector('.boardwrap'); if (!wrap) return;
    var pad = $('pad'); if (!pad) return;
    var bh = $('btnHint');                          // 「教我下一步」大按钮已并入键盘的「提示」键，可能不存在
    vp.style.removeProperty('--stage');            // 先复位，按当前窗口重新量
    var wide = window.matchMedia && window.matchMedia('(min-width:720px)').matches;
    var size;
    // 关键：可用高度以 window.innerHeight（可视视口）为基准。
    // 部分内置浏览器的 dvh/flex 高度不含自身地址栏与导航栏，量出来偏大 → 底部被裁；
    // innerHeight 加上做题区顶边到视口顶的距离，才是真实可用空间。
    var playTop = Math.max(0, vp.getBoundingClientRect().top);
    var availH = (window.innerHeight || 0) - playTop - 12;
    /* 挑战横幅（指令 10）贴在顶部，宽屏时把它的高度从棋盘预算里扣掉，避免压住棋盘 */
    if (vp.classList.contains('haschal') && (window.matchMedia ? window.matchMedia('(min-width:720px)').matches : window.innerWidth >= 720))
      availH -= 42;
    if (!(availH > 0)) availH = vp.clientHeight || wrap.clientHeight || 600;
    if (wide) {
      // 宽屏左右布局：键盘在棋盘右侧 → 按视口预算算棋盘边长；
      // 720~899 的窄窗用瘦版两栏（侧栏 190 / 键盘 200），≥900 用标准（250 / 256）
      var slim = window.innerWidth < 900;
      var sideW = slim ? 190 : 250, padW = slim ? 200 : 256;
      var cg = slim ? Math.min(28, Math.max(14, window.innerWidth * 0.02))
                    : Math.min(56, Math.max(28, window.innerWidth * 0.035));
      var budget = window.innerWidth - sideW - padW - 48 - cg * 2;
      var bhH = bh ? (bh.offsetHeight || 46) : 0, rowGap = 10;
      size = Math.floor(Math.min(availH - bhH - rowGap - 8, budget, 500));
    } else {
      // 窄屏（手机竖排）：棋盘按「视觉宽度」定大小（上限 460），
      // 高度是否放得下交给 fitScale 整体等比缩放处理 —— 不要在这里再扣高度，
      // 否则「棋盘缩小 + 整体再缩小」双重收缩，棋盘会小得没法玩。
      // 注意必须用 getBoundingClientRect().width（视觉外框 px）而不是 clientWidth：
      // clientWidth 是元素「自身坐标系」的值，一旦 zoom<1 会被放大 1/zoom 倍
      // （实测 375px 屏量出 503px），拿它算棋盘就会大到溢出屏幕。
      // 2026-10-30：原来这里减 8（给棋盘投影留边），但窄屏的 .board 是用 :root 的
      // --cell=min(100vw-26px,…) 算的，两把尺差 10px → 棋盘比键盘宽、右边缘顶出卡片。
      // 现在窄屏 CSS 让 .board 也用 --stage（见 new1.css「棋盘与键盘同一把尺」），这里取满宽。
      var wBased = Math.floor(Math.min((vp.getBoundingClientRect().width || 0), 520));
      if (!ZOOM_OK) {
        // 浏览器不支持 zoom（极老的 WebView）：只能用「压棋盘高度」的老办法塞进一屏
        var bhH2 = bh.offsetHeight || 46;
        wBased = Math.min(wBased, Math.floor(availH - bhH2 - 20));
      }
      size = wBased;
    }
    if (!(size > 0)) size = 300;                   // jsdom / 布局未就绪时的兜底
    size = Math.max(220, Math.min(size, 522));
    try { D.size = size; D.vpW = Math.round(vp.getBoundingClientRect().width); D.availH = availH; D.playTop = playTop; D.wide = wide; D.calls = (D.calls || 0) + 1; } catch (e) {}
    document.body.classList.toggle('tight', size <= 221);   // 极端小窗：允许做题区内部滚动兜底
    // 复位后必须无条件重设：上面的 removeProperty 已清掉内联值，
    // 若只按 S._bs 缓存判断，尺寸不变时会跳过重设 → --stage 永久丢失（缩放后布局崩坏的根因）
    if (S._bs !== size || vp.style.getPropertyValue('--stage') === '') {
      S._bs = size; vp.style.setProperty('--stage', size + 'px');
    }
    fitScale(vp);

    /* 手机端「自动缩到刚好放得下」：用户不需要手动捏合缩放 ——
       量出做题区内容的真实总高，超出可视区就按差值等比缩小（zoom），
       等效于浏览器自动缩到合适比例（下限 0.62，保底不会小到看不清）。
       桌面端（≥720px）不做缩放，布局本身已经按视口预算算好了。 */
    function fitScale(vp) {
      if (S._scaling) return;                              // 防重入（zoom 改变尺寸会再次触发 ResizeObserver）
      var isWide = window.innerWidth >= 720;
      if (isWide) { if (vp.style.zoom) vp.style.zoom = ''; return; }
      if (!ZOOM_OK) return;                                // 浏览器不支持 zoom：保持原样，不折腾
      S._scaling = true;
      try {
        /* 量「内容真实底边」而不是 scrollHeight：
           #view-play 是 flex:1 的盒子（overflow:hidden），scrollHeight = max(clientHeight, 内容)，
           当盒子本身比内容高时会虚报（实测虚高 155px），据此缩放会把页面白缩一圈。
           改为取所有静态子元素 getBoundingClientRect().bottom 的最大值 —— 那才是用户看到的底边。
           注意：这些 rect 是「缩放后」的视觉值，要除回当前 zoom 才是未缩放尺寸。 */
        var playTop2 = vp.getBoundingClientRect().top;
        var cz = parseFloat(vp.style.zoom) || 1;
        /* 2026-10-31：不能再直接把 .boardwrap 的 rect 当「内容底边」。
           窄屏 boardwrap 是 flex:1 + justify-content:space-between（把富余摊进间隙、键盘贴卡底），
           它的 rect.bottom 恒等于盒子底、不随 zoom 变 —— 一旦 zoom<1，
           needed=(盒底-playTop)/zoom 就会虚大一圈，下一轮再缩、再虚大，一路滚到 0.62 地板
           （真机上就是「棋盘突然变得很窄」）。解法：量之前临时取消 space-between，
           让内容按 flex-start 堆在顶部，这时最后一个子项的底边才是真·内容底边；
           量完立刻还原（同一帧内读写，不产生闪烁）。 */
        var bottom = playTop2;
        var kids = vp.children;
        var bw = vp.querySelector('.boardwrap');
        /* 量一次「真·内容底边」：临时取消 space-between（见上），把盒子的子树也纳进来，
           量完立刻还原。容器分支的收敛循环复用同一个函数，避免两套口径打架。 */
        function measureBottom() {
          var b = playTop2, i2, c2, r2, savedJ = null;
          if (bw) { savedJ = bw.style.justifyContent; bw.style.justifyContent = 'flex-start'; }
          for (i2 = 0; i2 < kids.length; i2++) {
            c2 = window.getComputedStyle(kids[i2]);
            if (c2.display === 'none' || c2.position === 'absolute' || c2.position === 'fixed') continue;
            if (kids[i2] === bw) continue;                 // 盒子会撑满，跳过它本身
            r2 = kids[i2].getBoundingClientRect();
            if (r2.bottom > b) b = r2.bottom;
          }
          if (bw) {
            var ck = bw.children;
            for (i2 = 0; i2 < ck.length; i2++) {
              c2 = window.getComputedStyle(ck[i2]);
              if (c2.display === 'none' || c2.position === 'absolute' || c2.position === 'fixed') continue;
              r2 = ck[i2].getBoundingClientRect();
              if (r2.bottom > b) b = r2.bottom;
            }
            bw.style.justifyContent = savedJ;              // 立刻还原
          }
          return b;
        }
        bottom = measureBottom();
        var needed = (bottom - playTop2) / cz;      // 折算回未缩放尺寸
        var si = safeInsets();
        /* 无边框容器：走「量一次、不够就再缩一档」的收敛循环。
           不能用一次性公式：容器里卡片 height 已按安全区收好（见 style.css），
           做题区盒子比 innerHeight 矮，innerHeight 那套预算会高估可用空间；
           而盒子的 clientHeight 会被 zoom 反向放大、rect 高度又随 zoom 变，
           一次性算出来的结果和 --stage 复位 / ResizeObserver 撞在一起会抖
           （同一份代码两次跑出 0.91 和 1）。改以「视觉底边对齐」为准，最多迭代 4 次。
           每次至少减 0.01、单调收窄，所以不会来回震荡。
           网页端 si.t 恒 0，走 else 里的原公式，数字一个字节都不动。 */
        if (si.t > 0) {
          var q, cs2, rb, cB, boxB, cz2, nz, tries = 0;
          while (tries++ < 4) {
            boxB = vp.getBoundingClientRect().bottom;
            cB = measureBottom();                      // 与浏览器分支同一个口径：真·内容底边
            if (cB <= boxB - 4) break;                 // 放得下，收敛
            cz2 = parseFloat(vp.style.zoom) || 1;
            nz = Math.floor(((boxB - 4 - playTop2) / (cB - playTop2)) * cz2 * 100) / 100;
            nz = Math.max(0.62, Math.min(nz, cz2 - 0.01));
            vp.style.zoom = nz.toFixed(2);
          }
          try { D.needed = Math.round(cB - playTop2); D.avail = Math.round(boxB - playTop2); D.z = vp.style.zoom || 1; } catch (e2) {}
        } else {
          /* 2026-10-31：预算基准从 innerHeight 换成实测可视高度 --vvh（= visualViewport.height）。
             微信/QQ/小米自带这类内置浏览器常把底部工具条、手势区也算进 innerHeight，
             据此算出的 zoom 偏大 → 最后一排候选笔记正好被底栏盖掉（真机截图复现）。
             --vvh 由首帧脚本写入，网页端/headless 里等于 innerHeight，数字不变。 */
          var vvhPx = parseFloat(window.getComputedStyle(document.documentElement).getPropertyValue('--vvh'));
          var vhBase = (vvhPx > 0) ? Math.min(vvhPx, window.innerHeight || 0) : (window.innerHeight || 0);
          var avail = vhBase - playTop2 - 10;
          var z = 1;
          if (needed > 0 && avail > 0 && needed > avail) {
            z = Math.max(0.62, Math.floor(avail / needed * 100) / 100);
          }
          var next = z === 1 ? '' : z.toFixed(2);
          if (next !== (vp.style.zoom || '')) vp.style.zoom = next;   // 值没变就不写 DOM，避免观察器空转
          try { D.needed = Math.round(needed); D.avail = Math.round(avail); D.z = z; D.applied = next; } catch (e2) {}
        }
      } finally { S._scaling = false; }
    }
  }

  /* 视口变化统一入口：先把「真实可视高度」写进 --vvh（CSS 用它兜住 100dvh），再重算棋盘。
     手机内置浏览器常把 100dvh 报成含地址栏/导航栏的大值 —— 只信 CSS 会把底部按钮顶出屏幕，
     所以以 window.innerHeight 实测值为准，两者取小（见 style.css 的 min(100dvh, var(--vvh))）。 */
  function onViewportChange() {
    _safe = null;                                  // 旋转/换机后安全区会变，重测
    try {
      var vv = window.visualViewport;
      var h = (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 0;
      if (h > 0) document.documentElement.style.setProperty('--vvh', Math.round(h) + 'px');
    } catch (e) {}
    fitBoard();
    if (S.view === 'puzzle') PZ.render();  // 窗口变化时重排拼图，避免块尺寸溢出
  }

  function showView(name) {
    if (VIEWS.indexOf(name) < 0) name = 'play';
    for (var i = 0; i < VIEWS.length; i++) {
      var el = $('view-' + VIEWS[i]);
      if (el) el.hidden = (VIEWS[i] !== name);
    }
    S.view = name;
    // 做题页锁滚动（页面不出滚动条）；二级页（技巧/关于/拼图）恢复正常滚动
    document.body.classList.toggle('lockplay', name === 'play');
    if (name !== 'play') hideHintSheet();   // 提示浮层只在做题页出现
    if (name === 'play') { onViewportChange(); renderRail(); }   /* v4：左栏三卡随视图刷新 */
    // 顶栏导航按钮的选中态（卡点本是抽屉，不参与选中态）
    var map = { skills: 'navSkills', about: 'navAbout', puzzle: 'navPuzzle', stats: 'navStats', records: 'navRecords', tutorial: 'navTutorial' };
    for (var k in map) {
      var b = $(map[k]);
      if (b) b.classList.toggle('nb-on', k === name);
    }
    if (name === 'stats') STATS.render();   // 打开画像时重算一遍，数据永远是最新的
    if (name === 'puzzle') PZ.render();     // 打开拼图时重绘，进度永远最新
    if (name === 'records') RECORDS.render();   // 打开「已做」时重绘列表
    if (name === 'tutorial') TUT.show();        // 打开「教程」时生成当章的真实局面
    updateRecBadge();
    // 切页回到顶部。只在确实滚动过时才调用：jsdom 未实现 scrollTo 会异步报 not-implemented，
    // 而无谓调用也纯属浪费（页面本来就在顶部）
    if (window.scrollY) { try { window.scrollTo(0, 0); } catch (e) {} }
    // 回到做题页时重绘一次，保证棋盘/键盘/状态都是最新的
    if (name === 'play' && S.puzzle) paint();
  }

  function backToPlay() { showView('play'); }

  function bindViews() {
    $('navPuzzle').addEventListener('click', function () {
      showView(S.view === 'puzzle' ? 'play' : 'puzzle');
    });
    $('navSkills').addEventListener('click', function () {
      showView(S.view === 'skills' ? 'play' : 'skills');
    });
    $('navAbout').addEventListener('click', function () {
      showView(S.view === 'about' ? 'play' : 'about');
    });
    $('navStats').addEventListener('click', function () {
      showView(S.view === 'stats' ? 'play' : 'stats');
    });
    var lnk = $('lnkAbout');
    if (lnk) lnk.addEventListener('click', function () { showView('about'); });
    $('skBack').addEventListener('click', backToPlay);
    $('abBack').addEventListener('click', backToPlay);
    $('pzBack').addEventListener('click', backToPlay);
    $('stBack').addEventListener('click', backToPlay);
    $('recBack').addEventListener('click', backToPlay);
    $('navRecords').addEventListener('click', function () { showView(S.view === 'records' ? 'play' : 'records'); });
    $('navTutorial').addEventListener('click', function () { showView(S.view === 'tutorial' ? 'play' : 'tutorial'); });
    $('tutBack').addEventListener('click', backToPlay);
    var sk = $('skills');                     // 技巧图鉴里「看个真实例子 →」直接跳到教程对应章
    if (sk) sk.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tut]'); if (!b) return;
      TUT.open(+b.getAttribute('data-tut'));
      showView('tutorial');
    });
    var tn = $('tutNav');
    if (tn) tn.addEventListener('click', function (e) {
      var b = e.target.closest('.tn'); if (!b) return;
      TUT.open(+b.getAttribute('data-k'));
    });
    var rf = $('recFilter');
    if (rf) rf.addEventListener('click', function (e) { var b = e.target.closest('.rf'); if (!b) return; [].forEach.call(rf.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); RECORDS.render(b.getAttribute('data-f')); });
    var rl = $('recList');
    if (rl) rl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]'); if (!btn) return;
      var id = btn.getAttribute('data-id');
      if (btn.getAttribute('data-act') === 'open') openRecord(id);
      else if (btn.getAttribute('data-act') === 'del') { delRecord(id); RECORDS.render(); }
    });
  }

  /* ---------------- 账号中心（Demo 本地账号） ---------------- */
  function acctChip() {
    $('acctChipName').textContent = ACC.name || '微信用户';
    $('acctAv').textContent = ACC.name ? ACC.name.charAt(0).toUpperCase() : '游';
  }
  /* 切换账号后：重载该账号的解锁/卡点本/拼图进度，并按它自己的出题池开新局 */
  function reloadUserState() {
    acctChip();
    renderSkills(); loadCards(); renderCardBrief(); PZ.reload();
    DAILY.render();
    if (S.tierKey) newGame(S.tierKey, null);
  }
  /* ============================================================
     存档码（指令 8）：把本账号进度打包成一段可复制的文本
     ------------------------------------------------------------
     为什么要它：进度全在本机 localStorage，换手机 / 清缓存 / 换浏览器就没了。
     存档码 = 「SD1-」+ base64(JSON)，粘到备忘录里就是一份便携存档。

     打包范围 = 所有「按账号隔离」的 sd.* 键（sd.done / sd.ord / sd.cards /
     sd.daily / sd.dchallenge / sd.stats 以及以后新增的同类键），不写死清单 ——
     新增进度类型自动跟着走。

     明确排除设备级偏好：主题、反馈、笔记模式只属于这台设备。把它们塞进存档，
     换到别人手机上会突然变深色、变静音，那不是「还原进度」而是「改人家设置」。
     账号名册 / 版本号同理不带走。
     ============================================================ */
  var ARCH = (function () {
    var SKIP = { 'sd.theme': 1, 'sd.sfx': 1, 'sd.notemode': 1, 'sd.cur': 1, 'sd.accts': 1, 'sd_ver': 1 };

    function pf() { return ACC.name ? 'sd.u.' + ACC.name + '.' : ''; }

    /* 当前账号的进度键 → { 键: 原始字符串值 } */
    function collect() {
      var out = {}, p = pf(), i, k;
      try {
        for (i = 0; i < localStorage.length; i++) {
          k = localStorage.key(i);
          if (!k || k.indexOf('sd') !== 0 || SKIP[k]) continue;
          if (p) { if (k.indexOf(p) !== 0) continue; }
          else if (k.indexOf('sd.u.') === 0) continue;   /* 游客只导出自己的裸键，不碰别人账号 */
          out[k] = localStorage.getItem(k);
        }
      } catch (e) {}
      return out;
    }

    /* UTF-8 安全的 base64：昵称可能是中文，不能直接喂 btoa */
    function enc(s) {
      var bin = '', i;
      if (window.TextEncoder) {
        var b = new TextEncoder().encode(s);
        for (i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
      } else bin = unescape(encodeURIComponent(s));
      return btoa(bin);
    }
    function dec(s) {
      var bin = atob(s), i;
      if (window.TextDecoder) {
        var b = new Uint8Array(bin.length);
        for (i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(b);
      }
      return decodeURIComponent(escape(bin));
    }

    function pack() {
      var d = collect(), n = 0, k;
      for (k in d) n++;
      if (!n) return '';
      return 'SD1-' + enc(JSON.stringify({ v: 1, app: 'sudoku-academy', at: new Date().toISOString(), user: ACC.name || '', n: n, data: d }));
    }

    /* 解析 + 校验。宁可严一点：导入是「覆盖当前账号」的操作，
       粘错一串文字绝不该把已有进度洗掉。 */
    function parse(code) {
      var raw = String(code || '').replace(/\s+/g, '');
      if (!raw) return { err: '还没有存档码：点「导出」生成，或把别人给的粘进框里' };
      if (raw.indexOf('SD1-') === 0) raw = raw.slice(4);
      else if (raw.indexOf('eyJ') !== 0) return { err: '存档码无效：它应该以 SD1- 开头' };
      var obj;
      try { obj = JSON.parse(dec(raw)); } catch (e) { return { err: '存档码无效：内容不完整或被截断了' }; }
      if (!obj || obj.app !== 'sudoku-academy' || obj.v !== 1) return { err: '存档码无效：不是卷卷羊数独学园的存档' };
      if (!obj.data || typeof obj.data !== 'object') return { err: '存档码无效：里面没有进度数据' };
      var n = 0, k;
      for (k in obj.data) {
        if (k.indexOf('sd') !== 0 || SKIP[k]) return { err: '存档码无效：含有无法识别的字段' };
        if (typeof obj.data[k] !== 'string') return { err: '存档码无效：字段格式不对' };
        n++;
      }
      if (!n) return { err: '存档码里没有可还原的进度' };
      return { ok: obj, n: n };
    }

    /* 把存档里的键搬到「当前账号」名下：小明导出 → 小红导入也能用 */
    function apply(obj) {
      var from = obj.user || '', to = pf(), k, base, n = 0;
      for (k in obj.data) {
        base = k;
        if (k.indexOf('sd.u.') === 0) {                  /* 先去掉存档里原账号的前缀 */
          var pre = from ? 'sd.u.' + from + '.' : '';
          if (pre && k.indexOf(pre) === 0) base = 'sd.' + k.slice(pre.length);
          else { var dot = k.indexOf('.', 5); if (dot > 0) base = 'sd.' + k.slice(dot + 1); }
        }
        try { localStorage.setItem(to ? to + base.slice(3) : base, obj.data[k]); n++; } catch (e) {}
      }
      return n;
    }
    return { pack: pack, parse: parse, apply: apply, collect: collect };
  })();

  /* 账号中心里的「存档码」区块（登录态 / 游客态共用同一套界面） */
  function archBlock() {
    return '<div class="arch">' +
      '<div class="arch-h">存档码 · 换设备不丢进度</div>' +
      '<div class="arch-d">进度只存在这台设备上。导出成一串文字存进备忘录，换手机或清缓存后粘回来即可还原；导入会覆盖当前账号的进度。</div>' +
      '<textarea class="arch-ta" id="archTa" rows="3" spellcheck="false" placeholder="点「导出存档码」生成；或把存档码粘到这里再点「导入」"></textarea>' +
      '<div class="arch-row">' +
        '<button class="mini" id="archExp" type="button">导出存档码</button>' +
        '<button class="mini" id="archCop" type="button">复制</button>' +
        '<button class="mini" id="archImp" type="button">导入存档码</button>' +
      '</div></div>';
  }

  function bindArch() {
    var ta = $('archTa'); if (!ta) return;
    $('archExp').addEventListener('click', function () {
      var code = ARCH.pack();
      if (!code) { toast('这个账号还没有可导出的进度，先做一题再来'); return; }
      ta.value = code;
      try { ta.focus(); ta.setSelectionRange(0, 0); ta.scrollTop = 0; ta.scrollLeft = 0; } catch (e) {}
      toast('存档码已生成 · 点「复制」，粘到备忘录里存好');
    });
    $('archCop').addEventListener('click', function () {
      if (!ta.value) { toast('先点「导出存档码」生成一串，再复制'); return; }
      try { ta.select(); } catch (e) {}
      copyText(ta.value).then(function (okd) {
        if (okd) toast('存档码已复制，去备忘录粘贴保存');
        else toast('长按上面的文本框，选中后复制');
      });
    });
    $('archImp').addEventListener('click', function () {
      var r = ARCH.parse(ta.value);
      if (r.err) { toast(r.err); return; }
      var n = ARCH.apply(r.ok);
      closeAcct();
      reloadUserState();
      toast('存档已导入：' + n + ' 项进度还原到' + (ACC.name ? '「' + ACC.name + '」' : '游客') + '名下');
    });
  }

  function renderAcct() {
    var body = $('acctBody');
    $('acctTitle').textContent = ACC.name ? '账号中心' : '登录 / 注册';
    $('acctEm').innerHTML = ACC.name ? '<svg class="emi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.2" r="3.6"/><path d="M5 20 Q5.5 14.8 12 14.8 Q18.5 14.8 19 20"/></svg>' : '<svg class="emi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5 V7.5 Q8.5 4.5 12 4.5 Q15.5 4.5 15.5 7.5 V10.5 M12 14 V16.5"/></svg>';
    if (ACC.name) {
      body.innerHTML =
        '<div class="empty">当前账号：<b>' + ACC.name + '</b><br>' +
        '技巧解锁、卡点本、拼图收集、做题记录都按账号保存；<br>' +
        '出题顺序是你这个账号独有的，做过的题不会重复出。</div>' +
        '<button class="bigbtn" id="acctLogout">退出登录</button>' + archBlock();
      $('acctLogout').addEventListener('click', doLogout);
      bindArch();
      return;
    }
    body.innerHTML =
      '<div class="empty">本地账号：注册后进度存本机、按账号隔离。<br>换设备也能玩，进度各自独立。</div>' +
      '<input class="ain" id="acctUser" placeholder="昵称（至少 2 个字）" maxlength="12">' +
      '<input class="ain" id="acctPwd" type="password" placeholder="密码（至少 4 位）">' +
      '<button class="bigbtn" id="acctLogin">登录</button>' +
      '<button class="bigbtn soft" id="acctReg">注册新账号</button>' + archBlock();
    $('acctLogin').addEventListener('click', doLogin);
    $('acctReg').addEventListener('click', doReg);
    bindArch();
  }
  function closeAcct() { $('acctOv').hidden = true; mSync($('acctOv')); }
  function openAcct() { renderAcct(); $('acctOv').hidden = false; modalOpen($('acctOv'), closeAcct); }
  function doLogin() {
    var n = $('acctUser').value.trim(), p = $('acctPwd').value;
    if (!n || !p) { toast('先填昵称和密码'); return; }
    var accts = LS.get('sd.accts', {});
    if (!accts[n]) { toast('没有这个账号，先点「注册新账号」'); return; }
    if (accts[n] !== hashPwd(p)) { toast('密码不对，再试试'); return; }
    ACC.name = n; LS.set('sd.cur', n);
    closeAcct();
    reloadUserState();
    toast('欢迎回来，' + n + '！进度已切到你的账号');
  }
  function doReg() {
    var n = $('acctUser').value.trim(), p = $('acctPwd').value;
    if (n.length < 2) { toast('昵称至少 2 个字'); return; }
    if (p.length < 4) { toast('密码至少 4 位'); return; }
    var accts = LS.get('sd.accts', {});
    if (accts[n]) { toast('这个昵称已经注册过，直接登录就好'); return; }
    accts[n] = hashPwd(p); LS.set('sd.accts', accts);
    ACC.name = n; LS.set('sd.cur', n);
    closeAcct();
    reloadUserState();
    toast('注册成功，' + n + '！出题池已经为你单独洗好牌');
  }
  function doLogout() {
    ACC.name = ''; LS.set('sd.cur', '');
    closeAcct();
    reloadUserState();
    toast('已退出，回到游客模式');
  }

  /* ---------------- 启动 ---------------- */
  /* ---------------- J-B1 · 无障碍兜底 ----------------
     页面上大量按钮是纯图标（↶ ⌫ ◎ ⋯）或只有 title，读屏念出来是空的。
     这里统一补一层 aria-label：优先 title，其次图标旁的小字（.sub），最后按钮文本。
     动态渲染的卡片（每日挑战 / 卡点本 / 教程 / 战绩）插进来后自动补，不改各渲染函数。 */
  function applyA11y(root) {
    var list = (root || document).querySelectorAll('button, summary, a[href]');
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      if (b.getAttribute('aria-label')) continue;
      var lab = (b.getAttribute('title') || '').replace(/\s+/g, ' ').trim();
      if (!lab) {
        var sub = b.querySelector('.sub');
        lab = ((sub && sub.textContent) || b.textContent || '').replace(/\s+/g, ' ').trim();
      }
      if (lab) b.setAttribute('aria-label', lab);
    }
  }

  /* ---------------- J-B2 · 桌面右键记候选 ----------------
     桌面三栏（≥1120px）里右键点格子，就地弹一个 1–9 勾选小菜单，点一下记/取消候选。
     走的是和键盘「候选笔记」完全同一条 put(d,true)：撤销、elim 掩码、提示去重全部一致。
     触屏没有右键、窄屏键位本来就够——两边都不受影响。 */
  var CTXNOTE = (function () {
    var el = null, idx = -1;

    function close() {
      if (el) { el.remove(); el = null; }
      idx = -1;
      document.removeEventListener('mousedown', onDoc, true);
      document.removeEventListener('keydown', onEsc, true);
    }
    function render() {
      if (!el || idx < 0) return;
      var n = S.notes[idx] || 0;
      var html = '<div class="cn-hd">候选 · 点一下记 / 取消</div><div class="cn-grid">';
      for (var d = 1; d <= 9; d++) {
        var on = !!(n & E.V(d));
        html += '<button type="button" class="cn-k' + (on ? ' on' : '') + '" data-d="' + d +
                '" aria-pressed="' + (on ? 'true' : 'false') + '" aria-label="候选 ' + d + '">' + d + '</button>';
      }
      html += '</div>';
      el.innerHTML = html;
    }
    function open(i, x, y) {
      close();
      idx = i;
      el = document.createElement('div');
      el.className = 'ctxnotes';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', '第' + (((i / 9) | 0) + 1) + '行第' + (i % 9 + 1) + '列 · 候选笔记');
      render();
      document.body.appendChild(el);
      var w = el.offsetWidth, h = el.offsetHeight;
      el.style.left = Math.max(8, Math.min(x, innerWidth - w - 12)) + 'px';
      el.style.top = Math.max(8, Math.min(y, innerHeight - h - 12)) + 'px';
      /* 菜单自身的点击必须挂在 el 上：document 的 capture 监听先跑，
         若在 document 上处理点击并重绘 innerHTML，紧接着 contains(e.target) 就会判成「点在外面」把菜单关掉。 */
      el.addEventListener('mousedown', function (ev) {
        var k = ev.target.closest ? ev.target.closest('.cn-k') : null;
        if (!k) return;
        ev.preventDefault();
        S.sel = idx;
        put(+k.dataset.d, true);
        render();
      });
      document.addEventListener('mousedown', onDoc, true);
      document.addEventListener('keydown', onEsc, true);
    }
    function onDoc(e) { if (el && !el.contains(e.target)) close(); }
    function onEsc(e) { if (e.key === 'Escape') { close(); e.stopPropagation(); } }

    function bind() {
      var board = $('board');
      if (!board) return;
      board.addEventListener('contextmenu', function (ev) {
        if (!window.matchMedia('(min-width:1120px)').matches) return;   /* 只在桌面三栏启用 */
        if (S.paused || S.solved) return;
        var c = ev.target.closest ? ev.target.closest('.cell') : null;
        if (!c) return;
        ev.preventDefault();
        var i = +c.dataset.i;
        if (S.given[i]) { toast('题目给定的格子不用记候选'); return; }
        S.sel = i;
        paint();
        open(i, ev.clientX, ev.clientY);
      });
      /* 菜单内点击由 el 自己的 mousedown 处理（见 open），这里只保留右键入口 */
    }
    return { bind: bind, close: close };
  })();

  function boot() {
    ACC.name = LS.get('sd.cur', '');          // 恢复上次登录的账号（要在读进度前就位）
    acctChip();
    setTheme(LS.get('sd.theme', 'light'));
    $('themeBtn').addEventListener('click', function () {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
    /* 时钟 / 续玩按钮：原来写在 HTML 行内 onclick 里，容器 CSP 禁行内事件，改到这里绑定 */
    (function () {
      function pauseToggle() {
        try { document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); } catch (e) {}
      }
      var cb = $('clockBtn'); if (cb) cb.addEventListener('click', pauseToggle);
      var rb = $('resumeBtn'); if (rb) rb.addEventListener('click', pauseToggle);
    })();
    $('btnFocus').addEventListener('click', toggleFocus);
    var nb = $('btnNote');
    if (nb) nb.addEventListener('click', toggleNoteMode);
    S.noteMode = !!LS.get('sd.notemode', false);   // 恢复上次的笔记模式（粘滞偏好）
    applyNoteMode();
    $('btnTip').addEventListener('click', toggleTip);
    /* 纠错开关：开＝标红计数 + 填对的锁格；关＝不判对错、不标红、不锁格。存 sd.check。 */
    applyCheck();
    $('btnCheck').addEventListener('click', function () {
      S.autoCheck = !S.autoCheck;
      LS.set('sd.check', S.autoCheck);
      applyCheck();
      paint();
      toast(S.autoCheck
        ? '纠错已开：填错当场标红并计数；填对的格子会锁定'
        : '纠错已关：不判对错、不标红、不锁格 —— 填错了自己发现');
    });
    $('btnNew').addEventListener('click', function () { newGame(S.tierKey, null); });
    /* 草稿盘四个入口：状态行胶囊（退出）+ 状态行「草稿」胶囊（窄屏常驻进入）+
       提示卡（强制链出现时才显示）+ 棋局设置（常驻） */
    $('stDraft').addEventListener('click', function () { draftExit(false); });
    $('btnDraft').addEventListener('click', function () { draftEnter(); });
    $('btnDraftOpen').addEventListener('click', function () { draftEnter(); });
    $('btnDraftMini').addEventListener('click', function () {
      if (!D.active) { draftEnter(); return; }
      if (D.anchor && draftSteps() > 1) draftAnchorBack();   // 有推演 → 先回假设点
      else draftExit(false);
    });
    /* 反馈开关（指令 4 音效 + 指令 5 震动合并一项，存 sd.sfx）：恢复上次选择 */
    $('btnSfx').setAttribute('aria-pressed', Sfx.on() ? 'true' : 'false');
    $('btnSfx').textContent = '反馈 ' + (Sfx.on() ? '开' : '关');
    $('btnSfx').addEventListener('click', function () {
      var on = Sfx.toggle();
      this.setAttribute('aria-pressed', on ? 'true' : 'false');
      this.textContent = '反馈 ' + (on ? '开' : '关');
      if (on) Sfx.play('ok');                      // 刚打开时给一声，当场听见效果
    });
    if ($('btnHint')) $('btnHint').addEventListener('click', doHint);   // 老版大按钮（已移除，保留兼容）
    $('btnApply').addEventListener('click', applyHint);
    /* 标题栏翻页按钮（静态元素，只绑一次）：还有下一条就前进一步并保持浮层 */
    $('hintNext').addEventListener('click', function () {
      if (S.hint && S.hintStep < (S.hintSteps || 1) - 1) { S.hintStep++; renderHintCard(); showHintSheet(); }
    });
    $('hintClose').addEventListener('click', function () { modalCloseTop(); });
    /* 提示卡可拖动：按住标题栏（抓手 ⠿ 处）拖到屏幕任意角落，不挡哪就挪哪；位置本次会话内保持。
       三个老大难一次解决：
       ① 「一点击就往左边跑」= 入场动画 fill-mode:both 把 transform 永久锁死（动画优先级 > 内联样式），
          旧代码 transform:none 被覆盖，left 一改像素值卡片就左跳半个身位。
          对策：动画已改为只动 opacity/margin-top；轻点（位移 <4px）也不进入拖动，定位绝不被碰。
       ② 「可移动范围有限」= 旧边界夹在 boardwrap 里（桌面端只能晃 ~170px）。
          改为按视口边界换算，允许负坐标，桌面端能一路拖到屏幕两侧空白处。
       ③ 「还是会遮挡」= 拖动范围覆盖全屏后，想把卡片挪去哪都行；拖动时半透明，底下的棋盘看得见。
       另：双击标题栏 = 一键回默认位置（顶部居中）。 */
    (function () {
      var hp = $('hintPanel'), hd = hp.querySelector('.hshd');
      hd.style.cursor = 'grab'; hd.style.touchAction = 'none';
      hd.title = '按住拖动 · 双击回默认位置';
      var TH = 4;                                     // 位移阈值：小于它算轻点，不拖动
      /* 卡片实际可见、可点到的区域 = 最近的裁剪祖先（做题区 #view-play 是 overflow:hidden）。
         早年只按视口算边界，卡片被拖出可视区后既被裁掉一截、指针也直接穿透点不到
         （elementFromPoint 命中 body）——「拖到边缘就失控、范围感觉有限」的真凶就是它。 */
      function clipBox() {
        var p = hp.parentNode;
        while (p && p !== document.body && p !== document.documentElement) {
          var cs = getComputedStyle(p);
          if (cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.overflowY !== 'visible') break;
          p = p.parentElement;
        }
        if (!p || p === document.documentElement) {
          var vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--vvh')) || window.innerHeight;
          return { left: 0, top: 0, right: window.innerWidth, bottom: vh };
        }
        var r = p.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      }
      function clampPos() {                           // 窗口尺寸变化后，把卡片夹回可视区内
        if (hp.hidden || hp.style.left === '') return;
        var wr = hp.parentNode.getBoundingClientRect(), cb = clipBox();
        var w = hp.offsetWidth, h = hp.offsetHeight;
        var x = parseFloat(hp.style.left) || 0, y = parseFloat(hp.style.top) || 0;
        var minX = cb.left - wr.left + 8, maxX = cb.right - wr.left - w - 8;
        var minY = cb.top - wr.top + 8, maxY = cb.bottom - wr.top - h - 8;
        if (maxX < minX) maxX = minX;
        if (maxY < minY) maxY = minY;
        hp.style.left = Math.round(Math.max(minX, Math.min(x, maxX))) + 'px';
        hp.style.top = Math.round(Math.max(minY, Math.min(y, maxY))) + 'px';
      }
      hd.addEventListener('pointerdown', function (ev) {
        if (ev.target.closest('button')) return;      // 不拦「收起」按钮
        var wr = hp.parentNode.getBoundingClientRect();
        var r = hp.getBoundingClientRect();
        var ox = ev.clientX - r.left, oy = ev.clientY - r.top;   // 手指落在卡片内的偏移
        var moved = false;
        function begin() {                            // 真正开始拖：脱离居中定位
          if (hp.style.left === '') {                 // 第一次拖：以「默认居中位置」为基准换算
            hp.style.left = Math.round((wr.width - hp.offsetWidth) / 2) + 'px';
            hp.style.top = '6px';
          }
          hp.style.transform = 'none';                // 动画已不碰 transform，这行现在稳定生效
          hp.classList.add('dragging');
          hd.style.cursor = 'grabbing';
        }
        function mv(e) {
          var dx = e.clientX - ev.clientX, dy = e.clientY - ev.clientY;
          if (!moved && Math.abs(dx) < TH && Math.abs(dy) < TH) return;   // 轻点：定位原样不动
          if (!moved) { moved = true; begin(); }
          var cb = clipBox();
          var x = e.clientX - wr.left - ox, y = e.clientY - wr.top - oy;
          var minX = cb.left - wr.left + 8, maxX = cb.right - wr.left - r.width - 8;
          var minY = cb.top - wr.top + 8, maxY = cb.bottom - wr.top - r.height - 8;
          if (maxX < minX) maxX = minX;
          if (maxY < minY) maxY = minY;
          hp.style.left = Math.round(Math.max(minX, Math.min(x, maxX))) + 'px';
          hp.style.top = Math.round(Math.max(minY, Math.min(y, maxY))) + 'px';
          if (e.cancelable) e.preventDefault();
        }
        function up() {
          document.removeEventListener('pointermove', mv);
          document.removeEventListener('pointerup', up);
          document.removeEventListener('pointercancel', up);
          window.removeEventListener('blur', up);     // 拖到窗口外松手的兜底
          hp.classList.remove('dragging');
          hd.style.cursor = 'grab';
        }
        // 捕获指针让手指移出标题栏也能继续拖；个别环境（模拟指针）会抛错，包一层不影响主流程
        try { hd.setPointerCapture(ev.pointerId); } catch (e2) {}
        document.addEventListener('pointermove', mv);
        document.addEventListener('pointerup', up);
        document.addEventListener('pointercancel', up);
        window.addEventListener('blur', up);
        if (ev.cancelable) ev.preventDefault();
      });
      hd.addEventListener('dblclick', function (ev) {  // 双击标题栏：回默认位置（顶部居中）
        if (ev.target.closest('button')) return;
        hp.style.left = ''; hp.style.top = ''; hp.style.transform = '';
      });
      window.addEventListener('resize', clampPos);
    })();
    $('acctBtn').addEventListener('click', function () {           /* K-3：先聚焦自己，弹层关闭后焦点才回得到这里 */
      try { this.focus({ preventScroll: true }); } catch (e) {}
      openAcct();
    });
    $('acctClose').addEventListener('click', function () { modalCloseTop(); });
    var nbx = $('newbieX');
    if (nbx) nbx.addEventListener('click', function () { modalCloseTop(); });
    /* 棋局设置气泡（<details>）：点面板外自动收起 */
    document.addEventListener('pointerdown', function (ev) {
      var mo = document.querySelector('.more[open]');
      if (mo && !mo.contains(ev.target)) mo.open = false;
    }, true);
    window.addEventListener('resize', onViewportChange);
    // 布局微变（字体加载完、引导条显隐、浏览器缩放、状态条换行）都会改变可用高度
    // → 直接观察做题区容器尺寸变化随时重算，避免棋盘被顶出屏幕或压扁
    if (window.ResizeObserver) {
      var _ro = new ResizeObserver(function () { onViewportChange(); });
      var _wr = document.querySelector('#view-play .boardwrap');
      if (_wr) _ro.observe(_wr);
      if (document.documentElement) _ro.observe(document.documentElement);
    }
    window.addEventListener('orientationchange', onViewportChange);
    // 地址栏收起/展开、软键盘弹出：visualViewport 的高度变化 resize 事件不一定触发
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onViewportChange);
      window.visualViewport.addEventListener('scroll', onViewportChange);
    }

    buildPad();
    bindKeys();
    bindViews();
    renderSkills();
    renderHintEmpty();
    PZ.render();                     // 拼图墙 + 顶栏徽章（localStorage 恢复进度）
    showView('play');

    // 卡点本
    loadCards();
    renderCardBrief();
    $('btnCards').addEventListener('click', openDrawer);
    $('navCards').addEventListener('click', openDrawer);
    $('dwClose').addEventListener('click', function () { modalCloseTop(); });
    $('dwClear').addEventListener('click', onClear);
    $('dwExport').addEventListener('click', exportCards);

    $('btnTip').setAttribute('aria-pressed', S.autoTip ? 'true' : 'false');
    $('btnFocus').setAttribute('aria-pressed', 'false');

    var tot = 0; BANK.tiers.forEach(function (t) { tot += t.puzzles.length; });
    $('aboutBox').innerHTML =
      '<div class="empty">' +
      '<b>卷卷羊 · 数独学园</b>做市面产品不做的事：<b>教推理，而不是给答案</b>。<br><br>' +
      '① 每一次提示都讲清<b>技巧、理由、该看哪里</b>，绝不直接给答案；<br>' +
      '② 难度不是手感标签，是引擎算出来的<b>技巧等级</b>（L1–L8），做题时看到「本题 L3」就是一句可验证的承诺；<br>' +
      '③ 卡住的局面自动存进<b>卡点本</b>，复盘 + 自测，看过 ≠ 会做；<br>' +
      '④ <b>每日挑战</b>全网同题，打卡积累；<b>能力画像</b>沉淀每一局的成长。<br><br>' +
      '题库共 <b>' + tot + '</b> 题，全部由程序预生成并逐题校验过<b>唯一解</b>。' +
      '引擎已在数百道随机题上做过可靠性验证：每一次排除、每一次落子都<b>从未</b>与唯一真解冲突（违规 0）。' +
      '</div>';
    DAILY.init();                     // 顶栏每日挑战按钮：挂点击事件 + 首渲按钮状态（init 内部调用 render）
    /* 有没下完的局就接着上次，否则随机开一题。
       这一步必须放在 CHAL.start() 之前：带 ?challenge= 打开时由挑战逻辑覆盖当前局。 */
    var _res = null;
    try { _res = lastProgressRecord(); } catch (e) {}
    if (_res) {
      try {
        openRecord(_res.id);
        toast('已接着上次那局继续 · 想重开点「⋯ → 换一题」');
      } catch (e) { newGame(LS.get('sd.tier', 'easy'), null); }
    } else {
      newGame(LS.get('sd.tier', 'easy'), null);
    }
    CHAL.start();                    // 带 ?challenge= 打开 → 直接进好友那一局（无参数时行为不变）
    /* 切后台 / 关页前补一次存盘：syncActiveRecord 只在落子后写，玩家若最后几分钟没动，
       用时和盘面就停在上一手。这里补一脚（草稿态在 syncActiveRecord 内部自动跳过）。 */
    (function () {
      function flush() { try { syncActiveRecord(); } catch (e) {} }
      document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
      window.addEventListener('pagehide', flush);
    })();
    var tc = 0; BANK.tiers.forEach(function (t) { tc = Math.max(tc, t.puzzles.length); });

    /* J-B1：首次铺一遍 aria-label，之后新增的按钮由观察器补（只监听子节点，不监听属性，不会自激） */
    applyA11y();
    CTXNOTE.bind();                                    /* J-B2 桌面右键候选菜单 */
    var _lnb = $('leftNoteBtn');                       /* J-B3 左栏卡点本摘要卡的入口 */
    if (_lnb) _lnb.addEventListener('click', function () {
      /* K-3：先把焦点落在入口上，抽屉关闭后归还到这里（不会被别的元素抢走） */
      try { this.focus({ preventScroll: true }); } catch (e) {}
      openDrawer();
    });    if (window.MutationObserver) {
      new MutationObserver(function () { applyA11y(); })
        .observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();


/* 题库异步加载完成后重建贴纸墙：轮询等待 window.PUZZLE_DATA（容器禁止内联 onload） */
(function () {
  var n = 0;
  var iv = setInterval(function () {
    n++;
    if (window.PUZZLE_DATA) {
      clearInterval(iv);
      try { if (window.PZ && window.PZ.onDataReady) window.PZ.onDataReady(); } catch (e) {}
    } else if (n > 300) { clearInterval(iv); }
  }, 100);
})();
