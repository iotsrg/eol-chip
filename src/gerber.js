// gerber.js - Gerber RS-274X + Excellon drill import, rasteriser and net tracer.
//
// Pure computation: no DOM, no network. Runs in the browser and under Node.
//
// What it does
//   1. Identifies each file's layer (X2 attributes first, then filename).
//   2. Parses RS-274X (apertures, macros, arcs, regions, polarity) and Excellon.
//   3. Rasterises every copper layer to a bitmap.
//   4. Labels connected copper per layer and joins layers at plated drill
//      hits, giving real nets: "this pad connects to those pads".
//
// Honest limits (also surfaced to the user as warnings)
//   - Connectivity is computed on a bitmap. Two nets closer than about two
//     pixels can merge. The pixel size is reported so this can be judged.
//   - Gerber carries no component names or part numbers. Nets are geometric.
//   - Step-and-repeat (SR), layer mirror/rotate/scale (LM/LR/LS) and the
//     deprecated moire primitive are not implemented. A warning is raised
//     whenever a file uses one of them.

const INCH = 25.4

// ───────────────────────── layer identification ─────────────────────────

export function sniffKind(text) {
  const head = text.slice(0, 4000)
  if (/%FS[LT][AI]X\d\dY\d\d/.test(head) || /%ADD\d+/.test(head) || /%MO(IN|MM)\*%/.test(head)) return 'gerber'
  if (/^M48/m.test(head) || /^T\d+(?:F\d+)?(?:S\d+)?C[\d.]+/m.test(head)) return 'drill'
  if (/D0?[123]\*/.test(head) && /[XY]-?\d+/.test(head)) return 'gerber'
  return null
}

function x2Function(text) {
  const m = /TF\.FileFunction,([^*\r\n%]+)/.exec(text.slice(0, 6000))
  if (!m) return null
  const p = m[1].split(',').map(s => s.trim())
  const f = (p[0] || '').toLowerCase()
  const side = s => (/^top/i.test(s || '') ? 'top' : /^bot/i.test(s || '') ? 'bottom' : 'all')
  if (f === 'copper') {
    const idx = parseInt(String(p[1] || '').replace(/\D/g, ''), 10) || 0
    const pos = (p[2] || '').toLowerCase()
    return { type: 'copper', side: pos === 'top' ? 'top' : pos === 'bot' ? 'bottom' : 'inner', index: idx }
  }
  if (f === 'soldermask') return { type: 'mask', side: side(p[1]) }
  if (f === 'legend') return { type: 'silk', side: side(p[1]) }
  if (f === 'paste') return { type: 'paste', side: side(p[1]) }
  if (f === 'profile') return { type: 'outline', side: 'all' }
  if (f === 'plated') return { type: 'drill', plated: true }
  if (f === 'nonplated') return { type: 'drill', plated: false }
  return { type: 'other', side: 'all' }
}

export function identifyLayer(name, text) {
  const kind = sniffKind(text)
  const x2 = x2Function(text)
  if (x2 && x2.type !== 'other') return { kind, ...x2 }
  const n = name.toLowerCase().replace(/\\/g, '/').split('/').pop()
  const ext = n.includes('.') ? n.slice(n.lastIndexOf('.') + 1) : ''
  const has = re => re.test(n)
  if (kind === 'drill' || ['drl', 'xln', 'drd', 'exc', 'ncd'].includes(ext)) {
    return { kind: 'drill', type: 'drill', plated: !has(/npth|non[-_ ]?plated|unplated/) }
  }
  if (['gko', 'gml', 'dim', 'oln', 'mil'].includes(ext) || /^gm\d+$/.test(ext) ||
      has(/edge[._-]?cuts|outline|profile|board[._-]?shape|keep[-_]?out|\bmill/)) return { kind, type: 'outline', side: 'all' }
  if (['gtl', 'cmp'].includes(ext) || has(/f[._]cu\b|top[._-]?(copper|layer)|copper[._-]?top|[-_.]top\.(gbr|ger|pho|art)$/)) return { kind, type: 'copper', side: 'top', index: 1 }
  if (['gbl', 'sol'].includes(ext) || has(/b[._]cu\b|bot(tom)?[._-]?(copper|layer)|copper[._-]?bot|[-_.]bot(tom)?\.(gbr|ger|pho|art)$/)) return { kind, type: 'copper', side: 'bottom', index: 99 }
  let m = /^g(?:p|l)?(\d+)$/.exec(ext) || /\bin(?:ner)?[._-]?(\d+)[._]cu\b/.exec(n) || /inner[._-]?(?:layer)?[._-]?(\d+)/.exec(n) || /\bl(?:ayer)?[._-]?(\d+)\.(?:gbr|ger|pho|art)$/.exec(n)
  if (m) return { kind, type: 'copper', side: 'inner', index: 1 + parseInt(m[1], 10) }
  if (['gts', 'stc'].includes(ext) || has(/f[._]mask|top[._-]?(solder)?[._-]?mask|mask[._-]?top/)) return { kind, type: 'mask', side: 'top' }
  if (['gbs', 'sts'].includes(ext) || has(/b[._]mask|bot(tom)?[._-]?(solder)?[._-]?mask|mask[._-]?bot/)) return { kind, type: 'mask', side: 'bottom' }
  if (['gto', 'plc'].includes(ext) || has(/f[._]silk|top[._-]?silk|silk[._-]?top|top[._-]?(legend|overlay)/)) return { kind, type: 'silk', side: 'top' }
  if (['gbo', 'pls'].includes(ext) || has(/b[._]silk|bot(tom)?[._-]?silk|silk[._-]?bot|bot(tom)?[._-]?(legend|overlay)/)) return { kind, type: 'silk', side: 'bottom' }
  if (['gtp', 'crc'].includes(ext) || has(/f[._]paste|top[._-]?paste|paste[._-]?top/)) return { kind, type: 'paste', side: 'top' }
  if (['gbp', 'crs'].includes(ext) || has(/b[._]paste|bot(tom)?[._-]?paste|paste[._-]?bot/)) return { kind, type: 'paste', side: 'bottom' }
  return { kind, type: 'other', side: 'all' }
}

// ─────────────────────────── macro expressions ───────────────────────────

function evalExpr(src, vars) {
  const s = String(src).replace(/\s+/g, '')
  let i = 0
  const peek = () => s[i]
  function num() {
    if (peek() === '(') { i++; const v = add(); if (peek() === ')') i++; return v }
    if (peek() === '-') { i++; return -num() }
    if (peek() === '+') { i++; return num() }
    if (peek() === '$') {
      i++; let j = i
      while (j < s.length && /\d/.test(s[j])) j++
      const k = parseInt(s.slice(i, j), 10); i = j
      return vars[k] || 0
    }
    let j = i
    while (j < s.length && /[\d.]/.test(s[j])) j++
    const v = parseFloat(s.slice(i, j)); i = j
    return Number.isFinite(v) ? v : 0
  }
  function mul() {
    let v = num()
    while (i < s.length && /[xX/]/.test(peek())) { const op = s[i++]; const r = num(); v = op === '/' ? v / r : v * r }
    return v
  }
  function add() {
    let v = mul()
    while (i < s.length && /[+-]/.test(peek())) { const op = s[i++]; const r = mul(); v = op === '+' ? v + r : v - r }
    return v
  }
  return add()
}

const rot = (x, y, deg) => {
  if (!deg) return [x, y]
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a)
  return [x * c - y * s, x * s + y * c]
}

// Expand a macro body with concrete parameters into aperture-local shapes (mm).
function expandMacro(body, params, unit, warn) {
  const vars = []
  params.forEach((p, k) => { vars[k + 1] = p })
  const shapes = []
  for (const stmt of body) {
    if (/^0(\s|$)/.test(stmt)) continue
    const def = /^\$(\d+)=(.+)$/.exec(stmt.replace(/\s+/g, ''))
    if (def) { vars[parseInt(def[1], 10)] = evalExpr(def[2], vars); continue }
    const a = stmt.split(',').map(e => evalExpr(e, vars))
    const code = a[0]
    const U = v => v * unit
    if (code === 1) {
      const [cx, cy] = rot(U(a[3]), U(a[4]), a[5] || 0)
      shapes.push({ k: 'disc', exp: a[1], cx, cy, r: U(a[2]) / 2 })
    } else if (code === 20 || code === 2) {
      const w = U(a[2]), x1 = U(a[3]), y1 = U(a[4]), x2 = U(a[5]), y2 = U(a[6]), r = a[7] || 0
      const len = Math.hypot(x2 - x1, y2 - y1) || 1e-9
      const nx = -(y2 - y1) / len * w / 2, ny = (x2 - x1) / len * w / 2
      shapes.push({ k: 'poly', exp: a[1], pts: [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]].map(p => rot(p[0], p[1], r)) })
    } else if (code === 21 || code === 22) {
      const w = U(a[2]), h = U(a[3]), r = a[6] || 0
      const x0 = code === 21 ? U(a[4]) - w / 2 : U(a[4]), y0 = code === 21 ? U(a[5]) - h / 2 : U(a[5])
      shapes.push({ k: 'poly', exp: a[1], pts: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]].map(p => rot(p[0], p[1], r)) })
    } else if (code === 4) {
      const n = Math.round(a[2]), r = a[5 + 2 * n] || 0, pts = []
      for (let k = 0; k <= n; k++) pts.push(rot(U(a[3 + 2 * k]), U(a[4 + 2 * k]), r))
      shapes.push({ k: 'poly', exp: a[1], pts })
    } else if (code === 5) {
      const n = Math.max(3, Math.round(a[2])), cx = U(a[3]), cy = U(a[4]), rad = U(a[5]) / 2, r = a[6] || 0, pts = []
      for (let k = 0; k < n; k++) {
        const t = 2 * Math.PI * k / n
        pts.push(rot(cx + rad * Math.cos(t), cy + rad * Math.sin(t), r))
      }
      shapes.push({ k: 'poly', exp: a[1], pts })
    } else if (code === 7) {
      const cx = U(a[1]), cy = U(a[2]), ro = U(a[3]) / 2, ri = U(a[4]) / 2, g = U(a[5]), r = a[6] || 0
      const [px, py] = rot(cx, cy, r)
      shapes.push({ k: 'disc', exp: 1, cx: px, cy: py, r: ro })
      shapes.push({ k: 'disc', exp: 0, cx: px, cy: py, r: ri })
      shapes.push({ k: 'poly', exp: 0, pts: [[cx - ro, cy - g / 2], [cx + ro, cy - g / 2], [cx + ro, cy + g / 2], [cx - ro, cy + g / 2]].map(p => rot(p[0], p[1], r)) })
      shapes.push({ k: 'poly', exp: 0, pts: [[cx - g / 2, cy - ro], [cx + g / 2, cy - ro], [cx + g / 2, cy + ro], [cx - g / 2, cy + ro]].map(p => rot(p[0], p[1], r)) })
    } else if (code === 6) {
      warn.add('aperture macro uses the deprecated moire primitive (not drawn)')
    } else if (Number.isFinite(code)) {
      warn.add(`aperture macro primitive ${code} is not supported (not drawn)`)
    }
  }
  return shapes
}

// ───────────────────────────── Gerber parser ─────────────────────────────

function arcPoints(x0, y0, x1, y1, i, j, cw, multi) {
  let cx, cy
  if (multi) { cx = x0 + i; cy = y0 + j } else {
    let best = null
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const tx = x0 + sx * Math.abs(i), ty = y0 + sy * Math.abs(j)
      const a0 = Math.atan2(y0 - ty, x0 - tx), a1 = Math.atan2(y1 - ty, x1 - tx)
      let sw = cw ? a0 - a1 : a1 - a0
      while (sw < -1e-9) sw += 2 * Math.PI
      const err = Math.abs(Math.hypot(x0 - tx, y0 - ty) - Math.hypot(x1 - tx, y1 - ty))
      if (sw <= Math.PI / 2 + 1e-6 && (!best || err < best.err)) best = { tx, ty, err }
    }
    if (!best) return [[x1, y1]]
    cx = best.tx; cy = best.ty
  }
  const r = Math.hypot(x0 - cx, y0 - cy)
  if (r < 1e-9) return [[x1, y1]]
  const a0 = Math.atan2(y0 - cy, x0 - cx), a1 = Math.atan2(y1 - cy, x1 - cx)
  let sweep = cw ? a0 - a1 : a1 - a0
  while (sweep < 0) sweep += 2 * Math.PI
  if (sweep < 1e-9) sweep = multi ? 2 * Math.PI : 0
  if (!sweep) return [[x1, y1]]
  const step = 2 * Math.acos(Math.max(0, 1 - 0.004 / Math.max(r, 0.004)))   // 4 um chord error
  const n = Math.min(720, Math.max(2, Math.ceil(sweep / step)))
  const pts = []
  for (let k = 1; k <= n; k++) {
    const a = a0 + (cw ? -1 : 1) * sweep * k / n
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  pts[pts.length - 1] = [x1, y1]
  return pts
}

export function parseGerber(text) {
  const st = {
    int: 2, dec: 4, zero: 'L', abs: true, unit: INCH, unitSet: false,
    x: 0, y: 0, ap: null, interp: 1, multi: false, region: false, pol: 1, dcode: 2,
  }
  const aps = new Map(), macros = new Map(), ops = [], flashes = [], warn = new Set()
  let contour = null, contours = []
  const bb = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const grow = (x, y, r = 0) => {
    if (x - r < bb.minX) bb.minX = x - r
    if (y - r < bb.minY) bb.minY = y - r
    if (x + r > bb.maxX) bb.maxX = x + r
    if (y + r > bb.maxY) bb.maxY = y + r
  }

  function coord(s) {
    if (s.includes('.')) return parseFloat(s) * st.unit
    let neg = false
    if (s[0] === '-') { neg = true; s = s.slice(1) } else if (s[0] === '+') s = s.slice(1)
    let v
    if (st.zero === 'T') v = parseInt((s + '0'.repeat(20)).slice(0, st.int + st.dec), 10) / 10 ** st.dec
    else v = parseInt(s, 10) / 10 ** st.dec
    if (!Number.isFinite(v)) v = 0
    return (neg ? -v : v) * st.unit
  }

  function apRadius(ap) {
    if (!ap) return 0
    if (ap.kind === 'C' || ap.kind === 'P') return ap.d / 2
    if (ap.kind === 'R' || ap.kind === 'O') return Math.hypot(ap.w, ap.h) / 2
    return ap.r || 0
  }

  function defineAperture(code, name, paramStr) {
    const p = paramStr ? paramStr.split('X').map(v => parseFloat(v)) : []
    const U = v => (v || 0) * st.unit
    if (name === 'C') aps.set(code, { kind: 'C', d: U(p[0]) })
    else if (name === 'R') aps.set(code, { kind: 'R', w: U(p[0]), h: U(p[1]) })
    else if (name === 'O') aps.set(code, { kind: 'O', w: U(p[0]), h: U(p[1]) })
    else if (name === 'P') aps.set(code, { kind: 'P', d: U(p[0]), n: Math.max(3, Math.round(p[1] || 3)), rot: p[2] || 0 })
    else if (macros.has(name)) {
      const shapes = expandMacro(macros.get(name), p, st.unit, warn)
      let r = 0
      for (const s of shapes) {
        if (s.k === 'disc') r = Math.max(r, Math.hypot(s.cx, s.cy) + s.r)
        else for (const q of s.pts) r = Math.max(r, Math.hypot(q[0], q[1]))
      }
      aps.set(code, { kind: 'M', shapes, r, hasClear: shapes.some(s => !s.exp) })
    } else warn.add(`aperture D${code} uses undefined template "${name}"`)
  }

  function ext(block) {
    const stmts = block.split('*').map(s => s.trim()).filter(Boolean)
    for (let k = 0; k < stmts.length; k++) {
      const s = stmts[k]
      let m
      if ((m = /^FS([LT])([AI])X(\d)(\d)Y(\d)(\d)/.exec(s))) {
        st.zero = m[1]; st.abs = m[2] === 'A'; st.int = +m[3]; st.dec = +m[4]
        if (!st.abs) warn.add('incremental coordinates (FS..I) are deprecated; result may be wrong')
      } else if ((m = /^MO(IN|MM)/.exec(s))) { st.unit = m[1] === 'IN' ? INCH : 1; st.unitSet = true }
      else if ((m = /^AM(.+)$/.exec(s))) { macros.set(m[1].trim(), stmts.slice(k + 1)); break }
      else if ((m = /^ADD(\d+)([A-Za-z_.$][\w.$-]*)(?:,(.*))?$/.exec(s))) defineAperture(+m[1], m[2], m[3])
      else if ((m = /^LP([DC])/.exec(s))) st.pol = m[1] === 'D' ? 1 : 0
      else if ((m = /^SR(?:X(\d+))?(?:Y(\d+))?/.exec(s))) { if ((+m[1] || 1) > 1 || (+m[2] || 1) > 1) warn.add('step-and-repeat (SR) is not implemented; repeated copies are missing') }
      else if (/^LM[XY]/.test(s) || (/^LR/.test(s) && parseFloat(s.slice(2))) || (/^LS/.test(s) && parseFloat(s.slice(2)) !== 1)) warn.add('layer mirror/rotate/scale (LM/LR/LS) is not implemented')
      else if (/^IPNEG/.test(s)) warn.add('negative image polarity (IPNEG) is not implemented')
    }
  }

  function closeContour() {
    if (contour && contour.length > 2) contours.push(contour)
    contour = null
  }
  function flushRegion() {
    closeContour()
    if (contours.length) ops.push({ t: 'region', contours, pol: st.pol })
    contours = []
  }

  function doOp(x, y, i, j, d) {
    if (d === 2) {
      if (st.region) { closeContour(); contour = [[x, y]] }
    } else if (d === 1) {
      const pts = st.interp === 1 ? [[x, y]] : arcPoints(st.x, st.y, x, y, i, j, st.interp === 2, st.multi)
      if (st.region) {
        if (!contour) contour = [[st.x, st.y]]
        for (const p of pts) { contour.push(p); grow(p[0], p[1]) }
      } else {
        const ap = aps.get(st.ap)
        let w = 0
        if (!ap) warn.add('draw with no aperture selected (skipped)')
        else if (ap.kind === 'C') w = ap.d
        else if (ap.kind === 'R' || ap.kind === 'O') { w = Math.min(ap.w, ap.h); warn.add('stroke drawn with a non-circular aperture (approximated as round)') }
        else { w = 2 * (ap.r || 0); warn.add('stroke drawn with a macro/polygon aperture (approximated as round)') }
        if (ap) {
          let px = st.x, py = st.y
          grow(px, py, w / 2)
          for (const p of pts) {
            ops.push({ t: 'seg', x1: px, y1: py, x2: p[0], y2: p[1], w, pol: st.pol })
            grow(p[0], p[1], w / 2)
            px = p[0]; py = p[1]
          }
        }
      }
    } else if (d === 3) {
      const ap = aps.get(st.ap)
      if (!ap) warn.add('flash with no aperture selected (skipped)')
      else {
        ops.push({ t: 'flash', x, y, ap, pol: st.pol })
        if (st.pol) flashes.push({ x, y, ap })
        grow(x, y, apRadius(ap))
      }
    }
    st.x = x; st.y = y
  }

  function word(w) {
    if (/^G0*4(?!\d)/.test(w)) return
    let m
    while ((m = /^G(\d+)/.exec(w))) {
      const g = +m[1]; w = w.slice(m[0].length)
      if (g === 1 || g === 2 || g === 3) st.interp = g
      else if (g === 74) st.multi = false
      else if (g === 75) st.multi = true
      else if (g === 36) { st.region = true; contour = null; contours = [] }
      else if (g === 37) { flushRegion(); st.region = false }
      else if (g === 70) { st.unit = INCH; st.unitSet = true }
      else if (g === 71) { st.unit = 1; st.unitSet = true }
      else if (g === 90) st.abs = true
      else if (g === 91) st.abs = false
    }
    if (!w || /^M0*[012]$/.test(w)) return
    if ((m = /^D0*(\d+)$/.exec(w))) {
      const d = +m[1]
      if (d >= 10) st.ap = d
      else { st.dcode = d; if (d === 3 || (d === 2 && st.region)) doOp(st.x, st.y, 0, 0, d) }
      return
    }
    m = /^(?:X([+-]?[\d.]+))?(?:Y([+-]?[\d.]+))?(?:I([+-]?[\d.]+))?(?:J([+-]?[\d.]+))?(?:D0*(\d+))?$/.exec(w)
    if (!m || (m[1] == null && m[2] == null && m[3] == null && m[4] == null)) return
    let x = m[1] != null ? coord(m[1]) : null, y = m[2] != null ? coord(m[2]) : null
    if (st.abs) { if (x == null) x = st.x; if (y == null) y = st.y } else { x = st.x + (x || 0); y = st.y + (y || 0) }
    const i = m[3] != null ? coord(m[3]) : 0, j = m[4] != null ? coord(m[4]) : 0
    if (m[5] != null) { const d = +m[5]; if (d >= 10) { st.ap = d; return } st.dcode = d }
    doOp(x, y, i, j, st.dcode)
  }

  const src = text.replace(/\r/g, '')
  let p = 0
  while (p < src.length) {
    const c = src[p]
    if (c === '%') {
      const q = src.indexOf('%', p + 1)
      if (q < 0) break
      ext(src.slice(p + 1, q)); p = q + 1; continue
    }
    if (c === '\n' || c === ' ' || c === '\t' || c === '*') { p++; continue }
    const q = src.indexOf('*', p)
    if (q < 0) break
    word(src.slice(p, q).replace(/\s+/g, '')); p = q + 1
  }
  if (st.region) flushRegion()
  if (!st.unitSet) warn.add('no unit declared (%MO); inches assumed')
  return { ops, flashes, bbox: Number.isFinite(bb.minX) ? bb : null, warnings: [...warn] }
}

// ───────────────────────────── Excellon parser ─────────────────────────────

function tokenizeExcellon(text) {
  const t = { tools: new Map(), recs: [], unit: null, zeros: null, fmt: null, decimals: false, warnings: new Set() }
  let header = /^M48/m.test(text), tool = null, rout = false, down = false, lx = null, ly = null
  for (let line of text.replace(/\r/g, '').split('\n')) {
    line = line.trim()
    if (!line) continue
    let m
    if (line[0] === ';') {
      if ((m = /FILE_FORMAT\s*=\s*(\d+)\s*:\s*(\d+)/i.exec(line)) || (m = /FORMAT\s*=?\s*\{?\s*(\d+)\s*:\s*(\d+)/i.exec(line))) t.fmt = [+m[1], +m[2]]
      if (/suppress\s+trailing/i.test(line)) t.zeros = 'LZ'
      if (/suppress\s+leading/i.test(line)) t.zeros = 'TZ'
      continue
    }
    if (line === '%' || line === 'M95') { header = false; continue }
    if (line === 'M48') { header = true; continue }
    if ((m = /^(INCH|METRIC)(?:,(LZ|TZ))?(?:,(0+)\.(0+))?/i.exec(line))) {
      t.unit = m[1].toUpperCase() === 'INCH' ? INCH : 1
      if (m[2]) t.zeros = m[2].toUpperCase()
      if (m[3]) t.fmt = [m[3].length, m[4].length]
      continue
    }
    if (line === 'M71') { t.unit = 1; continue }
    if (line === 'M72') { t.unit = INCH; continue }
    if ((m = /^T(\d+)(?:[FSBHZ][\d.]+)*C([\d.]+)/.exec(line))) {
      t.tools.set(+m[1], parseFloat(m[2]))
      if (!header) tool = +m[1]
      continue
    }
    if ((m = /^T(\d+)$/.exec(line))) { tool = +m[1]; continue }
    if (header) continue
    if (line === 'G05' || line === 'G81') { rout = false; down = false; continue }
    if (line === 'M15') { down = true; continue }
    if (line === 'M16' || line === 'M17') { down = false; continue }
    if (/^M30|^M00/.test(line)) break
    if (/^R\d+/.test(line)) { t.warnings.add('drill repeat codes (R) are not implemented; some holes are missing'); continue }
    m = /^(G0?0|G0?1)?(?:X([+-]?[\d.]+))?(?:Y([+-]?[\d.]+))?(?:G85(?:X([+-]?[\d.]+))?(?:Y([+-]?[\d.]+))?)?$/.exec(line)
    if (!m || (m[2] == null && m[3] == null)) continue
    if (m[2] && m[2].includes('.') || m[3] && m[3].includes('.')) t.decimals = true
    const x = m[2] != null ? m[2] : lx, y = m[3] != null ? m[3] : ly
    if (m[1] && /0$/.test(m[1])) { rout = true; lx = x; ly = y; continue }
    if (m[4] != null || m[5] != null) {
      t.recs.push({ k: 'slot', x, y, x2: m[4] != null ? m[4] : x, y2: m[5] != null ? m[5] : y, tool })
    } else if (rout && m[1]) {
      if (down && lx != null) t.recs.push({ k: 'slot', x: lx, y: ly, x2: x, y2: y, tool })
    } else if (x != null && y != null) t.recs.push({ k: 'hit', x, y, tool })
    lx = x; ly = y
  }
  return t
}

function resolveExcellon(t, unit, fmt, zeros) {
  const cv = s => {
    if (s.includes('.')) return parseFloat(s) * unit
    let neg = false
    if (s[0] === '-') { neg = true; s = s.slice(1) } else if (s[0] === '+') s = s.slice(1)
    const v = zeros === 'LZ'
      ? parseInt((s + '0'.repeat(20)).slice(0, fmt[0] + fmt[1]), 10) / 10 ** fmt[1]
      : parseInt(s, 10) / 10 ** fmt[1]
    return (neg ? -1 : 1) * (Number.isFinite(v) ? v : 0) * unit
  }
  const hits = [], slots = []
  for (const r of t.recs) {
    const d = (t.tools.get(r.tool) || 0) * unit
    if (r.k === 'hit') hits.push({ x: cv(r.x), y: cv(r.y), d })
    else slots.push({ x1: cv(r.x), y1: cv(r.y), x2: cv(r.x2), y2: cv(r.y2), d })
  }
  return { hits, slots }
}

// Excellon files often omit their number format. Try the plausible formats
// and keep the one that puts the most holes inside the board outline.
export function parseExcellon(text, boardBox) {
  const t = tokenizeExcellon(text)
  const warnings = [...t.warnings]
  const units = t.unit ? [t.unit] : [INCH, 1]
  const cands = []
  for (const u of units) {
    const fmts = t.decimals ? [[2, 4]] : t.fmt ? [t.fmt] : (u === INCH ? [[2, 4], [2, 5], [2, 3], [3, 3]] : [[3, 3], [4, 2], [3, 2], [4, 3], [2, 4]])
    const zs = t.decimals ? ['TZ'] : t.zeros ? [t.zeros] : ['TZ', 'LZ']
    for (const f of fmts) for (const z of zs) cands.push({ u, f, z })
  }
  let best = null
  for (const c of cands) {
    const r = resolveExcellon(t, c.u, c.f, c.z)
    let inside = 0
    if (boardBox) {
      const pad = 1.5
      for (const h of r.hits) if (h.x >= boardBox.minX - pad && h.x <= boardBox.maxX + pad && h.y >= boardBox.minY - pad && h.y <= boardBox.maxY + pad) inside++
    }
    if (!best || inside > best.inside) best = { ...r, inside, c }
  }
  if (!best) return { hits: [], slots: [], warnings }
  if (cands.length > 1) warnings.push(`drill number format not declared; inferred ${best.c.u === INCH ? 'inch' : 'mm'} ${best.c.f[0]}:${best.c.f[1]} ${best.c.z} (${best.inside}/${best.hits.length} holes inside the board)`)
  if (boardBox && best.hits.length && best.inside < best.hits.length * 0.8) warnings.push(`only ${best.inside} of ${best.hits.length} drill hits fall inside the board; drill alignment is suspect`)
  return { hits: best.hits, slots: best.slots, warnings }
}

// ─────────────────────────────── rasteriser ───────────────────────────────

export class Raster {
  constructor(W, H) { this.W = W; this.H = H; this.m = new Uint8Array(W * H) }
  span(y, xa, xb, v) {
    if (y < 0 || y >= this.H) return
    let a = Math.ceil(xa - 0.5), b = Math.floor(xb - 0.5)
    if (a < 0) a = 0
    if (b >= this.W) b = this.W - 1
    if (b >= a) this.m.fill(v, y * this.W + a, y * this.W + b + 1)
  }
  disc(cx, cy, r, v) {
    if (r < 0.75) r = 0.75                       // never thinner than one pixel
    const y0 = Math.ceil(cy - r - 0.5), y1 = Math.floor(cy + r - 0.5)
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy, dx = Math.sqrt(Math.max(0, r * r - dy * dy))
      this.span(y, cx - dx, cx + dx, v)
    }
  }
  poly(pts, v) {
    const n = pts.length
    if (n < 3) return
    let ymin = Infinity, ymax = -Infinity
    for (const p of pts) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1] }
    const r0 = Math.max(0, Math.ceil(ymin - 0.5)), r1 = Math.min(this.H - 1, Math.floor(ymax - 0.5))
    if (r1 < r0) return
    const rows = new Array(r1 - r0 + 1)
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[(k + 1) % n]
      let x0 = a[0], y0 = a[1], x1 = b[0], y1 = b[1]
      if (y0 === y1) continue
      if (y0 > y1) { const tx = x0, ty = y0; x0 = x1; y0 = y1; x1 = tx; y1 = ty }
      const ya = Math.max(r0, Math.ceil(y0 - 0.5)), yb = Math.min(r1, Math.ceil(y1 - 0.5) - 1)
      const k2 = (x1 - x0) / (y1 - y0)
      for (let y = ya; y <= yb; y++) (rows[y - r0] ||= []).push(x0 + (y + 0.5 - y0) * k2)
    }
    for (let y = r0; y <= r1; y++) {
      const xs = rows[y - r0]
      if (!xs) continue
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) this.span(y, xs[k], xs[k + 1], v)
    }
  }
  seg(x1, y1, x2, y2, w, v) {
    if (w < 1.5) w = 1.5                         // keep thin traces continuous
    const r = w / 2
    this.disc(x1, y1, r, v)
    const len = Math.hypot(x2 - x1, y2 - y1)
    if (len < 1e-6) return
    this.disc(x2, y2, r, v)
    const nx = -(y2 - y1) / len * r, ny = (x2 - x1) / len * r
    this.poly([[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]], v)
  }
}

function makeView(bbox, maxPixels, maxDim) {
  const pad = 0.5
  const wmm = bbox.maxX - bbox.minX + 2 * pad, hmm = bbox.maxY - bbox.minY + 2 * pad
  let s = 50                                     // start at 20 um / pixel
  s = Math.min(s, maxDim / Math.max(wmm, hmm), Math.sqrt(maxPixels / (wmm * hmm)))
  const W = Math.max(8, Math.ceil(wmm * s)), H = Math.max(8, Math.ceil(hmm * s))
  return { s, W, H, X: x => (x - bbox.minX + pad) * s, Y: y => (bbox.maxY - y + pad) * s }
}

function drawFlash(R, view, x, y, ap, v) {
  const s = view.s, cx = view.X(x), cy = view.Y(y)
  const P = pts => pts.map(p => [cx + p[0] * s, cy - p[1] * s])
  if (ap.kind === 'C') R.disc(cx, cy, ap.d * s / 2, v)
  else if (ap.kind === 'R') { const w = ap.w / 2, h = ap.h / 2; R.poly(P([[-w, -h], [w, -h], [w, h], [-w, h]]), v) }
  else if (ap.kind === 'O') {
    if (ap.w >= ap.h) { const e = (ap.w - ap.h) / 2 * s; R.seg(cx - e, cy, cx + e, cy, ap.h * s, v) }
    else { const e = (ap.h - ap.w) / 2 * s; R.seg(cx, cy - e, cx, cy + e, ap.w * s, v) }
  } else if (ap.kind === 'P') {
    const pts = []
    for (let k = 0; k < ap.n; k++) { const t = 2 * Math.PI * k / ap.n + ap.rot * Math.PI / 180; pts.push([ap.d / 2 * Math.cos(t), ap.d / 2 * Math.sin(t)]) }
    R.poly(P(pts), v)
  } else if (ap.kind === 'M') {
    const draw = (T, ox, oy, val) => {
      for (const sh of ap.shapes) {
        const on = sh.exp ? val : 0
        if (sh.k === 'disc') T.disc(cx + sh.cx * s - ox, cy - sh.cy * s - oy, sh.r * s, on)
        else T.poly(sh.pts.map(p => [cx + p[0] * s - ox, cy - p[1] * s - oy]), on)
      }
    }
    if (!ap.hasClear) draw(R, 0, 0, v)
    else {
      // Exposure-off primitives only erase inside this flash: draw to a
      // scratch bitmap, then stamp the result.
      const rr = Math.ceil(ap.r * s) + 2, ox = Math.floor(cx) - rr, oy = Math.floor(cy) - rr, side = 2 * rr + 1
      const T = new Raster(side, side)
      draw(T, ox, oy, 1)
      for (let ty = 0; ty < side; ty++) {
        const gy = oy + ty
        if (gy < 0 || gy >= R.H) continue
        for (let tx = 0; tx < side; tx++) {
          const gx = ox + tx
          if (gx >= 0 && gx < R.W && T.m[ty * side + tx]) R.m[gy * R.W + gx] = v
        }
      }
    }
  }
}

function rasterLayer(layer, view) {
  const R = new Raster(view.W, view.H)
  for (const o of layer.ops) {
    const v = o.pol ? 1 : 0
    if (o.t === 'seg') R.seg(view.X(o.x1), view.Y(o.y1), view.X(o.x2), view.Y(o.y2), o.w * view.s, v)
    else if (o.t === 'flash') drawFlash(R, view, o.x, o.y, o.ap, v)
    else if (o.t === 'region') for (const c of o.contours) R.poly(c.map(p => [view.X(p[0]), view.Y(p[1])]), v)
  }
  return R
}

// 4-connected component labelling. Returns the number of components; labels
// are written as base+1 .. base+count into `labels`.
function label(mask, W, H, labels, base) {
  const stack = new Int32Array(W * H)
  let count = 0
  for (let p0 = 0; p0 < mask.length; p0++) {
    if (!mask[p0] || labels[p0]) continue
    const id = base + (++count)
    let sp = 0
    stack[sp++] = p0; labels[p0] = id
    while (sp) {
      const p = stack[--sp], x = p % W
      if (x > 0 && mask[p - 1] && !labels[p - 1]) { labels[p - 1] = id; stack[sp++] = p - 1 }
      if (x < W - 1 && mask[p + 1] && !labels[p + 1]) { labels[p + 1] = id; stack[sp++] = p + 1 }
      if (p >= W && mask[p - W] && !labels[p - W]) { labels[p - W] = id; stack[sp++] = p - W }
      if (p + W < mask.length && mask[p + W] && !labels[p + W]) { labels[p + W] = id; stack[sp++] = p + W }
    }
  }
  return count
}

// ─────────────────────────────── board build ───────────────────────────────

const unionBox = (a, b) => !a ? b : !b ? a : {
  minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY),
  maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY),
}

// files: [{ name, text }]
export function buildBoard(files) {
  const warnings = [], layers = [], drillFiles = []
  for (const f of files) {
    const id = identifyLayer(f.name, f.text)
    if (!id.kind) { warnings.push(`${f.name}: not recognised as Gerber or Excellon (ignored)`); continue }
    if (id.kind === 'drill') { drillFiles.push({ name: f.name, text: f.text, plated: id.plated !== false }); continue }
    const g = parseGerber(f.text)
    for (const w of g.warnings) warnings.push(`${f.name}: ${w}`)
    if (!g.bbox) { warnings.push(`${f.name}: no drawable content`); continue }
    if (id.type === 'drill') {
      // Drill data delivered as a Gerber file (X2 Plated / NonPlated).
      drillFiles.push({ name: f.name, plated: id.plated !== false, hits: g.flashes.filter(q => q.ap.kind === 'C').map(q => ({ x: q.x, y: q.y, d: q.ap.d })) })
      continue
    }
    layers.push({ name: f.name, ...id, ops: g.ops, flashes: g.flashes, bbox: g.bbox })
  }
  let copper = layers.filter(l => l.type === 'copper')
  if (!copper.length) {
    const other = layers.filter(l => l.type === 'other')
    if (other.length) {
      warnings.push('no copper layer recognised from file names; treating unidentified Gerber layers as copper')
      other.forEach((l, k) => { l.type = 'copper'; l.side = 'inner'; l.index = k + 1; l.guessed = true })
      copper = other
    }
  }
  const order = l => l.side === 'top' ? 0 : l.side === 'bottom' ? 1000 : (l.index || 500)
  copper.sort((a, b) => order(a) - order(b))
  const outline = layers.find(l => l.type === 'outline')
  let bbox = outline ? outline.bbox : null
  for (const l of copper) bbox = unionBox(bbox, l.bbox)
  const drills = []
  for (const d of drillFiles) {
    if (d.hits) { drills.push({ name: d.name, plated: d.plated, hits: d.hits, slots: [] }); continue }
    const r = parseExcellon(d.text, bbox)
    for (const w of r.warnings) warnings.push(`${d.name}: ${w}`)
    drills.push({ name: d.name, plated: d.plated, hits: r.hits, slots: r.slots })
  }
  return { layers, copper, drills, bbox, warnings }
}

// ─────────────────────────────── net analysis ───────────────────────────────

export function analyzeBoard(board, opts = {}) {
  if (!board.bbox || !board.copper.length) return null
  const view = makeView(board.bbox, opts.maxPixels || 6e6, opts.maxDim || 3600)
  const { W, H, s } = view
  const warnings = []
  const cu = [], parentSize = [0]
  let base = 0
  for (const l of board.copper) {
    const R = rasterLayer(l, view)
    const labels = new Int32Array(W * H)
    const n = label(R.m, W, H, labels, base)
    cu.push({ layer: l, labels })
    base += n
  }
  const parent = new Int32Array(base + 1)
  for (let k = 0; k <= base; k++) parent[k] = k
  const find = a => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a] } return a }
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b) }

  // Join layers at plated holes: any copper touching the hole wall on any
  // layer is one net.
  const drillPts = []
  const at = (labels, x, y) => (x < 0 || y < 0 || x >= W || y >= H) ? 0 : labels[y * W + x]
  const joinAt = (x, y, d) => {
    const cx = view.X(x), cy = view.Y(y), rr = d * s / 2 + 1.5
    let first = 0
    for (const c of cu) {
      const seen = new Set()
      let v = at(c.labels, Math.floor(cx), Math.floor(cy))
      if (v) seen.add(v)
      for (let k = 0; k < 12; k++) {
        const t = k * Math.PI / 6
        v = at(c.labels, Math.floor(cx + rr * Math.cos(t)), Math.floor(cy + rr * Math.sin(t)))
        if (v) seen.add(v)
      }
      for (const q of seen) { if (!first) first = q; else union(first, q) }
    }
    drillPts.push({ x, y, d, net: first })
  }
  let plated = 0
  for (const dr of board.drills) {
    if (!dr.plated) continue
    for (const h of dr.hits) { joinAt(h.x, h.y, h.d); plated++ }
    for (const sl of dr.slots) { joinAt(sl.x1, sl.y1, sl.d); joinAt(sl.x2, sl.y2, sl.d) }
  }
  if (cu.length > 1 && !plated) warnings.push('no plated drill hits found: layers are NOT joined, nets are per-layer only')

  // Per-net statistics
  const nets = new Map()
  const get = root => {
    let n = nets.get(root)
    if (!n) { n = { id: root, area: 0, layers: new Set(), pads: 0, vias: 0, minX: W, minY: H, maxX: 0, maxY: 0 }; nets.set(root, n) }
    return n
  }
  const rootOf = new Int32Array(base + 1)
  for (let k = 1; k <= base; k++) rootOf[k] = find(k)
  cu.forEach((c, li) => {
    const L = c.labels
    for (let p = 0; p < L.length; p++) {
      const v = L[p]
      if (!v) continue
      const n = get(rootOf[v])
      n.area++; n.layers.add(li)
      const x = p % W, y = (p - x) / W
      if (x < n.minX) n.minX = x
      if (x > n.maxX) n.maxX = x
      if (y < n.minY) n.minY = y
      if (y > n.maxY) n.maxY = y
    }
  })
  const pads = []
  cu.forEach((c, li) => {
    for (const f of c.layer.flashes) {
      const px = Math.floor(view.X(f.x)), py = Math.floor(view.Y(f.y))
      let v = at(c.labels, px, py)
      for (let k = 0; !v && k < 8; k++) v = at(c.labels, px + [1, -1, 0, 0, 1, 1, -1, -1][k], py + [0, 0, 1, -1, 1, -1, 1, -1][k])
      if (!v) continue
      const root = rootOf[v]
      get(root).pads++
      pads.push({ layer: li, x: f.x, y: f.y, net: root })
    }
  })
  for (const d of drillPts) { if (d.net) { d.net = rootOf[d.net]; get(d.net).vias++ } }
  const pxMm = 1 / s
  if (pxMm > 0.05) warnings.push(`raster resolution is ${(pxMm * 1000).toFixed(0)} um per pixel; copper features closer than about ${(pxMm * 2000).toFixed(0)} um may be merged into one net`)
  const px2 = pxMm * pxMm
  const list = [...nets.values()].map(n => ({ ...n, layers: [...n.layers].sort(), areaMm2: n.area * px2 }))
  list.sort((a, b) => b.pads - a.pads || b.area - a.area)
  return { view, W, H, pxMm, cu, rootOf, nets: list, netById: new Map(list.map(n => [n.id, n])), pads, drills: drillPts, warnings }
}

// Net at a board-image position (fractions 0..1). Searches a small window so
// a click next to a thin trace still lands on it. Visible layers only.
export function netAt(an, fx, fy, visible) {
  const x0 = Math.floor(fx * an.W), y0 = Math.floor(fy * an.H)
  for (let r = 0; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
      const x = x0 + dx, y = y0 + dy
      if (x < 0 || y < 0 || x >= an.W || y >= an.H) continue
      for (let li = 0; li < an.cu.length; li++) {
        if (visible && !visible[li]) continue
        const v = an.cu[li].labels[y * an.W + x]
        if (v) return an.rootOf[v]
      }
    }
  }
  return 0
}

// ─────────────────────────────── rendering ───────────────────────────────

export const LAYER_COLORS = [[214, 58, 47], [233, 163, 42], [168, 92, 212], [53, 170, 120], [70, 150, 235], [240, 110, 170]]
export function copperColor(an, li) {
  const l = an.cu[li].layer
  if (l.side === 'top') return LAYER_COLORS[0]
  if (l.side === 'bottom') return LAYER_COLORS[4]
  return LAYER_COLORS[1 + ((li - 1) % 3)]
}

// RGBA picture of the board. opts.visible[li] toggles copper layers,
// opts.silk / opts.outline / opts.drills toggle the extras.
export function composeRGBA(board, an, opts = {}) {
  const { W, H, view } = an
  const out = new Uint8ClampedArray(W * H * 4)
  for (let p = 0; p < W * H; p++) { out[p * 4] = 12; out[p * 4 + 1] = 30; out[p * 4 + 2] = 22; out[p * 4 + 3] = 255 }
  const blend = (p, c, a) => {
    const q = p * 4
    out[q] += (c[0] - out[q]) * a; out[q + 1] += (c[1] - out[q + 1]) * a; out[q + 2] += (c[2] - out[q + 2]) * a
  }
  for (let li = an.cu.length - 1; li >= 0; li--) {
    if (opts.visible && !opts.visible[li]) continue
    const L = an.cu[li].labels, c = copperColor(an, li)
    for (let p = 0; p < L.length; p++) if (L[p]) blend(p, c, 0.72)
  }
  const extra = (type, side, color, a) => {
    for (const l of board.layers) {
      if (l.type !== type || (side && l.side !== side)) continue
      const R = rasterLayer(l, view)
      for (let p = 0; p < R.m.length; p++) if (R.m[p]) blend(p, color, a)
    }
  }
  if (opts.silk !== false) extra('silk', 'top', [238, 238, 230], 0.85)
  if (opts.outline !== false) extra('outline', null, [250, 215, 60], 0.95)
  if (opts.drills !== false) {
    const R = new Raster(W, H)
    for (const dr of board.drills) {
      for (const h of dr.hits) R.disc(view.X(h.x), view.Y(h.y), Math.max(1, h.d * view.s / 2), 1)
      for (const sl of dr.slots) R.seg(view.X(sl.x1), view.Y(sl.y1), view.X(sl.x2), view.Y(sl.y2), Math.max(2, sl.d * view.s), 1)
    }
    for (let p = 0; p < R.m.length; p++) if (R.m[p]) blend(p, [0, 0, 0], 0.9)
  }
  return out
}

// Transparent RGBA overlay with one net lit up (all layers it spans).
export function highlightRGBA(an, netId) {
  const { W, H } = an
  const out = new Uint8ClampedArray(W * H * 4)
  const tint = [[255, 240, 60], [120, 255, 255], [255, 150, 255], [170, 255, 150], [150, 220, 255], [255, 200, 150]]
  for (let li = an.cu.length - 1; li >= 0; li--) {
    const L = an.cu[li].labels, c = tint[li % tint.length]
    for (let p = 0; p < L.length; p++) {
      const v = L[p]
      if (v && an.rootOf[v] === netId) { const q = p * 4; out[q] = c[0]; out[q + 1] = c[1]; out[q + 2] = c[2]; out[q + 3] = 235 }
    }
  }
  return out
}

// Plain-data netlist for export.
export function exportNetlist(board, an) {
  const r3 = v => Math.round(v * 1000) / 1000
  const layerNames = an.cu.map(c => c.layer.name)
  return {
    generator: 'EOL-CHIP PCB Inspect (Gerber raster net tracer)',
    units: 'mm',
    resolution_um_per_px: Math.round(an.pxMm * 1000),
    board_mm: { width: r3(board.bbox.maxX - board.bbox.minX), height: r3(board.bbox.maxY - board.bbox.minY) },
    copper_layers: layerNames,
    nets: an.nets.map((n, k) => ({
      net: k + 1,
      pads: an.pads.filter(p => p.net === n.id).map(p => ({ layer: layerNames[p.layer], x: r3(p.x), y: r3(p.y) })),
      vias_or_holes: an.drills.filter(d => d.net === n.id).map(d => ({ x: r3(d.x), y: r3(d.y), drill: r3(d.d) })),
      layers: n.layers.map(li => layerNames[li]),
      copper_area_mm2: r3(n.areaMm2),
    })),
  }
}

// ─────────────────────────────── zip reader ───────────────────────────────
// Minimal ZIP reader (stored + deflate) on the platform DecompressionStream.

export async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  let eocd = -1
  for (let p = u8.length - 22; p >= Math.max(0, u8.length - 66000); p--) if (dv.getUint32(p, true) === 0x06054b50) { eocd = p; break }
  if (eocd < 0) throw new Error('not a ZIP file (no end-of-central-directory record)')
  const count = dv.getUint16(eocd + 10, true)
  let p = dv.getUint32(eocd + 16, true)
  const out = []
  for (let k = 0; k < count && p + 46 <= u8.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true)
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true)
    const lho = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen))
    p += 46 + nlen + xlen + clen
    if (name.endsWith('/') || usize > 64e6) continue
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true)
    const raw = u8.subarray(start, start + csize)
    let bytes
    if (method === 0) bytes = raw
    else if (method === 8) bytes = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer())
    else continue
    out.push({ name, bytes })
  }
  return out
}

export const GERBER_EXT = /\.(gbr|ger|pho|art|gtl|gbl|gts|gbs|gto|gbo|gtp|gbp|gko|gml|gm\d+|g\d+|gp\d+|gl\d+|cmp|sol|stc|sts|plc|pls|crc|crs|dim|oln|mil|drl|xln|drd|exc|ncd|zip)$/i
