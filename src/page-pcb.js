import { initNav, renderSourcesFooter, loadMeta } from './common.js?v=47'
import Fuse from 'https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.mjs'

initNav('pcb')        // no-op: app shell has no #nav
renderSourcesFooter() // no-op: app shell has no footer
loadMeta()            // best-effort metadata fetch

// ── App shell wiring (modal / drawer / banner / first-run) ────────
const shell = {
  modal:          document.getElementById('modal-settings'),
  modalBackdrop:  document.getElementById('modal-backdrop'),
  btnSettings:    document.getElementById('btn-settings'),
  btnCloseSet:    document.getElementById('btn-close-settings'),
  drawer:         document.getElementById('drawer-help'),
  btnHelp:        document.getElementById('btn-help'),
  btnCloseHelp:   document.getElementById('btn-close-help'),
  banner:         document.getElementById('banner-quality'),
  btnDismissBan:  document.getElementById('btn-dismiss-banner'),
  modelLabel:     document.getElementById('app-model-label'),
  fileLabel:      document.getElementById('app-file-label'),
  imagePane:      document.querySelector('.app-image-pane'),
  detCount:       document.getElementById('det-count'),
}

function openModal() { if (shell.modal) shell.modal.style.display = 'flex' }
function closeModal() { if (shell.modal) shell.modal.style.display = 'none' }
shell.btnSettings?.addEventListener('click', openModal)
shell.btnCloseSet?.addEventListener('click', closeModal)
shell.modalBackdrop?.addEventListener('click', closeModal)
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && shell.modal?.style.display === 'flex') closeModal()
})

function openDrawer() { if (shell.drawer) shell.drawer.style.display = '' }
function closeDrawer() { if (shell.drawer) shell.drawer.style.display = 'none' }
shell.btnHelp?.addEventListener('click', openDrawer)
shell.btnCloseHelp?.addEventListener('click', closeDrawer)

// One-time image-quality banner — appears unless previously dismissed.
const BANNER_LS = 'eol-pcb-banner-dismissed-v1'
if (shell.banner) {
  try {
    if (!localStorage.getItem(BANNER_LS)) shell.banner.style.display = ''
  } catch { shell.banner.style.display = '' }
}
shell.btnDismissBan?.addEventListener('click', () => {
  if (shell.banner) shell.banner.style.display = 'none'
  try { localStorage.setItem(BANNER_LS, '1') } catch {}
})

function updateModelLabel() {
  if (!shell.modelLabel) return
  const p = PROVIDERS?.[state.provider]
  if (!p) return
  if (p.needsKey && !state.apiKey) {
    shell.modelLabel.textContent = 'Set up'
    shell.btnSettings?.classList.add('app-iconbtn--attention')
  } else {
    shell.modelLabel.textContent = `${p.label} · ${state.model || p.defaultModel}`
    shell.btnSettings?.classList.remove('app-iconbtn--attention')
  }
}
function updateFileLabel(name, w, h) {
  if (!shell.fileLabel) return
  if (!name) { shell.fileLabel.textContent = ''; return }
  shell.fileLabel.textContent = w && h ? `${name} · ${w}×${h}` : name
}

// ── Providers ────────────────────────────────────────────────────────
const PROVIDERS = {
  anthropic: {
    label: 'Anthropic',
    keyLabel: 'sk-ant-…',
    needsKey: true,
    help: 'Get a key at <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>. Sent to <code>api.anthropic.com</code>. Paid per request.',
    models: [
      { id: 'claude-opus-4-7',           label: 'Opus 4.7 (best accuracy)' },
      { id: 'claude-sonnet-4-6',         label: 'Sonnet 4.6 (faster, cheaper)' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5 (fastest)' },
    ],
    defaultModel: 'claude-sonnet-4-6',
  },
  gemini: {
    label: 'Google Gemini',
    keyLabel: 'AIza…',
    needsKey: true,
    help: 'Free key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a>. Sent to <code>generativelanguage.googleapis.com</code>. Free tier: ~15 req/min on Flash.',
    models: [
      { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro (best)' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (fast, free)' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (cheapest)' },
    ],
    defaultModel: 'gemini-2.5-flash',
  },
  ollama: {
    label: 'Ollama',
    keyLabel: 'http://localhost:11434',
    needsKey: false,
    help: 'Install <a href="https://ollama.com/" target="_blank" rel="noopener">Ollama</a>, then <code>ollama pull llama3.2-vision</code>. Start with <code>OLLAMA_ORIGINS="*" ollama serve</code> so the browser can reach it. Override the host below if not on localhost.',
    models: [
      { id: 'llama3.2-vision',    label: 'llama3.2-vision (11B)' },
      { id: 'llama3.2-vision:90b', label: 'llama3.2-vision:90b (huge)' },
      { id: 'llava',              label: 'llava (older, lighter)' },
      { id: 'moondream',          label: 'moondream (tiny, fast)' },
    ],
    defaultModel: 'llama3.2-vision',
  },
}

// ── State ─────────────────────────────────────────────────────────────
const state = {
  provider: 'gemini',
  apiKey: '',
  model: '',
  ollamaHost: 'http://localhost:11434',
  imageDataUrl: null,
  imageMime: 'image/png',
  detections: [],
  imgNatural: { w: 0, h: 0 },
  pdfDoc: null,        // pdf.js document if user uploaded a PDF
  pdfPage: 1,          // currently rendered page (1-indexed)
  pdfPageCount: 0,
  lastRun: null,       // {provider, model, when, durationMs, tokensIn, tokensOut, cost} for reproducibility stamp
  rawModelText: '',    // last raw model response text
  palette: 'default',  // 'default' | 'cb' (colour-blind safe)
  selectedDetectionId: null, // for keyboard nav
  view: { x: 0, y: 0, scale: 1 }, // pan/zoom transform on the image
  editMode: false,     // when true, dragging a handle resizes bbox
  extraImages: [],     // additional images (top + bottom + close-ups) [{dataUrl, mime, label}]
  ocrHint: null,       // text returned by the OCR pre-pass, fed into the main prompt
}

const els = {
  provRadios: [...document.querySelectorAll('input[name="provider"]')],
  provHelp:   document.getElementById('provider-help'),
  apiKey:     document.getElementById('api-key'),
  modelSel:   document.getElementById('model-select'),
  saveKey:    document.getElementById('save-key'),
  clearKey:   document.getElementById('clear-key'),
  keyStatus:  document.getElementById('key-status'),
  drop:       document.getElementById('drop-zone'),
  file:       document.getElementById('file-input'),
  controls:   document.getElementById('pcb-controls'),
  analyze:    document.getElementById('analyze-btn'),
  reset:      document.getElementById('reset-btn'),
  optPins:    document.getElementById('opt-pins'),
  optAttacks: document.getElementById('opt-attacks'),
  optSchem:   document.getElementById('opt-schematic'),
  optConf:    document.getElementById('opt-conf'),
  optConfVal: document.getElementById('opt-conf-val'),
  pdfPages:   document.getElementById('pdf-pages'),
  pdfPrev:    document.getElementById('pdf-prev'),
  pdfNext:    document.getElementById('pdf-next'),
  pdfPageNum: document.getElementById('pdf-page-num'),
  resultSec:  document.getElementById('pcb-result-section'),
  image:      document.getElementById('pcb-image'),
  canvas:     document.getElementById('pcb-canvas'),
  status:     document.getElementById('pcb-status'),
  panel:      document.getElementById('pcb-panel'),
}

// ── Provider + key handling ─────────────────────────────────────────
const PROVIDER_LS = 'eol-pcb-provider'
const SESSION_ONLY_LS = 'eol-pcb-session-only'  // flag stays in localStorage
const keyLsFor   = p => `eol-pcb-key-${p}`
const modelLsFor = p => `eol-pcb-model-${p}`
const OLLAMA_HOST_LS = 'eol-pcb-ollama-host'

// Pick the storage backend for KEYS based on the session-only toggle.
// Everything else (provider preference, model selection, palette) stays in
// localStorage — those aren't secrets.
function keyStore() {
  try { return localStorage.getItem(SESSION_ONLY_LS) === '1' ? sessionStorage : localStorage }
  catch { return localStorage }
}
function getKey(p)   { try { return keyStore().getItem(keyLsFor(p)) || '' } catch { return '' } }
function setKey(p, v) {
  try {
    // Always clear from the OTHER store so switching modes doesn't leave a stale key behind.
    localStorage.removeItem(keyLsFor(p))
    sessionStorage.removeItem(keyLsFor(p))
    if (v) keyStore().setItem(keyLsFor(p), v)
  } catch {}
}

function setModelOptions(models, selected) {
  // Escape model id+label — Ollama models come from /api/tags response and
  // could in principle contain HTML/quote characters.
  els.modelSel.innerHTML = models.map(m =>
    `<option value="${escapeHtmlAttr(m.id)}">${escapeHtml(m.label)}</option>`).join('')
  if (selected && models.some(m => m.id === selected)) els.modelSel.value = selected
  else if (models.length) els.modelSel.value = models[0].id
}

function applyProviderUI() {
  const p = PROVIDERS[state.provider]
  els.provHelp.innerHTML = p.help
  setModelOptions(p.models, state.model || p.defaultModel)
  // Key input behavior
  if (p.needsKey) {
    els.apiKey.type = 'password'
    els.apiKey.placeholder = p.keyLabel
    els.apiKey.value = state.apiKey
    els.apiKey.disabled = false
  } else {
    // Ollama: reuse the input for the host URL instead.
    els.apiKey.type = 'text'
    els.apiKey.placeholder = p.keyLabel
    els.apiKey.value = state.ollamaHost
    els.apiKey.disabled = false
  }
  // Status line
  if (p.needsKey) {
    if (state.apiKey) {
      els.keyStatus.textContent = `Key loaded (${state.apiKey.slice(0, 10)}…) for ${p.label}. Saved in this browser only.`
      els.keyStatus.className = 'pcb-keystatus pcb-keystatus--ok'
    } else {
      els.keyStatus.textContent = `No ${p.label} key set. Analysis will fail until you save one.`
      els.keyStatus.className = 'pcb-keystatus'
    }
  } else {
    els.keyStatus.textContent = `Ollama host: ${state.ollamaHost}. Probing for installed models…`
    els.keyStatus.className = 'pcb-keystatus'
    refreshOllamaModels()
  }
  // Reflect provider+model in the header
  updateModelLabel()
  // Enable/disable Analyze button based on whether we now have an image AND key
  refreshAnalyzeEnabled()
}

function refreshAnalyzeEnabled() {
  const p = PROVIDERS[state.provider]
  const haveKey = !p.needsKey || !!state.apiKey
  const haveImg = !!state.imageDataUrl
  if (els.analyze) els.analyze.disabled = !(haveKey && haveImg)
}

async function refreshOllamaModels() {
  const host = (state.ollamaHost || 'http://localhost:11434').replace(/\/+$/, '')
  const fallback = PROVIDERS.ollama.models
  try {
    const res = await fetch(host + '/api/tags', { method: 'GET' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    const installed = (data.models || []).map(m => ({ id: m.name, label: m.name + (m.size ? ` (${(m.size / 1e9).toFixed(1)} GB)` : '') }))
    if (!installed.length) {
      els.keyStatus.innerHTML = `Connected to <code>${escapeHtml(host)}</code> but no models installed. Run: <code>ollama pull llama3.2-vision</code>`
      els.keyStatus.className = 'pcb-keystatus'
      setModelOptions(fallback, state.model)
      return
    }
    setModelOptions(installed, state.model)
    els.keyStatus.innerHTML = `Connected to <code>${escapeHtml(host)}</code> &middot; ${installed.length} model${installed.length === 1 ? '' : 's'} installed. (Use a vision model like <code>llama3.2-vision</code> for PCB analysis.)`
    els.keyStatus.className = 'pcb-keystatus pcb-keystatus--ok'
  } catch (e) {
    setModelOptions(fallback, state.model)
    const origin = location.origin
    const cmd = `OLLAMA_ORIGINS="${origin},http://localhost:*" ollama serve`
    els.keyStatus.innerHTML = `Cannot reach Ollama at <code>${escapeHtml(host)}</code>. Likely either not running, or CORS is blocking this origin. Restart Ollama with:<br><code>${escapeHtml(cmd)}</code>`
    els.keyStatus.className = 'pcb-keystatus pcb-keystatus--err'
  }
}

function loadProviderState() {
  try {
    state.provider = localStorage.getItem(PROVIDER_LS) || 'gemini'
    if (!PROVIDERS[state.provider]) state.provider = 'gemini'
    state.apiKey = getKey(state.provider)
    state.model  = localStorage.getItem(modelLsFor(state.provider)) || PROVIDERS[state.provider].defaultModel
    state.ollamaHost = localStorage.getItem(OLLAMA_HOST_LS) || 'http://localhost:11434'
  } catch {}
  // Reflect the radio
  for (const r of els.provRadios) r.checked = (r.value === state.provider)
  // Reflect the session-only checkbox
  const sessOpt = document.getElementById('opt-session-only')
  if (sessOpt) sessOpt.checked = (() => { try { return localStorage.getItem(SESSION_ONLY_LS) === '1' } catch { return false } })()
  applyProviderUI()
}

for (const r of els.provRadios) {
  r.addEventListener('change', () => {
    if (!r.checked) return
    state.provider = r.value
    try { localStorage.setItem(PROVIDER_LS, state.provider) } catch {}
    // Reload per-provider key + model from storage
    state.apiKey = getKey(state.provider)
    state.model  = localStorage.getItem(modelLsFor(state.provider)) || PROVIDERS[state.provider].defaultModel
    applyProviderUI()
  })
}

els.saveKey.addEventListener('click', () => {
  const v = els.apiKey.value.trim()
  const p = PROVIDERS[state.provider]
  state.model = els.modelSel.value
  try {
    if (p.needsKey) {
      state.apiKey = v
      setKey(state.provider, v)
    } else {
      state.ollamaHost = v || 'http://localhost:11434'
      localStorage.setItem(OLLAMA_HOST_LS, state.ollamaHost)
    }
    localStorage.setItem(modelLsFor(state.provider), state.model)
  } catch {}
  applyProviderUI()
})

els.clearKey.addEventListener('click', () => {
  const p = PROVIDERS[state.provider]
  if (p.needsKey) {
    state.apiKey = ''
    setKey(state.provider, '')
  } else {
    state.ollamaHost = 'http://localhost:11434'
    try { localStorage.removeItem(OLLAMA_HOST_LS) } catch {}
  }
  applyProviderUI()
})

els.modelSel.addEventListener('change', () => {
  state.model = els.modelSel.value
  try { localStorage.setItem(modelLsFor(state.provider), state.model) } catch {}
  updateCostPreview()
})

loadProviderState()
// Reflect provider/model in the header label, and open Settings on first
// run if no key is saved for any cloud provider.
queueMicrotask(() => {
  updateModelLabel()
  try {
    const anyKey = ['anthropic', 'gemini'].some(p => !!getKey(p))
    if (!anyKey && state.provider !== 'ollama') openModal()
  } catch {}
})

// Session-only toggle: when enabled, keys move to sessionStorage and are
// gone when the tab closes. When disabled, keys move back to localStorage.
const sessionOpt = document.getElementById('opt-session-only')
sessionOpt?.addEventListener('change', () => {
  const want = sessionOpt.checked
  // Capture current keys, flip the flag, write keys back through the new
  // backend (so we don't lose data when switching modes).
  const snap = {}
  for (const p of Object.keys(PROVIDERS)) snap[p] = getKey(p)
  try { localStorage.setItem(SESSION_ONLY_LS, want ? '1' : '0') } catch {}
  for (const [p, v] of Object.entries(snap)) setKey(p, v)
  state.apiKey = getKey(state.provider)
  applyProviderUI()
  const msg = want
    ? 'Keys moved to sessionStorage — they will be cleared when you close this tab.'
    : 'Keys moved back to localStorage — persist across tabs/sessions.'
  if (els.keyStatus) {
    els.keyStatus.textContent = msg
    els.keyStatus.className = 'pcb-keystatus pcb-keystatus--ok'
  }
})

// "Clear all stored keys" — wipes every eol-pcb-* entry, useful as a
// concrete demonstration that the only place keys exist is this browser.
const clearAllBtn = document.getElementById('clear-all-keys')
if (clearAllBtn) {
  clearAllBtn.addEventListener('click', () => {
    try {
      let total = 0
      for (const store of [localStorage, sessionStorage]) {
        const toRemove = []
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i)
          if (k && k.startsWith('eol-pcb-')) toRemove.push(k)
        }
        toRemove.forEach(k => store.removeItem(k))
        total += toRemove.length
      }
      state.apiKey = ''
      state.ollamaHost = 'http://localhost:11434'
      applyProviderUI()
      els.keyStatus.textContent = `Cleared ${total} stored item${total === 1 ? '' : 's'} from both localStorage and sessionStorage. Nothing left for this site.`
      els.keyStatus.className = 'pcb-keystatus pcb-keystatus--ok'
    } catch (e) {
      els.keyStatus.textContent = 'Failed to clear: ' + (e.message || e)
      els.keyStatus.className = 'pcb-keystatus pcb-keystatus--err'
    }
  })
}

// ── Image upload (file picker, drag-drop, paste) ─────────────────────
els.drop.addEventListener('click', () => els.file.click())
els.file.addEventListener('change', e => {
  const files = [...(e.target.files || [])]
  if (files.length) handleMultipleFiles(files)
})
els.drop.addEventListener('dragover', e => { e.preventDefault(); els.drop.classList.add('pcb-drop--hover') })
els.drop.addEventListener('dragleave', () => els.drop.classList.remove('pcb-drop--hover'))
els.drop.addEventListener('drop', e => {
  e.preventDefault()
  els.drop.classList.remove('pcb-drop--hover')
  const files = [...(e.dataTransfer.files || [])]
  if (files.length) handleMultipleFiles(files)
})

async function handleMultipleFiles(files) {
  // First file becomes the primary image; the rest are stashed as extra
  // context images to be sent alongside in the main analyze call.
  state.extraImages = []
  await handleFile(files[0])
  for (let i = 1; i < files.length; i++) {
    const f = files[i]
    if (!f.type.startsWith('image/')) continue
    const r = await resizeImage(f, 1568)
    state.extraImages.push({ dataUrl: r.dataUrl, mime: r.mime, label: f.name, w: r.w, h: r.h })
  }
  renderMultiStrip()
}

function renderMultiStrip() {
  const strip = document.getElementById('multi-image-strip')
  if (!strip) return
  if (!state.imageDataUrl && !state.extraImages.length) {
    strip.style.display = 'none'; strip.innerHTML = ''; return
  }
  const primary = state.imageDataUrl
    ? `<div class="pcb-multi-item pcb-multi-primary" title="Primary image (analysis runs on this)">
         <img src="${primary_thumb_or_dataurl(state.imageDataUrl)}" alt="">
         <span class="pcb-multi-label">primary</span>
       </div>` : ''
  const extras = state.extraImages.map((e, i) => `
    <div class="pcb-multi-item" data-idx="${i}" title="${escapeHtml(e.label)} (context image)">
      <img src="${e.dataUrl}" alt="">
      <span class="pcb-multi-label">${escapeHtml(e.label)}</span>
      <button class="pcb-multi-remove" data-idx="${i}" title="Remove">×</button>
    </div>`).join('')
  strip.innerHTML = primary + extras
  strip.style.display = ''
  strip.querySelectorAll('.pcb-multi-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const i = parseInt(btn.dataset.idx, 10)
      state.extraImages.splice(i, 1)
      renderMultiStrip()
    })
  })
}
function primary_thumb_or_dataurl(u) {
  // We'd ideally generate a small thumb; for simplicity just reuse the original.
  return u
}
window.addEventListener('paste', e => {
  const items = e.clipboardData && e.clipboardData.items
  if (!items) return
  for (const it of items) {
    if (it.type.startsWith('image/')) {
      const f = it.getAsFile()
      if (f) { handleFile(f); break }
    }
  }
})

async function handleFile(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name)
  if (!file.type.startsWith('image/') && !isPdf) {
    setStatus('error', `Unsupported file type: ${file.type || 'unknown'}. Use an image or PDF.`)
    return
  }
  // Reset prior PDF state
  state.pdfDoc = null
  state.pdfPage = 1
  state.pdfPageCount = 0
  els.pdfPages.style.display = 'none'

  setStatus('info', `Loading ${file.name} (${(file.size / 1024).toFixed(0)} KB)…`)
  let dataUrl, mime, w, h
  if (isPdf) {
    try {
      const rendered = await loadAndRenderPdf(file, 1)
      dataUrl = rendered.dataUrl; mime = rendered.mime; w = rendered.w; h = rendered.h
    } catch (e) {
      setStatus('error', 'PDF render failed: ' + (e.message || e))
      return
    }
  } else {
    const r = await resizeImage(file, 1568)
    dataUrl = r.dataUrl; mime = r.mime; w = r.w; h = r.h
  }
  state.imageDataUrl = dataUrl
  state.imageMime = mime
  state.imgNatural = { w, h }
  els.image.src = dataUrl
  els.resultSec.style.display = ''
  state.detections = []
  state.view = { x: 0, y: 0, scale: 1 }   // fresh view per image
  applyView()
  renderPanel()
  await new Promise(r => { els.image.onload = r })
  // Wait one extra frame so CSS layout settles before we measure.
  await new Promise(r => requestAnimationFrame(r))
  fitCanvas()
  drawOverlay()
  const suffix = isPdf && state.pdfPageCount > 1
    ? ` (PDF page ${state.pdfPage} of ${state.pdfPageCount})`
    : isPdf ? ' (PDF)' : ''
  setStatus('ok', `Loaded ${w}×${h}${suffix}. Click "Analyze image" to run detection.`)
  updateCostPreview()
  updateFileLabel(file.name, w, h)
  shell.imagePane?.classList.add('has-image')
  refreshAnalyzeEnabled()
  // Reset size slider to fit
  if (sizeSlider) { sizeSlider.value = 100; if (sizeLabel) sizeLabel.textContent = '100%' }
  els.image.style.width = ''
  els.image.style.height = ''
}

function updateCostPreview() {
  const est = estimateUpcomingCost()
  if (!est) { els.analyze.textContent = 'Analyze image'; return }
  if (state.provider === 'ollama') {
    els.analyze.textContent = 'Analyze image (local · free)'
  } else if (est.cost != null) {
    els.analyze.textContent = `Analyze image (~$${est.cost.toFixed(4)}, ~${est.tokensIn} tokens in)`
  } else {
    els.analyze.textContent = 'Analyze image'
  }
}

// ── PDF support ──────────────────────────────────────────────────────
let pdfjsLib = null
async function ensurePdfJs() {
  if (pdfjsLib) return pdfjsLib
  const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs')
  mod.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs'
  pdfjsLib = mod
  return mod
}

async function loadAndRenderPdf(file, pageNum) {
  const lib = await ensurePdfJs()
  const buf = await file.arrayBuffer()
  const doc = await lib.getDocument({ data: buf }).promise
  state.pdfDoc = doc
  state.pdfPageCount = doc.numPages
  return renderPdfPage(pageNum)
}

async function renderPdfPage(pageNum) {
  const doc = state.pdfDoc
  if (!doc) throw new Error('No PDF loaded')
  const n = Math.max(1, Math.min(doc.numPages, pageNum))
  state.pdfPage = n
  const page = await doc.getPage(n)
  // Target ~1568px on the long edge for parity with image path.
  const baseVp = page.getViewport({ scale: 1 })
  const longEdge = Math.max(baseVp.width, baseVp.height)
  const scale = Math.min(3, 1568 / longEdge)  // cap 3x to avoid huge memory
  const vp = page.getViewport({ scale })
  const c = document.createElement('canvas')
  c.width = Math.round(vp.width)
  c.height = Math.round(vp.height)
  const ctx = c.getContext('2d')
  // White background — many PDF schematics use transparent backgrounds.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  await page.render({ canvasContext: ctx, viewport: vp }).promise
  let mime = 'image/png'
  let dataUrl = c.toDataURL(mime)
  if (dataUrl.length > 4_500_000) {
    mime = 'image/jpeg'
    dataUrl = c.toDataURL(mime, 0.9)
  }
  // Update page picker UI
  if (doc.numPages > 1) {
    els.pdfPages.style.display = ''
    els.pdfPageNum.textContent = `${n} / ${doc.numPages}`
    els.pdfPrev.disabled = n <= 1
    els.pdfNext.disabled = n >= doc.numPages
  } else {
    els.pdfPages.style.display = 'none'
  }
  return { dataUrl, mime, w: c.width, h: c.height }
}

async function switchPdfPage(delta) {
  if (!state.pdfDoc) return
  const next = state.pdfPage + delta
  if (next < 1 || next > state.pdfPageCount) return
  setStatus('info', `Rendering page ${next}…`)
  try {
    const { dataUrl, mime, w, h } = await renderPdfPage(next)
    state.imageDataUrl = dataUrl
    state.imageMime = mime
    state.imgNatural = { w, h }
    els.image.src = dataUrl
    state.detections = []
    renderPanel()
    await new Promise(r => { els.image.onload = r })
    fitCanvas()
    drawOverlay()
    setStatus('ok', `Loaded page ${next}/${state.pdfPageCount} (${w}×${h}). Click "Analyze image" to run detection on this page.`)
  } catch (e) {
    setStatus('error', 'Render failed: ' + (e.message || e))
  }
}
els.pdfPrev.addEventListener('click', () => switchPdfPage(-1))
els.pdfNext.addEventListener('click', () => switchPdfPage(+1))

function resizeImage(file, maxEdge) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const reader = new FileReader()
    reader.onload = () => { img.src = reader.result }
    reader.onerror = reject
    img.onload = () => {
      const longest = Math.max(img.width, img.height)
      const scale = longest > maxEdge ? maxEdge / longest : 1
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const c = document.createElement('canvas')
      c.width = w; c.height = h
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      // PNG keeps text sharper; cap with JPEG if huge.
      let mime = 'image/png'
      let dataUrl = c.toDataURL(mime)
      if (dataUrl.length > 4_500_000) {
        mime = 'image/jpeg'
        dataUrl = c.toDataURL(mime, 0.88)
      }
      resolve({ dataUrl, mime, w, h })
    }
    img.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Confidence filter ────────────────────────────────────────────────
function confThreshold() {
  const v = parseInt(els.optConf.value, 10)
  return isNaN(v) ? 0 : v / 100
}
function visibleDetections() {
  const t = confThreshold()
  return state.detections.filter(d => (d.confidence == null ? 1 : d.confidence) >= t)
}
els.optConf.addEventListener('input', () => {
  els.optConfVal.textContent = els.optConf.value + '%'
  if (state.detections.length) { drawOverlay(); renderPanel() }
})

// ── Canvas overlay ───────────────────────────────────────────────────
function fitCanvas() {
  // Critical: use offsetWidth/offsetHeight (layout box, NOT transformed)
  // rather than getBoundingClientRect (which INCLUDES the container's CSS
  // transform). Otherwise canvas size grows by scale-factor while sitting
  // inside the same transformed container → markings drift off-image.
  const w = els.image.offsetWidth || els.image.naturalWidth
  const h = els.image.offsetHeight || els.image.naturalHeight
  if (!w || !h) return
  els.canvas.width = w
  els.canvas.height = h
  els.canvas.style.width = w + 'px'
  els.canvas.style.height = h + 'px'
}
window.addEventListener('resize', () => { if (state.imageDataUrl) { fitCanvas(); drawOverlay() } })

// RGB tuples so rgba() composes cleanly. Avoid CSS hex+alpha — Canvas
// silently keeps the previous fillStyle on invalid strings.
const PALETTES = {
  default: [
    [221,  51,  51], [ 10, 168, 136], [ 51, 102, 204], [255, 102,   0],
    [102,  51, 153], [196,  68, 102], [  0, 136, 170], [136,  68, 102],
    [179,  36,  36], [ 20, 134, 109],
  ],
  // Wong palette — 8-colour set designed to be distinguishable for the
  // common forms of colour-vision deficiency.
  cb: [
    [  0, 114, 178], [213,  94,   0], [  0, 158, 115], [204, 121, 167],
    [ 86, 180, 233], [240, 228,  66], [230, 159,   0], [  0,   0,   0],
  ],
}
const palette = () => PALETTES[state.palette] || PALETTES.default
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`

let drawOverlay = function (hoverId = null) {
  const c = els.canvas
  const ctx = c.getContext('2d')
  ctx.clearRect(0, 0, c.width, c.height)
  const W = c.width, H = c.height
  ctx.font = '600 12px -apple-system,Segoe UI,sans-serif'

  const vis = visibleDetections()
  // If the model's bboxes are clearly garbage, don't draw them — overlay a
  // clear explanation so the user understands the side-panel cards aren't
  // tied to any real region.
  if (vis.length >= 2 && bboxesAreBogus(vis)) {
    const msg = 'Model returned invalid bounding boxes — see warning in the side panel. The cards on the right are still shown but cannot be located on the image.'
    const padX = 14, padY = 12
    const maxW = Math.min(W - 20, 520)
    ctx.font = '600 13px -apple-system,Segoe UI,sans-serif'
    // Word-wrap
    const words = msg.split(' ')
    const lines = []
    let line = ''
    for (const w of words) {
      const test = line ? line + ' ' + w : w
      if (ctx.measureText(test).width + padX * 2 > maxW) { lines.push(line); line = w }
      else line = test
    }
    if (line) lines.push(line)
    const lh = 18
    const boxH = lines.length * lh + padY * 2
    const boxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + padX * 2
    const x = (W - boxW) / 2
    const y = (H - boxH) / 2
    ctx.fillStyle = 'rgba(198, 40, 40, 0.92)'
    ctx.fillRect(x, y, boxW, boxH)
    ctx.fillStyle = '#fff'
    lines.forEach((l, i) => ctx.fillText(l, x + padX, y + padY + lh * (i + 1) - 4))
    return
  }

  vis.forEach((d, i) => {
    const pal = palette()
    const rgb = pal[i % pal.length]
    const hovered = hoverId === d.id
    const [x1, y1, x2, y2] = d.bbox
    const x = x1 * W, y = y1 * H, w = (x2 - x1) * W, h = (y2 - y1) * H

    // Only tint on hover (~10% alpha). Default = stroke-only so the chip stays visible.
    if (hovered) {
      ctx.fillStyle = rgba(rgb, 0.18)
      ctx.fillRect(x, y, w, h)
    }
    ctx.strokeStyle = rgba(rgb, hovered ? 1 : 0.9)
    ctx.lineWidth = hovered ? 3 : 1.5
    ctx.strokeRect(x, y, w, h)

    // Small number badge in the top-left corner of the box. Clamp so it
    // never exceeds 1/3 of the box, otherwise tiny detections get covered.
    const num = String(i + 1)
    const baseW = Math.max(18, ctx.measureText(num).width + 8)
    const baseH = 16
    const nw = Math.min(baseW, Math.max(10, w / 3))
    const nh = Math.min(baseH, Math.max(10, h / 3))
    ctx.fillStyle = rgba(rgb, 1)
    ctx.fillRect(x, y, nw, nh)
    if (nw >= 14 && nh >= 12) {
      ctx.fillStyle = '#fff'
      ctx.fillText(num, x + (nw - ctx.measureText(num).width) / 2, y + nh - 3)
    }

    // Full label only on hover, placed outside the box so it never covers
    // the part. Fall back to inside if outside would clip.
    if (hovered) {
      const label = d.label || d.part_number || 'unknown'
      const lw = ctx.measureText(label).width + 10
      const lh = 18
      const ly = y - lh - 2 < 0 ? (y + h + 2) : (y - lh - 2)
      const lx = Math.min(x, W - lw - 2)
      ctx.fillStyle = rgba(rgb, 0.95)
      ctx.fillRect(lx, ly, lw, lh)
      ctx.fillStyle = '#fff'
      ctx.fillText(label, lx + 5, ly + 13)
    }
  })
}

els.canvas.addEventListener('mousemove', e => {
  if (!state.detections.length) return
  const rect = els.canvas.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  const hit = visibleDetections().find(d => {
    const [x1, y1, x2, y2] = d.bbox
    return x >= x1 && x <= x2 && y >= y1 && y <= y2
  })
  drawOverlay(hit ? hit.id : null)
  els.canvas.style.cursor = hit ? 'pointer' : 'default'
})

els.canvas.addEventListener('click', e => {
  const rect = els.canvas.getBoundingClientRect()
  const x = (e.clientX - rect.left) / rect.width
  const y = (e.clientY - rect.top) / rect.height
  const hit = visibleDetections().find(d => {
    const [x1, y1, x2, y2] = d.bbox
    return x >= x1 && x <= x2 && y >= y1 && y <= y2
  })
  if (hit) {
    const card = document.getElementById('det-' + hit.id)
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' })
    highlightCard(hit.id)
  }
})

function highlightCard(id) {
  document.querySelectorAll('.det-row-card').forEach(el => el.classList.remove('det-row-card--active'))
  const card = document.getElementById('det-' + id)
  if (card) card.classList.add('det-row-card--active')
}

// ── Reset / status ───────────────────────────────────────────────────
els.reset.addEventListener('click', () => {
  state.imageDataUrl = null
  state.detections = []
  els.image.src = ''
  els.resultSec.style.display = 'none'
  els.controls.style.display = 'none'
  els.panel.innerHTML = '<div class="pcb-panel-empty">Detections will appear here once analysis completes.</div>'
  setStatus('info', 'Idle.')
})

function setStatus(kind, msg) {
  els.status.textContent = msg
  els.status.className = 'pcb-canvas-status pcb-canvas-status--' + kind
}

// ── Analysis call ────────────────────────────────────────────────────
els.analyze.addEventListener('click', analyze)

async function analyze() {
  const p = PROVIDERS[state.provider]
  if (p.needsKey && !state.apiKey) {
    setStatus('error', `No ${p.label} key. Paste one in step 1 and click Save.`)
    return
  }
  if (!state.imageDataUrl) {
    setStatus('error', 'No image loaded.')
    return
  }
  els.analyze.disabled = true

  // OCR pre-pass (optional)
  const wantOcr = document.getElementById('opt-ocr')?.checked
  if (wantOcr) {
    setStatus('info', `OCR pre-pass: extracting silkscreen text…`)
    state.ocrHint = await runOcrPrepass().catch(e => { console.warn('OCR pre-pass failed', e); return null })
    if (state.ocrHint) setStatus('info', `OCR pre-pass returned ${state.ocrHint.split('\n').length} strings. Running main analysis…`)
  } else {
    state.ocrHint = null
  }

  setStatus('info', `Calling ${p.label} (${state.model})… vision analysis usually takes 10–40s.`)
  const startedAt = Date.now()
  try {
    let result
    if (state.provider === 'anthropic')   result = await callAnthropic()
    else if (state.provider === 'gemini') result = await callGemini()
    else                                  result = await callOllama()
    // Each callX returns either an array (legacy) or {detections, usage}.
    const detections = Array.isArray(result) ? result : result.detections
    const usage = Array.isArray(result) ? null : result.usage
    state.detections = detections.map((d, i) => ({ ...d, id: i + 1 }))
    state.lastRun = {
      provider: state.provider,
      providerLabel: p.label,
      model: state.model,
      when: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      tokensIn: usage?.input_tokens ?? null,
      tokensOut: usage?.output_tokens ?? null,
      cost: usage?.estimated_cost ?? null,
    }
    saveToHistory()
    fitCanvas()
    drawOverlay()
    await renderPanel()
    showToolbar()
    setStatus('ok', `Done. ${state.detections.length} detection${state.detections.length === 1 ? '' : 's'} in ${((state.lastRun.durationMs)/1000).toFixed(1)}s${state.lastRun.cost ? ` · est. $${state.lastRun.cost.toFixed(4)}` : ''}.`)
  } catch (err) {
    console.error(err)
    setStatus('error', 'Failed: ' + (err.message || err))
  } finally {
    els.analyze.disabled = false
  }
}

function buildPrompt() {
  if (state._oneShotPrompt) return state._oneShotPrompt
  const wantPins = els.optPins.checked
  const wantAtk = els.optAttacks.checked
  const isSchem = els.optSchem.checked
  const target = isSchem
    ? 'a schematic diagram (symbols, nets, reference designators)'
    : 'a top-down photo of a populated printed circuit board'

  const extraNote = (state.extraImages && state.extraImages.length)
    ? `\nNOTE: You have been given ${state.extraImages.length + 1} images of the same board (the first is the primary view, the rest are additional angles or close-ups labelled ${state.extraImages.map(e => `"${e.label}"`).join(', ')}). Use all of them together — a marking might be readable in only one view. All bboxes you return must be in coordinates of the PRIMARY (first) image.\n`
    : ''

  const ocrHintNote = state.ocrHint
    ? `\nHINT — OCR pre-pass extracted the following visible text strings from the primary image. Use these as ground-truth markings rather than guessing:\n${state.ocrHint}\n`
    : ''

  return `You are a hardware security analyst examining ${target}.${extraNote}${ocrHintNote}

Your job is to identify ONLY physical objects you can clearly SEE in the image:
- Integrated circuits (ICs) with a visible package outline
- Pin headers and connector blocks with visible pins
- Major connectors (USB, HDMI, Ethernet, etc.)
- Crystals / oscillator cans
- Visible debug pads or labelled test-point arrays (only if you can actually see and read the labels)

DEBUG INTERFACES are a priority — these are how someone gains access to a board. When you spot a header or test-point cluster, use the following heuristics to guess what it is (and say so in "notes"):
- 4 pins near the main MCU, often labelled TX/RX/GND/3V3 → likely UART console
- 10-pin (2×5) header → classic ARM JTAG (0.1" pitch) or Cortex-M JTAG (0.05" pitch)
- 5-pin or 4-pin row labelled SWDIO/SWCLK/RST/GND → ARM Serial-Wire Debug (SWD)
- 6-pin in-line near an AVR chip → ISP/ICSP programming header
- Tiny 6-pad footprint without a connector → TagConnect / pogo-pin test point
- Unpopulated through-holes adjacent to an SoC → most likely a debug header the manufacturer left off in production. Note "unpopulated" in notes.
- Castellated edge fingers with TX/RX labelling → debug serial brought out for production
- Single-row 8–14 pin header next to flash / boot SoC → often a vendor-specific JTAG / EJTAG (MIPS) / cJTAG

I²C BUS clues — I²C usually has no dedicated header (devices share a single bus), so look for:
- Two adjacent pads/pins silkscreened SDA + SCL (sometimes labelled "I2C" on a 4-pin breakout: SDA/SCL/VCC/GND)
- An EEPROM such as 24Cxx / AT24Cxxx / 24LCxxx (8-pin SOIC near the MCU) → strongly implies an I²C bus the MCU can read
- An RTC chip (DS1307 / DS3231 / PCF8523) → I²C
- I²C sensors with visible markings (BMP280, BME280, SHT3x, MPU-6050, LIS3DH, BNO0xx, INA219) → I²C
- I²C OLED / EEPROM display modules — small daughter-cards with 4 pins and a visible SSD1306 chip
- Pull-up resistor pair (typically 4.7 kΩ — two identical resistors close together) tied to two specific traces is a classic I²C bus fingerprint
- When you spot any of these, add one "I²C bus" detection (category: "interface") and list which chips appear to share it in notes. Mark confidence honestly — finding chips that USE I²C does not prove they're on a single bus.

SPI BUS clues — distinct from the SPI flash chip itself:
- Silkscreen MOSI / MISO / SCK (or SCLK) / CSn / SS on a header or test-point block → SPI breakout
- Multiple SPI peripherals visible (e.g. SPI flash + SPI display + SPI ADC) usually share a single bus (MOSI/MISO/SCK common; each gets its own CS line). Note this in the SPI flash detection's notes.
- 4-wire (CLK/MOSI/MISO/CSn) cluster near an FPGA / SoC → often the configuration SPI used at boot

Note: you are reading a STATIC IMAGE. You cannot trace electrical continuity. Do NOT claim "this header connects to pin X of the MCU" or "these chips share a bus" unless the silkscreen literally labels it, or the traces are obviously short and visible in this image. Use words like "likely", "appears to be", "consistent with" — never assert connectivity you cannot see.

DO NOT invent items. In particular:
- Do NOT emit one detection per net or per signal name. "SWDIO", "SWCLK", "3V3", "GND" are signal names, not objects. They belong inside the "pins" field of the corresponding header, never as their own detection.
- Do NOT emit "clip" or "probe" entries — those are tools, not parts.
- Do NOT default manufacturer to "STMicroelectronics" or any single vendor. Leave manufacturer empty if the chip's marking is unreadable.
- Do NOT list a pin name unless that pin is plausibly accessible on a visible header/test-point in THIS photo. If you can't see the header clearly, set "pins": [].

Output exactly one JSON object: {"detections": [ ... ]}. Each detection has:
- "label": short display name (e.g. "ESP32-WROOM", "SPI flash", "USB-C", "UART header")
- "part_number": exact marking read from silkscreen/package, or "" if unreadable
- "manufacturer": vendor name only if confidently identifiable from the marking or logo, else ""
- "category": one of "mcu","soc","flash","eeprom","ram","power","radio","sensor","interface","passive","connector","header","crystal","unknown"
- "confidence": float 0.0–1.0. Be honest — if you can barely see it, use <0.5.
- "bbox": [x1, y1, x2, y2] normalized 0.0–1.0, origin top-left, x2>x1, y2>y1
- "notes": one short sentence on this part's role in the board
${wantPins ? '- "pins": array of pin/signal names visible on THIS physical part. Only include pins you can map to specific accessible pads. For chips inside a BGA/QFN package whose pads aren\'t accessible, return [].' : ''}
${wantAtk ? '- "attack_vectors": 0–4 SPECIFIC hardware-security notes for this part (e.g. "in-circuit SPI flash dump via SOIC-8 clip", "UART boot console at 115200 8N1 if header is populated"). Do not list generic advice. Empty array if nothing specific applies.' : ''}

Hard limits:
1. Return ONLY the JSON object. No prose, no markdown fences.
2. At most 12 detections total. Quality over quantity.
3. Skip passives (resistors, capacitors, LEDs) and trivially-small SMT parts unless they are a deliberate test point.
4. Order: main SoC/MCU first, then memory, then radios, then power, then connectors/headers, then crystals.
5. If you genuinely cannot identify anything beyond "there is a green PCB", return {"detections": []}.

ANTI-PATTERNS — these mean you are lazy-filling the schema. Do NOT do them:
- Generic "notes" like "Main SoC/MCU on printed circuit board" or "Small SMT part on printed circuit board". Notes must describe THIS specific part's role with at least one detail you can see (silkscreen text, package shape, position).
- The same "notes" string repeated across multiple detections. Each note must be unique.
- All detections clustered at the same bbox (e.g. several at [0,0,0.1,0.1]). Bboxes must actually enclose the specific part on the image — different parts → different boxes.
- Inventing a part that the image doesn't actually show. If you can't see an ESP32 or a USB-C, don't list one.
- Listing only "VCC" and "GND" as pins. If those are the only pins you can name, omit "pins" entirely — they are not informative.
- Returning identical detection lists for clearly different images (you don't have memory across calls, but if your output looks like it could fit ANY board, you are bluffing — try harder or return fewer items).

If you cannot actually identify a part from THIS specific image, return fewer detections or an empty list. An empty list is BETTER than fabricated entries.`
}

function imageB64() { return state.imageDataUrl.split(',')[1] }

// OCR pre-pass: ask the model for *just* the visible text strings on the
// board. Cheap (small token output), reduces hallucinated part numbers in
// the main detection pass when its result is fed back as a hint.
async function runOcrPrepass() {
  const prompt = `List every text string you can clearly read on this PCB image, one per line. Include silkscreen labels (R1, U2, TP3, J4), chip markings (ESP32-WROOM-32, W25Q128JV), date codes, vendor names, anything legible. Do NOT guess. If a string is unreadable, skip it. Return ONLY the list — no prose, no JSON, no markdown.`
  const b64 = imageB64()
  if (state.provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': state.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: state.model, max_tokens: 1024,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: state.imageMime, data: b64 } },
          { type: 'text', text: prompt },
        ]}],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim() || null
  }
  if (state.provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.model)}:generateContent?key=${encodeURIComponent(state.apiKey)}`
    const res = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: state.imageMime, data: b64 } },
          { text: prompt },
        ]}],
        generationConfig: { max_output_tokens: 1024, temperature: 0 },
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const cand = (data.candidates || [])[0]
    return ((cand && cand.content && cand.content.parts) || []).map(p => p.text || '').join('\n').trim() || null
  }
  if (state.provider === 'ollama') {
    const host = (state.ollamaHost || 'http://localhost:11434').replace(/\/+$/, '')
    const res = await fetch(host + '/api/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: state.model, prompt, images: [b64], stream: false, options: { temperature: 0 } }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.response || '').trim() || null
  }
  return null
}

// Rough cost preview: estimate input tokens from image dimensions (Anthropic
// docs: image tokens ≈ width * height / 750). Output tokens are unknown
// before the call — we use 1200 as a conservative typical for our JSON.
function estimateUpcomingCost() {
  if (state.provider === 'ollama') return { tokensIn: '?', cost: 0 }
  const w = state.imgNatural?.w, h = state.imgNatural?.h
  if (!w || !h) return null
  const baseIn = Math.round((w * h) / 750) + 1500 // image + prompt overhead
  const extraIn = (state.extraImages || []).reduce((s, e) => s + Math.round((e.w * e.h) / 750), 0)
  const tokensIn = baseIn + extraIn
  const tokensOut = 1200
  const cost = estimateCost(state.model, tokensIn, tokensOut)
  return { tokensIn, tokensOut, cost }
}

// Rough per-million-token USD pricing for the models we expose. Used only
// to surface a "this run cost ~$X" estimate — providers' invoices remain
// authoritative.
const PRICING = {
  'claude-opus-4-7':           { in: 15.00, out: 75.00 },
  'claude-sonnet-4-6':         { in:  3.00, out: 15.00 },
  'claude-haiku-4-5-20251001': { in:  1.00, out:  5.00 },
  'gemini-2.5-pro':            { in:  1.25, out: 10.00 },
  'gemini-2.5-flash':          { in:  0.30, out:  2.50 },
  'gemini-2.0-flash':          { in:  0.10, out:  0.40 },
}
function estimateCost(model, tokensIn, tokensOut) {
  const p = PRICING[model]
  if (!p || tokensIn == null) return null
  return ((tokensIn * p.in) + ((tokensOut || 0) * p.out)) / 1e6
}

function parseDetections(text) {
  const json = extractJson(text)
  if (!json || !Array.isArray(json.detections)) {
    throw new Error('Model did not return parseable JSON. Got: ' + text.slice(0, 200))
  }
  state.rawModelText = text   // keep last raw text for the "show raw" toggle
  return json.detections.filter(d => Array.isArray(d.bbox) && d.bbox.length === 4)
}

// Decide whether the bboxes are too broken to draw at all.
// (Stacked at one corner, or all overlapping each other.)
function bboxesAreBogus(dets) {
  if (dets.length < 2) return false
  // All clustered at top-left?
  const topLefty = dets.filter(d => d.bbox[0] < 0.1 && d.bbox[1] < 0.1).length
  if (topLefty === dets.length) return true
  // Most pairs overlap heavily?
  let overlapPairs = 0
  const totalPairs = (dets.length * (dets.length - 1)) / 2
  for (let i = 0; i < dets.length; i++) {
    for (let j = i + 1; j < dets.length; j++) {
      if (iou(dets[i].bbox, dets[j].bbox) > 0.6) overlapPairs++
    }
  }
  return totalPairs > 0 && overlapPairs / totalPairs > 0.5
}

// Heuristic: does the model output look templated / lazy?
// Each flag returns { msg, why } so the UI can show a hover tooltip
// explaining the threshold that triggered it.
function assessQuality(dets) {
  const flags = []
  if (dets.length < 2) return flags
  // Duplicate notes
  const noteCounts = {}
  for (const d of dets) {
    const n = (d.notes || '').trim().toLowerCase()
    if (!n) continue
    noteCounts[n] = (noteCounts[n] || 0) + 1
  }
  const maxDup = Math.max(0, ...Object.values(noteCounts))
  if (maxDup >= 2) flags.push({
    msg: `${maxDup} detections share the same "notes" text — model is recycling boilerplate.`,
    why: 'Threshold: any "notes" string appears in ≥2 detections. A genuine analysis would write a different sentence per part.',
  })
  // Overlapping bboxes — area of intersection over union
  let overlapPairs = 0
  for (let i = 0; i < dets.length; i++) {
    for (let j = i + 1; j < dets.length; j++) {
      if (iou(dets[i].bbox, dets[j].bbox) > 0.6) overlapPairs++
    }
  }
  if (overlapPairs >= 1) flags.push({
    msg: `${overlapPairs} pair${overlapPairs === 1 ? '' : 's'} of detections have nearly-identical bounding boxes — model isn't actually localising.`,
    why: 'Threshold: pairs with IoU (intersection-over-union) > 0.6 are considered the same box. Real detections of distinct parts cannot overlap that much.',
  })
  // All bboxes at top-left
  const topLefty = dets.filter(d => d.bbox[0] < 0.1 && d.bbox[1] < 0.1).length
  if (topLefty >= 3 && topLefty / dets.length > 0.6) flags.push({
    msg: `${topLefty} detections sit at the top-left corner — model returned placeholder coordinates.`,
    why: 'Threshold: ≥3 boxes with x<0.1 AND y<0.1 AND >60% of all boxes. Models that didn\'t actually look often emit [0,0,…] as a default.',
  })
  // Generic notes substrings
  const generic = /(?:small smt part|main soc\/mcu|printed circuit board\.?$|unknown component)/i
  const genericCount = dets.filter(d => generic.test(d.notes || '')).length
  if (genericCount >= 2) flags.push({
    msg: `${genericCount} detections have generic boilerplate notes ("Main SoC/MCU…", "Small SMT part…"). Model isn't reading the image.`,
    why: 'Threshold: ≥2 notes match a regex of canned phrases like "Small SMT part" or "Main SoC/MCU on printed circuit board". These are filler text, not observations.',
  })
  // Pins are only VCC/GND
  const trivialPin = /^(vcc|gnd|3v3|5v|vdd|vss)$/i
  const trivialOnly = dets.filter(d => Array.isArray(d.pins) && d.pins.length > 0 && d.pins.every(p => trivialPin.test(p))).length
  if (trivialOnly >= 3) flags.push({
    msg: `${trivialOnly} detections list only VCC/GND-style pins — model is guessing, not reading the board.`,
    why: 'Threshold: ≥3 detections whose pin list contains only power/ground rails (VCC, GND, 3V3, 5V, VDD, VSS). Real chips have meaningful signal pins.',
  })
  return flags
}

function iou(a, b) {
  const [ax1, ay1, ax2, ay2] = a
  const [bx1, by1, bx2, by2] = b
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1)
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2)
  const iw = Math.max(0, ix2 - ix1), ih = Math.max(0, iy2 - iy1)
  const inter = iw * ih
  const aArea = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1)
  const bArea = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1)
  const union = aArea + bArea - inter
  return union > 0 ? inter / union : 0
}

async function callAnthropic() {
  const extras = (state.extraImages || []).map(e => ({
    type: 'image',
    source: { type: 'base64', media_type: e.mime, data: e.dataUrl.split(',')[1] },
  }))
  const content = [
    { type: 'image', source: { type: 'base64', media_type: state.imageMime, data: imageB64() } },
    ...extras,
    { type: 'text', text: buildPrompt() },
  ]
  const body = { model: state.model, max_tokens: 4096, messages: [{ role: 'user', content }] }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Anthropic HTTP ${res.status} - ${txt.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim()
  const usage = {
    input_tokens:  data.usage?.input_tokens,
    output_tokens: data.usage?.output_tokens,
    estimated_cost: estimateCost(state.model, data.usage?.input_tokens, data.usage?.output_tokens),
  }
  return { detections: parseDetections(text), usage }
}

async function callGemini() {
  const extras = (state.extraImages || []).map(e => ({
    inline_data: { mime_type: e.mime, data: e.dataUrl.split(',')[1] },
  }))
  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: state.imageMime, data: imageB64() } },
        ...extras,
        { text: buildPrompt() },
      ],
    }],
    generationConfig: {
      response_mime_type: 'application/json',
      max_output_tokens: 4096,
      temperature: 0.2,
    },
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(state.model)}:generateContent?key=${encodeURIComponent(state.apiKey)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Gemini HTTP ${res.status} - ${txt.slice(0, 200)}`)
  }
  const data = await res.json()
  const cand = (data.candidates || [])[0]
  const text = ((cand && cand.content && cand.content.parts) || [])
    .map(p => p.text || '').join('\n').trim()
  if (!text) throw new Error('Gemini returned no text. Full response: ' + JSON.stringify(data).slice(0, 200))
  const um = data.usageMetadata || {}
  const usage = {
    input_tokens:  um.promptTokenCount,
    output_tokens: um.candidatesTokenCount,
    estimated_cost: estimateCost(state.model, um.promptTokenCount, um.candidatesTokenCount),
  }
  return { detections: parseDetections(text), usage }
}

async function callOllama() {
  const host = (state.ollamaHost || 'http://localhost:11434').replace(/\/+$/, '')
  const body = {
    model: state.model,
    prompt: buildPrompt(),
    images: [imageB64()],
    stream: false,
    format: 'json',
    options: { temperature: 0.2 },
  }
  let res
  try {
    res = await fetch(host + '/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(`Cannot reach Ollama at ${host}. Is it running with OLLAMA_ORIGINS="*"? (${e.message})`)
  }
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Ollama HTTP ${res.status} - ${txt.slice(0, 200)}`)
  }
  const data = await res.json()
  const text = (data.response || '').trim()
  if (!text) throw new Error('Ollama returned empty response.')
  const usage = {
    input_tokens:  data.prompt_eval_count,
    output_tokens: data.eval_count,
    estimated_cost: 0, // local
  }
  return { detections: parseDetections(text), usage }
}

function extractJson(text) {
  // Strip possible ```json fences just in case.
  let t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  try { return JSON.parse(t) } catch {}
  // Fallback: find first { … last }.
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  if (i >= 0 && j > i) {
    try { return JSON.parse(t.slice(i, j + 1)) } catch {}
  }
  return null
}

// ── Side panel + cross-reference with EOL-CHIP catalog ───────────────
let chipIndex = null    // {key → item} exact map
let chipFuse = null     // Fuse.js fuzzy matcher across all EOL chips

async function loadChipIndex() {
  if (chipIndex) return chipIndex
  try {
    const r = await fetch('./data/search_index.json?v=47')
    if (!r.ok) throw new Error('no index')
    const data = await r.json()
    chipIndex = {}
    const eolItems = []
    for (const item of data) {
      if (item.type !== 'eol') continue
      eolItems.push(item)
      const keys = []
      if (item.part_number) keys.push(item.part_number.toLowerCase())
      if (item.id) keys.push(String(item.id).toLowerCase())
      for (const k of keys) chipIndex[k] = item
    }
    chipFuse = new Fuse(eolItems, {
      keys: [
        { name: 'part_number', weight: 0.5 },
        { name: 'id',          weight: 0.3 },
        { name: 'title',       weight: 0.2 },
      ],
      threshold: 0.35,
      includeScore: true,
      minMatchCharLength: 3,
    })
  } catch {
    chipIndex = {}
  }
  return chipIndex
}

// Trim suffix tokens to get the family root. E.g. ESP32-WROOM-32 → ESP32-WROOM,
// STM32F407VGT6 → STM32F407, W25Q128JV → W25Q128, AT24C02CN → AT24C02.
function familyVariants(part) {
  const p = part.trim()
  const out = new Set([p])
  // Strip trailing -SUFFIX-SUFFIX, then -SUFFIX
  const dashed = p.split('-')
  for (let n = dashed.length - 1; n >= 1; n--) out.add(dashed.slice(0, n).join('-'))
  // Strip trailing alphanumeric grade suffixes (last 1–4 chars after a digit)
  const m = p.match(/^([A-Z]+\d+[A-Z]*\d*)([A-Z0-9]{1,6})$/i)
  if (m) out.add(m[1])
  // Strip everything after the last digit run (handles W25Q128JV → W25Q128)
  const m2 = p.match(/^([A-Z]+\d+)([A-Z]+\d*)?$/i)
  if (m2) out.add(m2[1])
  return [...out].filter(s => s.length >= 3)
}

function lookupChip(part) {
  if (!part) return null
  const idx = chipIndex || {}
  const p = part.toLowerCase().trim()
  // 1. Exact match
  if (idx[p]) return { item: idx[p], match: 'exact', score: 1 }
  // 2. Family-root match (strip suffix tokens)
  for (const v of familyVariants(part)) {
    const lv = v.toLowerCase()
    if (idx[lv]) return { item: idx[lv], match: 'family-root', score: 0.9 }
  }
  // 3. Fuzzy via Fuse.js
  if (chipFuse) {
    const hits = chipFuse.search(part).slice(0, 1)
    if (hits.length && hits[0].score < 0.3) {
      return { item: hits[0].item, match: 'fuzzy', score: 1 - hits[0].score }
    }
  }
  return null
}

async function renderPanel() {
  if (!state.detections.length) {
    els.panel.innerHTML = '<div class="pcb-panel-empty">No detections yet.</div>'
    return
  }
  await loadChipIndex()
  const visible = visibleDetections()
  const hidden  = state.detections.length - visible.length

  const qualityFlags = assessQuality(state.detections)
  const qualityBanner = qualityFlags.length
    ? `<div class="pcb-quality-banner">
         <strong>&#9888; Model output looks low-quality:</strong>
         <ul>${qualityFlags.map(f => `<li title="${escapeHtml(f.why)}">${escapeHtml(f.msg)} <span class="pcb-why">[?]</span></li>`).join('')}</ul>
         <div class="pcb-quality-hint">Try a larger model (Anthropic Opus, Gemini 2.5 Pro, or <code>llama3.2-vision:90b</code>) and/or upload a sharper image. Hover any item above to see exactly which threshold fired.</div>
       </div>`
    : ''

  const rawBlock = state.rawModelText
    ? `<details class="pcb-raw"><summary>Show raw model output</summary><pre>${escapeHtml(state.rawModelText.slice(0, 8000))}</pre></details>`
    : ''

  const banner = hidden > 0
    ? `<div class="pcb-filter-banner">${hidden} low-confidence detection${hidden === 1 ? '' : 's'} hidden (below ${els.optConf.value}%). Drag the slider down to see them.</div>`
    : ''
  if (!visible.length) {
    els.panel.innerHTML = qualityBanner + banner + '<div class="pcb-panel-empty">All detections were below the confidence threshold.</div>' + rawBlock
    return
  }
  const cards = visible.map(d => {
    const pal = palette()
    const color = pal[(d.id - 1) % pal.length]
    const chipMatch = lookupChip(d.part_number)
    const chip = chipMatch ? chipMatch.item : null
    const dsHref = d.part_number
      ? `https://www.alldatasheet.com/search.jsp?Searchword=${encodeURIComponent(d.part_number)}`
      : null
    const eolHref = chip ? `chip.html?id=${encodeURIComponent(chip.part_number || chip.id)}` : null
    const xrefBadges = []
    if (chip) {
      if (chip.kev) xrefBadges.push('<span class="mini-badge mb-kev">KEV</span>')
      if (chip.exploit_count) xrefBadges.push(`<span class="mini-badge mb-edb">EDB×${chip.exploit_count}</span>`)
      if (chip.msf_count) xrefBadges.push(`<span class="mini-badge mb-msf">MSF×${chip.msf_count}</span>`)
      if (chip.ghsa_count) xrefBadges.push(`<span class="mini-badge mb-ghsa">GHSA×${chip.ghsa_count}</span>`)
    }
    const matchLabel = chipMatch
      ? chipMatch.match === 'exact' ? 'exact match'
        : chipMatch.match === 'family-root' ? `family match → ${chip.part_number || chip.id}`
        : `fuzzy match → ${chip.part_number || chip.id} (${(chipMatch.score * 100).toFixed(0)}%)`
      : ''
    const pinsHtml = (d.pins && d.pins.length)
      ? `<div class="det-row"><b>Pins:</b> ${d.pins.map(p => `<code>${escapeHtml(p)}</code>`).join(' ')}</div>` : ''
    const atkHtml = (d.attack_vectors && d.attack_vectors.length)
      ? `<div class="det-row det-row--atk"><b>Attack vectors:</b><ul>${d.attack_vectors.map(a => `<li>${escapeHtml(a)}${attackRefs(d, a)}</li>`).join('')}</ul></div>` : ''
    const relatedRow = relatedResearchRow(d)
    const xref = chip
      ? `<div class="det-xref det-xref--hit">
           <b>Match in EOL-CHIP catalog</b> ${xrefBadges.join(' ')}
           ${matchLabel ? `<span class="det-match-kind">${escapeHtml(matchLabel)}</span>` : ''}
           <div>${escapeHtml(chip.title || '')} ${chip.status ? `&middot; <span class="det-status">${escapeHtml(chip.status)}</span>` : ''}</div>
           <a href="${eolHref}">Open chip article →</a>
         </div>`
      : (d.part_number
        ? `<div class="det-xref">No EOL-CHIP entry for <code>${escapeHtml(d.part_number)}</code> yet. <a href="https://github.com/iotsrg/eol-chip/blob/main/chips.yaml" target="_blank" rel="noopener">Add it →</a></div>`
        : '')
    // Compact summary row + collapsible detail.
    const conf = d.confidence != null ? Math.round(d.confidence * 100) : '?'
    const summaryBadges = xrefBadges.length ? xrefBadges.join(' ') : ''
    return `<div class="det-row-card" id="det-${d.id}">
      <div class="det-row-summary">
        <span class="det-row-num" style="background:${rgba(color, 1)}">${d.id}</span>
        <span class="det-row-label">
          ${escapeHtml(d.label || 'unknown')}
          ${d.part_number ? `<code class="det-row-pn">${escapeHtml(d.part_number)}</code>` : ''}
        </span>
        <span class="det-row-right">
          ${summaryBadges}
          <span class="det-row-conf">${conf}%</span>
        </span>
      </div>
      <div class="det-row-detail" hidden>
        <div class="det-meta">
          ${d.manufacturer ? `${escapeHtml(d.manufacturer)}` : '<span class="det-unknown">manufacturer unknown</span>'}
          ${d.category ? ` &middot; <span class="det-cat">${escapeHtml(d.category)}</span>` : ''}
        </div>
        ${d.notes ? `<div class="det-row">${escapeHtml(d.notes)}</div>` : ''}
        ${pinsHtml}
        ${atkHtml}
        ${relatedRow}
        ${xref}
        <div class="det-links">
          ${dsHref ? `<a href="${dsHref}" target="_blank" rel="noopener">Datasheet ↗</a>` : ''}
        </div>
      </div>
    </div>`
  }).join('')
  els.panel.innerHTML = qualityBanner + banner + cards + rawBlock
  if (shell.detCount) shell.detCount.textContent = visible.length

  els.panel.querySelectorAll('.det-row-card').forEach(card => {
    const id = parseInt(card.id.slice(4), 10)
    const summary = card.querySelector('.det-row-summary')
    const detail  = card.querySelector('.det-row-detail')
    summary?.addEventListener('mouseenter', () => drawOverlay(state.selectedDetectionId || id))
    summary?.addEventListener('mouseleave', () => drawOverlay(state.selectedDetectionId || null))
    summary?.addEventListener('click', () => {
      // Toggle expansion; also mark as selected for keyboard / crop-rerun.
      const wasOpen = !detail.hasAttribute('hidden')
      // Collapse any other open detail (one-at-a-time pattern keeps things tidy)
      els.panel.querySelectorAll('.det-row-detail').forEach(d2 => d2.setAttribute('hidden', ''))
      if (!wasOpen) detail.removeAttribute('hidden')
      selectDetection(id)
    })
  })
}

// Build a small "References" strip under each attack-vector bullet.
// Links search EMB3D, the open web, and Exploit-DB using the part number
// (when known) plus the most informative keywords pulled from the vector text.
function attackRefs(d, vectorText) {
  const part = (d.part_number || d.label || '').trim()
  const kw = vectorKeywords(vectorText)
  const baseQuery = [part, kw].filter(Boolean).join(' ').trim()
  if (!baseQuery) return ''
  const q = encodeURIComponent(baseQuery)
  // EMB3D doesn't have a public search API, so we go via a site-restricted Google.
  const emb3d = `https://www.google.com/search?q=${encodeURIComponent('site:emb3d.mitre.org ' + (kw || part))}`
  const web   = `https://www.google.com/search?q=${q}`
  const edb   = `https://www.exploit-db.com/search?q=${encodeURIComponent(part || kw)}`
  return ` <span class="atk-refs">[<a href="${emb3d}" target="_blank" rel="noopener" title="Search MITRE EMB3D for this threat type">EMB3D</a> &middot; <a href="${web}" target="_blank" rel="noopener" title="Web search for this attack on this part">web</a> &middot; <a href="${edb}" target="_blank" rel="noopener" title="Exploit-DB search">EDB</a>]</span>`
}

// Heuristic: pull the most informative ~3–5 words out of an attack-vector
// sentence so the search query isn't a paragraph.
const STOP = new Set(('a an the and or but if to of in on at for with via try is are be has have can may could might it its this that these those use using used dump dumping access accessing'.split(' ')))
function vectorKeywords(text) {
  if (!text) return ''
  // Strip parens, normalise whitespace
  const cleaned = text.replace(/\([^)]*\)/g, ' ').replace(/[—–-]/g, ' ').replace(/\s+/g, ' ')
  const words = cleaned.split(/[^A-Za-z0-9_.+/-]+/).filter(Boolean)
  const kept = []
  for (const w of words) {
    const lw = w.toLowerCase()
    if (STOP.has(lw)) continue
    if (w.length <= 1) continue
    kept.push(w)
    if (kept.length >= 5) break
  }
  return kept.join(' ')
}

// Per-detection "Related research" strip — broader searches keyed on the
// part as a whole, useful when the model didn't list attack_vectors.
function relatedResearchRow(d) {
  const part = (d.part_number || d.label || '').trim()
  if (!part) return ''
  const q = encodeURIComponent(part)
  const links = [
    [`https://www.google.com/search?q=${encodeURIComponent('site:emb3d.mitre.org ' + part)}`, 'EMB3D'],
    [`https://www.google.com/search?q=${q}+security+vulnerability`,                            'Web search'],
    [`https://scholar.google.com/scholar?q=${q}+attack`,                                       'Scholar'],
    [`https://www.exploit-db.com/search?q=${q}`,                                                'Exploit-DB'],
    [`https://hackaday.com/?s=${q}`,                                                            'Hackaday'],
    [`https://nvd.nist.gov/vuln/search/results?query=${q}`,                                     'NVD CVEs'],
  ]
  return `<div class="det-row det-row--refs"><b>Related research:</b> ${
    links.map(([h, l]) => `<a href="${h}" target="_blank" rel="noopener">${l}</a>`).join(' &middot; ')
  }</div>`
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}
// Stricter — for HTML attribute *values*. Same as escapeHtml today; kept
// distinct so we can tighten attribute-context rules later without touching
// text-context callers.
function escapeHtmlAttr(s) { return escapeHtml(s) }

// ── Toolbar wiring (palette, history, crop, retry, export, test plan) ─
const tb = {
  bar:       document.getElementById('pcb-toolbar'),
  stamp:     document.getElementById('pcb-run-stamp'),
  retry:     document.getElementById('btn-retry'),
  rerunOther:document.getElementById('btn-rerun-other'),
  crop:      document.getElementById('btn-crop'),
  testplan:  document.getElementById('btn-testplan'),
  exportMd:  document.getElementById('btn-export-md'),
  exportJson:document.getElementById('btn-export-json'),
  optCb:     document.getElementById('opt-cb'),
  history:   document.getElementById('btn-history'),
  historyPanel: document.getElementById('pcb-history'),
}

const PALETTE_LS = 'eol-pcb-palette'
try {
  const saved = localStorage.getItem(PALETTE_LS)
  if (saved === 'cb' || saved === 'default') state.palette = saved
} catch {}
if (tb.optCb) {
  tb.optCb.checked = state.palette === 'cb'
  tb.optCb.addEventListener('change', () => {
    state.palette = tb.optCb.checked ? 'cb' : 'default'
    try { localStorage.setItem(PALETTE_LS, state.palette) } catch {}
    if (state.detections.length) { drawOverlay(); renderPanel() }
  })
}

function showToolbar() {
  if (!tb.bar) return
  tb.bar.style.display = ''
  updateRunStamp()
}
function updateRunStamp() {
  if (!tb.stamp) return
  const r = state.lastRun
  if (!r) { tb.stamp.textContent = ''; return }
  const t = new Date(r.when).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const tok = (r.tokensIn != null || r.tokensOut != null)
    ? ` · ${r.tokensIn ?? '?'} in / ${r.tokensOut ?? '?'} out tok`
    : ''
  const cost = r.cost ? ` · est $${r.cost.toFixed(4)}` : (r.provider === 'ollama' ? ' · local (free)' : '')
  tb.stamp.innerHTML = `<b>${escapeHtml(r.providerLabel)}</b> · <code>${escapeHtml(r.model)}</code> · ${t} · ${(r.durationMs/1000).toFixed(1)}s${tok}${cost}`
}

// Retry: same provider, same model, same image.
tb.retry?.addEventListener('click', () => analyze())
// Re-run on a different provider — cycle to the next one that has a key/host.
tb.rerunOther?.addEventListener('click', () => {
  const order = ['anthropic', 'gemini', 'ollama']
  const others = order.filter(p => p !== state.provider)
  for (const p of others) {
    const cfg = PROVIDERS[p]
    const hasKey = !cfg.needsKey || !!getKey(p)
    if (hasKey) {
      const r = document.querySelector(`input[name=provider][value=${p}]`)
      r.checked = true; r.dispatchEvent(new Event('change'))
      setTimeout(() => analyze(), 50)
      return
    }
  }
  setStatus('error', 'No other provider has a saved key. Save one in step 1 first.')
})

// Self-review: send the current detections + image back to the same model
// with a review-focused prompt. The model checks its own output for
// (a) missed chips in corners/edges, (b) label↔notes↔category contradictions,
// (c) OCR misreads. Replaces state.detections with the corrected list.
const btnReview = document.getElementById('btn-review')
btnReview?.addEventListener('click', () => runSelfReviewPass())

async function runSelfReviewPass() {
  if (!state.detections.length) {
    setStatus('error', 'No detections to review. Click Analyze first.')
    return
  }
  if (!state.imageDataUrl) {
    setStatus('error', 'No image loaded.')
    return
  }
  const p = PROVIDERS[state.provider]
  if (p.needsKey && !state.apiKey) {
    setStatus('error', `No ${p.label} key for self-review.`)
    return
  }
  if (btnReview) btnReview.disabled = true
  setStatus('info', `Self-review pass: re-examining ${state.detections.length} detection${state.detections.length === 1 ? '' : 's'} against the image…`)

  // Strip helper fields the review prompt shouldn't see (id is reassigned
  // client-side; xrefs are computed downstream).
  const cleanCurrent = state.detections.map(d => ({
    label: d.label,
    part_number: d.part_number,
    manufacturer: d.manufacturer,
    category: d.category,
    confidence: d.confidence,
    bbox: d.bbox,
    notes: d.notes,
    pins: d.pins || [],
    attack_vectors: d.attack_vectors || [],
  }))

  state._oneShotPrompt = buildReviewPrompt(cleanCurrent)
  const startedAt = Date.now()
  try {
    let result
    if (state.provider === 'anthropic')   result = await callAnthropic()
    else if (state.provider === 'gemini') result = await callGemini()
    else                                  result = await callOllama()
    const corrected = Array.isArray(result) ? result : result.detections
    const usage = Array.isArray(result) ? null : result.usage

    if (!corrected || !corrected.length) {
      setStatus('info', 'Self-review returned an empty list — keeping original detections unchanged.')
      return
    }

    // Diff: how many net changes?
    const beforeIds = state.detections.map(d => `${d.label}|${d.part_number}|${d.category}`).sort()
    const afterIds  = corrected.map(d => `${d.label}|${d.part_number}|${d.category}`).sort()
    const added   = afterIds.filter(x => !beforeIds.includes(x)).length
    const removed = beforeIds.filter(x => !afterIds.includes(x)).length
    const same    = beforeIds.length - removed
    const total   = corrected.length

    state.detections = corrected.map((d, i) => ({ ...d, id: i + 1 }))
    state.selectedDetectionId = null

    // Mark the run stamp so the user knows this is the post-review state.
    if (state.lastRun) {
      state.lastRun.reviewed = true
      state.lastRun.reviewDurationMs = Date.now() - startedAt
      state.lastRun.reviewTokensIn  = usage?.input_tokens ?? null
      state.lastRun.reviewTokensOut = usage?.output_tokens ?? null
      state.lastRun.reviewCost      = usage?.estimated_cost ?? null
    }

    fitCanvas()
    drawOverlay()
    await renderPanel()
    updateRunStamp()
    setStatus('ok',
      `Self-review done in ${((Date.now() - startedAt)/1000).toFixed(1)}s — ` +
      `${total} detections after review (${same} unchanged, ${added} added, ${removed} removed/corrected)` +
      `${state.lastRun?.reviewCost ? ` · est. $${state.lastRun.reviewCost.toFixed(4)}` : ''}.`)
  } catch (e) {
    console.error(e)
    setStatus('error', 'Self-review failed: ' + (e.message || e))
  } finally {
    if (btnReview) btnReview.disabled = false
    state._oneShotPrompt = null
  }
}

function buildReviewPrompt(current) {
  return `You ran an initial vision-detection pass on this PCB image and produced the JSON below. Now review your own output carefully against the same image — DO NOT trust your previous reading; look at the image again.

Find THREE specific classes of error and return the FULL corrected detection list:

(a) MISSED CHIPS — scan the corners, edges, and densely-packed areas of the image. Did you miss any TSOP, QFP, QFN, BGA, SOIC, SOT, headers, crystals, or other ICs? Add new detections for anything you find.

(b) INTERNAL CONTRADICTIONS — for each existing detection, cross-check label / category / notes:
   - If "label" says "SDRAM" but "notes" says "actually a parallel NOR flash", the SDRAM label is wrong. Correct label AND category.
   - If "category" doesn't match the package type or function described in notes, fix the category.
   - If "label" uses a vendor name (e.g. "MStar/Macroblock") but the visible logo on the chip is a different vendor's, use the vendor whose logo is actually on the chip.

(c) PART-NUMBER OCR — for each detection, look at the silkscreen marking in the image one more time. Did you misread any character? Common confusions to recheck: V↔LV, 0↔O, 1↔I, 8↔B, S↔5, G↔6. If you genuinely cannot read a marking, set "part_number" to "" rather than emit a wrong guess.

YOUR PREVIOUS OUTPUT:
${JSON.stringify({ detections: current }, null, 2)}

Return the FULL corrected list — keep correct entries unchanged byte-for-byte, fix wrong ones, add missed ones. Format: {"detections": [ ... ]}. Same schema as your previous output. No prose, no markdown fences. If everything is already correct, return the same list unchanged.`
}

// Crop & re-OCR — when a detection is selected, send just that bbox at native
// resolution back to the model with a focused "read the marking exactly" prompt.
tb.crop?.addEventListener('click', async () => {
  const d = state.detections.find(x => x.id === state.selectedDetectionId)
  if (!d) { setStatus('error', 'Pick a detection first (click one in the side panel).'); return }
  await reanalyzeCrop(d)
})

async function reanalyzeCrop(d) {
  if (!state.imageDataUrl) return
  const p = PROVIDERS[state.provider]
  if (p.needsKey && !state.apiKey) { setStatus('error', `No ${p.label} key.`); return }
  setStatus('info', `Re-OCR'ing detection #${d.id} (${d.label || d.part_number || ''})…`)
  // Load source into an image for cropping
  const srcImg = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = state.imageDataUrl
  })
  const [x1, y1, x2, y2] = d.bbox
  // Expand bbox by 15% margin so we get context
  const m = 0.15
  const w = (x2 - x1), h = (y2 - y1)
  const cx1 = Math.max(0, x1 - w * m), cy1 = Math.max(0, y1 - h * m)
  const cx2 = Math.min(1, x2 + w * m), cy2 = Math.min(1, y2 + h * m)
  const px = Math.round(cx1 * srcImg.width),  py = Math.round(cy1 * srcImg.height)
  const pw = Math.round((cx2 - cx1) * srcImg.width), ph = Math.round((cy2 - cy1) * srcImg.height)
  if (pw < 20 || ph < 20) { setStatus('error', 'Bounding box too small to crop.'); return }
  // Upscale small crops to 1024px on the long edge for better OCR
  const longEdge = Math.max(pw, ph)
  const scale = longEdge < 1024 ? 1024 / longEdge : 1
  const c = document.createElement('canvas')
  c.width = Math.round(pw * scale); c.height = Math.round(ph * scale)
  const ctx = c.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(srcImg, px, py, pw, ph, 0, 0, c.width, c.height)
  const cropMime = 'image/png'
  const cropDataUrl = c.toDataURL(cropMime)
  // Temporarily swap state.imageDataUrl and prompt
  const prevImage = state.imageDataUrl, prevMime = state.imageMime
  state.imageDataUrl = cropDataUrl; state.imageMime = cropMime
  const prevBuildPrompt = buildPrompt
  // Monkey-patch the prompt builder for this one call
  const focusedPrompt = `You are looking at a CROPPED region of a PCB containing a single component or header (originally labelled "${d.label || ''}" / part "${d.part_number || 'unknown'}").

Your ONE job: read the exact text/markings on this part. Look for:
- Vendor logo
- Part number printed in silkscreen / laser etching
- Date code, lot code
- Package style (QFN, QFP, BGA, SOT, etc.)
- Any visible pin labels around it

Return ONE JSON object:
{"label":"…","part_number":"exact text you can read or empty","manufacturer":"…","category":"…","confidence":0.0-1.0,"bbox":[0,0,1,1],"notes":"what you see in this crop","pins":[],"attack_vectors":[]}

The bbox MUST be [0,0,1,1] because this is the whole crop. If you cannot read the marking, set part_number to "" — do not guess.

Return ONLY the JSON object: {"detections":[ ... ]}. No prose.`
  // Inline call: bypass buildPrompt by stashing into a holder
  state._oneShotPrompt = focusedPrompt
  try {
    let result
    if (state.provider === 'anthropic')   result = await callAnthropic()
    else if (state.provider === 'gemini') result = await callGemini()
    else                                  result = await callOllama()
    const detections = Array.isArray(result) ? result : result.detections
    if (detections.length) {
      const focused = detections[0]
      // Merge results back into the original detection, keeping its original bbox
      Object.assign(d, {
        label: focused.label || d.label,
        part_number: focused.part_number || d.part_number,
        manufacturer: focused.manufacturer || d.manufacturer,
        notes: focused.notes ? `[re-OCR] ${focused.notes}` : d.notes,
        confidence: Math.max(d.confidence || 0, focused.confidence || 0),
      })
      drawOverlay()
      await renderPanel()
      setStatus('ok', `Re-OCR done. Updated detection #${d.id}.`)
    } else {
      setStatus('error', 'Re-OCR returned no detection.')
    }
  } catch (e) {
    setStatus('error', 'Re-OCR failed: ' + (e.message || e))
  } finally {
    state.imageDataUrl = prevImage
    state.imageMime = prevMime
    state._oneShotPrompt = null
  }
}

// Generate a hardware-pentest test plan from current detections.
tb.testplan?.addEventListener('click', () => {
  if (!state.detections.length) { setStatus('error', 'No detections to plan from.'); return }
  const md = buildTestPlanMarkdown()
  copyToClipboard(md, 'Test plan')
})

function buildTestPlanMarkdown() {
  const r = state.lastRun
  const dets = visibleDetections()
  const lines = []
  lines.push('# Hardware test plan')
  if (r) lines.push(`_Generated from ${r.providerLabel} (${r.model}) at ${new Date(r.when).toISOString()}_`)
  lines.push('')
  // Priority categories first
  const order = ['header', 'connector', 'mcu', 'soc', 'flash', 'eeprom', 'ram', 'radio', 'power', 'sensor', 'interface', 'crystal', 'unknown']
  const sorted = [...dets].sort((a, b) =>
    order.indexOf(a.category || 'unknown') - order.indexOf(b.category || 'unknown'))
  let step = 1
  for (const d of sorted) {
    const head = `## ${step++}. ${d.label || d.part_number || 'unknown'}${d.part_number ? ` (\`${d.part_number}\`)` : ''}`
    lines.push(head)
    if (d.notes) lines.push(`> ${d.notes}`)
    if (d.pins?.length) lines.push(`- Pins: ${d.pins.map(p => '`' + p + '`').join(' ')}`)
    if (d.attack_vectors?.length) {
      lines.push('- **Try:**')
      for (const a of d.attack_vectors) lines.push(`  - [ ] ${a}`)
    } else {
      lines.push('- [ ] Identify pinout from datasheet')
      lines.push('- [ ] Continuity-test against MCU pins')
    }
    if (d.part_number) {
      lines.push(`- References: [datasheet](https://www.alldatasheet.com/search.jsp?Searchword=${encodeURIComponent(d.part_number)}) · [EMB3D](https://www.google.com/search?q=site%3Aemb3d.mitre.org+${encodeURIComponent(d.part_number)}) · [CVEs](https://nvd.nist.gov/vuln/search/results?query=${encodeURIComponent(d.part_number)})`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

// Export Markdown / JSON
tb.exportMd?.addEventListener('click', () => {
  copyToClipboard(buildReportMarkdown(), 'Markdown report')
})
tb.exportJson?.addEventListener('click', () => {
  copyToClipboard(JSON.stringify({ run: state.lastRun, detections: state.detections }, null, 2), 'JSON report')
})

function buildReportMarkdown() {
  const r = state.lastRun
  const dets = visibleDetections()
  const lines = []
  lines.push('# PCB Inspect report')
  if (r) lines.push(`_Model: ${r.providerLabel} (${r.model}) · ${new Date(r.when).toISOString()} · ${dets.length} detections shown_`)
  lines.push('')
  for (const d of dets) {
    lines.push(`## ${d.id}. ${d.label || 'unknown'}${d.part_number ? ` — \`${d.part_number}\`` : ''}`)
    if (d.manufacturer) lines.push(`- Manufacturer: ${d.manufacturer}`)
    if (d.category) lines.push(`- Category: ${d.category}`)
    lines.push(`- Confidence: ${(d.confidence != null ? Math.round(d.confidence * 100) + '%' : 'unknown')}`)
    if (d.notes) lines.push(`- ${d.notes}`)
    if (d.pins?.length) lines.push(`- Pins: ${d.pins.join(', ')}`)
    if (d.attack_vectors?.length) {
      lines.push('- Attack vectors:')
      for (const a of d.attack_vectors) lines.push(`  - ${a}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function copyToClipboard(text, what) {
  try {
    await navigator.clipboard.writeText(text)
    setStatus('ok', `${what} copied to clipboard (${text.length} chars).`)
  } catch {
    // Fallback: open in a new window
    const w = window.open('', '_blank')
    if (w) { w.document.write('<pre>' + escapeHtml(text) + '</pre>'); w.document.close() }
    setStatus('info', `Clipboard blocked — ${what} opened in a new window.`)
  }
}

// History — last 8 runs, kept in localStorage.
const HISTORY_LS = 'eol-pcb-history'
const HISTORY_MAX = 8

function saveToHistory() {
  if (!state.detections.length) return
  try {
    const prev = JSON.parse(localStorage.getItem(HISTORY_LS) || '[]')
    // Tiny thumbnail (160px wide) for the history list
    const thumb = makeThumbnail(state.imageDataUrl, 160)
    const entry = {
      when: state.lastRun?.when || new Date().toISOString(),
      provider: state.lastRun?.providerLabel || state.provider,
      model:    state.lastRun?.model || state.model,
      count:    state.detections.length,
      thumb,
      detections: state.detections,
      image:      state.imageDataUrl,
      mime:       state.imageMime,
    }
    const next = [entry, ...prev].slice(0, HISTORY_MAX)
    localStorage.setItem(HISTORY_LS, JSON.stringify(next))
  } catch (e) {
    // History is best-effort; localStorage may be full.
    console.warn('history save failed', e)
  }
}

function makeThumbnail(dataUrl, width) {
  try {
    const img = new Image(); img.src = dataUrl
    if (!img.complete) return null
    const scale = width / img.naturalWidth
    if (scale >= 1) return dataUrl
    const c = document.createElement('canvas')
    c.width = width; c.height = Math.round(img.naturalHeight * scale)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.7)
  } catch { return null }
}

tb.history?.addEventListener('click', () => {
  if (tb.historyPanel.style.display === '') {
    tb.historyPanel.style.display = 'none'
    return
  }
  let entries = []
  try { entries = JSON.parse(localStorage.getItem(HISTORY_LS) || '[]') } catch {}
  if (!entries.length) {
    tb.historyPanel.innerHTML = '<div class="pcb-history-empty">No saved runs yet. Run an analysis and it will appear here (last 8 only, stored in your browser).</div>'
  } else {
    tb.historyPanel.innerHTML = entries.map((e, i) => `
      <div class="pcb-history-card" data-idx="${i}">
        ${e.thumb ? `<img src="${e.thumb}" alt="">` : ''}
        <div class="pcb-history-meta">
          <div><b>${escapeHtml(e.provider)}</b> · <code>${escapeHtml(e.model)}</code></div>
          <div class="pcb-history-time">${new Date(e.when).toLocaleString()}</div>
          <div class="pcb-history-count">${e.count} detection${e.count === 1 ? '' : 's'}</div>
        </div>
        <button class="pcb-btn pcb-btn--ghost pcb-history-restore" data-idx="${i}">Restore</button>
      </div>`).join('')
    tb.historyPanel.querySelectorAll('.pcb-history-restore').forEach(b => {
      b.addEventListener('click', () => restoreHistoryEntry(entries[parseInt(b.dataset.idx, 10)]))
    })
  }
  tb.historyPanel.style.display = ''
})

async function restoreHistoryEntry(e) {
  state.imageDataUrl = e.image
  state.imageMime = e.mime
  state.detections = e.detections
  els.image.src = e.image
  els.resultSec.style.display = ''
  els.controls.style.display = ''
  await new Promise(r => { els.image.onload = r })
  fitCanvas()
  drawOverlay()
  await renderPanel()
  tb.historyPanel.style.display = 'none'
  setStatus('ok', `Restored from history — ${e.count} detection${e.count === 1 ? '' : 's'} from ${e.provider}.`)
}

// Keyboard navigation: ↑/↓ cycles selected detection; Enter zooms-in.
window.addEventListener('keydown', e => {
  if (!state.detections.length) return
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return
  const vis = visibleDetections()
  if (!vis.length) return
  const ids = vis.map(d => d.id)
  let idx = ids.indexOf(state.selectedDetectionId)
  if (e.key === 'ArrowDown' || e.key === 'j') {
    e.preventDefault(); idx = (idx + 1 + ids.length) % ids.length
    selectDetection(ids[idx])
  } else if (e.key === 'ArrowUp' || e.key === 'k') {
    e.preventDefault(); idx = (idx - 1 + ids.length) % ids.length
    selectDetection(ids[idx])
  } else if (e.key === 'Enter' && state.selectedDetectionId) {
    e.preventDefault()
    const d = state.detections.find(x => x.id === state.selectedDetectionId)
    if (d) reanalyzeCrop(d)
  } else if (e.key === 'Escape') {
    state.selectedDetectionId = null
    if (tb.crop) tb.crop.disabled = true
    highlightCard(0); drawOverlay()
  }
})

function selectDetection(id) {
  state.selectedDetectionId = id
  if (tb.crop) tb.crop.disabled = false
  drawOverlay(id)
  highlightCard(id)
  const card = document.getElementById('det-' + id)
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

// ── Pan + zoom + bbox edit + touch ───────────────────────────────────
const container = document.querySelector('.pcb-canvas-container')
const optEdit = document.getElementById('opt-edit')
const zoomIn  = document.getElementById('btn-zoom-in')
const zoomOut = document.getElementById('btn-zoom-out')
const zoomReset = document.getElementById('btn-zoom-reset')

function applyView() {
  if (!container) return
  const v = state.view
  container.style.transformOrigin = '0 0'
  container.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`
}
function resetView() {
  state.view = { x: 0, y: 0, scale: 1 }
  applyView()
}
// Image size slider — primary control. Buttons just nudge the slider.
const sizeSlider = document.getElementById('img-size-slider')
const sizeLabel  = document.getElementById('img-size-label')

function applyImageSize() {
  if (!sizeSlider || !els.image) return
  const pct = parseInt(sizeSlider.value, 10) || 100
  sizeLabel.textContent = pct + '%'
  if (pct === 100 || !state.imgNatural?.w) {
    // 100% = "fit" — let CSS max-width/max-height handle it.
    els.image.style.width = ''
    els.image.style.height = ''
  } else {
    // Compute the "fit" size first, then multiply by slider.
    const stage = document.querySelector('.app-image-stage')
    if (!stage) return
    const avW = Math.max(120, stage.clientWidth - 32)
    const avH = Math.max(120, stage.clientHeight - 90)
    const w0 = state.imgNatural.w
    const h0 = state.imgNatural.h
    const fitScale = Math.min(avW / w0, avH / h0, 1)
    const targetW = Math.max(120, w0 * fitScale * (pct / 100))
    els.image.style.width = targetW + 'px'
    els.image.style.height = 'auto'
  }
  requestAnimationFrame(() => { fitCanvas(); drawOverlay(state.selectedDetectionId) })
}

sizeSlider?.addEventListener('input', applyImageSize)
zoomIn?.addEventListener('click', () => {
  if (!sizeSlider) return
  sizeSlider.value = Math.min(250, parseInt(sizeSlider.value, 10) + 10)
  applyImageSize()
})
zoomOut?.addEventListener('click', () => {
  if (!sizeSlider) return
  sizeSlider.value = Math.max(40, parseInt(sizeSlider.value, 10) - 10)
  applyImageSize()
})
zoomReset?.addEventListener('click', () => {
  if (!sizeSlider) return
  sizeSlider.value = 100
  applyImageSize()
})
optEdit?.addEventListener('change', () => {
  state.editMode = optEdit.checked
  els.canvas.style.cursor = state.editMode ? 'crosshair' : 'default'
  drawOverlay(state.selectedDetectionId)
})

function zoomBy(factor, cx, cy) {
  const v = state.view
  const newScale = Math.max(0.5, Math.min(8, v.scale * factor))
  if (cx == null || cy == null) {
    const rect = container?.getBoundingClientRect()
    cx = rect ? rect.width / 2 : 0
    cy = rect ? rect.height / 2 : 0
  }
  // Keep (cx, cy) stable under zoom
  const ratio = newScale / v.scale
  v.x = cx - (cx - v.x) * ratio
  v.y = cy - (cy - v.y) * ratio
  v.scale = newScale
  applyView()
}

// Wheel zoom (mouse) — hold Ctrl/Cmd OR Shift to zoom (otherwise the
// wheel scrolls the page normally, which is what most users expect).
// Without modifier, wheel does nothing inside the canvas area.
container?.addEventListener('wheel', e => {
  if (!state.imageDataUrl) return
  if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return
  e.preventDefault()
  const rect = container.getBoundingClientRect()
  const cx = e.clientX - rect.left
  const cy = e.clientY - rect.top
  // Gentler step: 7% per notch instead of 15%.
  zoomBy(e.deltaY < 0 ? 1.07 : 0.93, cx, cy)
}, { passive: false })

// Mouse / touch pan + bbox interaction. We track three modes:
//   - drag = panning the image
//   - move = moving a selected bbox
//   - resize = resizing a selected bbox (with which handle)
const drag = { active: false, mode: null, startX: 0, startY: 0, startBbox: null, handle: null, lastTouchDist: 0 }

function canvasCoordsFromClient(clientX, clientY) {
  const rect = els.canvas.getBoundingClientRect()
  // rect already accounts for CSS transforms.
  return {
    x: (clientX - rect.left) / rect.width,
    y: (clientY - rect.top) / rect.height,
  }
}

// Hit-test bbox handles in normalised coords. Returns 'tl','tr','bl','br','t','b','l','r','inside' or null.
function bboxHandle(bbox, x, y) {
  const [x1, y1, x2, y2] = bbox
  const hx = 0.015  // handle tolerance in normalised coords
  const hy = 0.020
  const near = (a, b, t) => Math.abs(a - b) < t
  if (near(x, x1, hx) && near(y, y1, hy)) return 'tl'
  if (near(x, x2, hx) && near(y, y1, hy)) return 'tr'
  if (near(x, x1, hx) && near(y, y2, hy)) return 'bl'
  if (near(x, x2, hx) && near(y, y2, hy)) return 'br'
  if (near(y, y1, hy) && x > x1 && x < x2) return 't'
  if (near(y, y2, hy) && x > x1 && x < x2) return 'b'
  if (near(x, x1, hx) && y > y1 && y < y2) return 'l'
  if (near(x, x2, hx) && y > y1 && y < y2) return 'r'
  if (x > x1 && x < x2 && y > y1 && y < y2) return 'inside'
  return null
}

function pointerDown(e) {
  if (!state.imageDataUrl) return
  const ptCount = e.touches ? e.touches.length : 1
  if (ptCount === 2 && e.touches) {
    // Pinch: track initial distance
    const [a, b] = [e.touches[0], e.touches[1]]
    drag.lastTouchDist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
    drag.mode = 'pinch'
    drag.active = true
    return
  }
  const cx = e.touches ? e.touches[0].clientX : e.clientX
  const cy = e.touches ? e.touches[0].clientY : e.clientY
  const norm = canvasCoordsFromClient(cx, cy)
  // If edit mode + a detection is selected: try a handle hit first
  if (state.editMode && state.selectedDetectionId) {
    const d = state.detections.find(x => x.id === state.selectedDetectionId)
    if (d) {
      const h = bboxHandle(d.bbox, norm.x, norm.y)
      if (h && h !== 'inside') {
        drag.active = true; drag.mode = 'resize'; drag.handle = h
        drag.startX = norm.x; drag.startY = norm.y; drag.startBbox = [...d.bbox]
        e.preventDefault?.(); return
      }
      if (h === 'inside') {
        drag.active = true; drag.mode = 'move'
        drag.startX = norm.x; drag.startY = norm.y; drag.startBbox = [...d.bbox]
        e.preventDefault?.(); return
      }
    }
  }
  // Otherwise: pan — but only if zoomed in. At scale=1 the image already
  // fits, panning it around is confusing.
  if (state.view.scale <= 1.01) return
  drag.active = true; drag.mode = 'pan'
  drag.startX = cx - state.view.x
  drag.startY = cy - state.view.y
  els.canvas.style.cursor = 'grabbing'
}

function pointerMove(e) {
  if (!drag.active) return
  if (drag.mode === 'pinch' && e.touches && e.touches.length === 2) {
    const [a, b] = [e.touches[0], e.touches[1]]
    const dist = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
    const rect = container.getBoundingClientRect()
    const cx = (a.clientX + b.clientX) / 2 - rect.left
    const cy = (a.clientY + b.clientY) / 2 - rect.top
    zoomBy(dist / drag.lastTouchDist, cx, cy)
    drag.lastTouchDist = dist
    e.preventDefault(); return
  }
  const cx = e.touches ? e.touches[0].clientX : e.clientX
  const cy = e.touches ? e.touches[0].clientY : e.clientY
  if (drag.mode === 'pan') {
    state.view.x = cx - drag.startX
    state.view.y = cy - drag.startY
    applyView()
  } else if (drag.mode === 'move' || drag.mode === 'resize') {
    const d = state.detections.find(x => x.id === state.selectedDetectionId)
    if (!d) return
    const norm = canvasCoordsFromClient(cx, cy)
    const dx = norm.x - drag.startX, dy = norm.y - drag.startY
    let [x1, y1, x2, y2] = drag.startBbox
    if (drag.mode === 'move') {
      const w = x2 - x1, h = y2 - y1
      x1 = Math.max(0, Math.min(1 - w, x1 + dx)); y1 = Math.max(0, Math.min(1 - h, y1 + dy))
      x2 = x1 + w; y2 = y1 + h
    } else {
      if (drag.handle.includes('l')) x1 = Math.max(0, Math.min(x2 - 0.01, x1 + dx))
      if (drag.handle.includes('r')) x2 = Math.min(1, Math.max(x1 + 0.01, x2 + dx))
      if (drag.handle.includes('t')) y1 = Math.max(0, Math.min(y2 - 0.01, y1 + dy))
      if (drag.handle.includes('b')) y2 = Math.min(1, Math.max(y1 + 0.01, y2 + dy))
    }
    d.bbox = [x1, y1, x2, y2]
    drawOverlay(d.id)
    e.preventDefault?.()
  }
}

function pointerUp() {
  if (drag.active && (drag.mode === 'move' || drag.mode === 'resize')) {
    // Persist updated bbox in history (overwrite latest entry's detections)
    try {
      const prev = JSON.parse(localStorage.getItem(HISTORY_LS) || '[]')
      if (prev.length) { prev[0].detections = state.detections; localStorage.setItem(HISTORY_LS, JSON.stringify(prev)) }
    } catch {}
  }
  drag.active = false; drag.mode = null; drag.handle = null
  els.canvas.style.cursor = state.editMode ? 'crosshair' : (state.view.scale > 1.01 ? 'grab' : 'default')
}

if (container) {
  container.addEventListener('mousedown', pointerDown)
  window.addEventListener('mousemove', pointerMove)
  window.addEventListener('mouseup', pointerUp)
  container.addEventListener('touchstart', pointerDown, { passive: false })
  container.addEventListener('touchmove',  pointerMove, { passive: false })
  container.addEventListener('touchend',   pointerUp)
}

// Extend drawOverlay to render edit handles when editMode + a detection selected.
// We patch it by wrapping the original.
const _origDraw = drawOverlay
drawOverlay = function(hoverId = null) {
  _origDraw(hoverId)
  if (!state.editMode || !state.selectedDetectionId) return
  const d = state.detections.find(x => x.id === state.selectedDetectionId)
  if (!d) return
  const c = els.canvas, ctx = c.getContext('2d')
  const W = c.width, H = c.height
  const [x1, y1, x2, y2] = d.bbox
  const px = x1 * W, py = y1 * H, pw = (x2 - x1) * W, ph = (y2 - y1) * H
  const s = 8
  const pts = [
    [px, py], [px + pw / 2, py], [px + pw, py],
    [px, py + ph / 2],            [px + pw, py + ph / 2],
    [px, py + ph], [px + pw / 2, py + ph], [px + pw, py + ph],
  ]
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 1
  for (const [x, y] of pts) {
    ctx.fillRect(x - s / 2, y - s / 2, s, s)
    ctx.strokeRect(x - s / 2, y - s / 2, s, s)
  }
}
