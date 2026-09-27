// 0KAY 戳一戳插件 — 互动间页面 (scheme C, native Vue ESM).
//
// 由 `poke.patch` 的 router op 在 `/poke` 加载，Core 以
// `/api/plugins/poke/ui/index.js` 提供。裸 `vue` 走 WebUI importmap -> host bridge。
//
// Live2D 运行库由宿主在启动时挂到全局（见 webui/src/live2d-runtime.ts）：
//   window.PIXI                      -> pixi.js 命名空间（含 Application）
//   window.PIXI.live2d.Live2DModel   -> 模型构造器
// 本插件不打包 PIXI，直接用全局构造器重新加载同一个模型，在独立的「互动间」里
// 做戳 / 喂 / 摸 + 拖动 + 缩放 + 按部位/连点说话，不触碰聊天页那个 Live2D 实例。
//
// 设计边界（按用户要求，不动 Core/L.I.F.E 源码、不自己造数据）：
//   - 互动 = 干净的同步轻微脉冲 + 优先播模型自带 motion + 飘粒子 + 本地话术气泡。
//   - 角色可拖动 / 滚轮缩放（纯前端状态，不持久化）。
//   - 「TA 的好感」从 /api/life/companion 只读展示；话术是本地预置，不调用 L.I.F.E 生成。

import { h, ref, computed, onMounted, onBeforeUnmount } from 'vue'

const CSS = `
/* ============ Poke · 互动间 ============ */
#app .poke{
  height:100%;display:flex;flex-direction:column;box-sizing:border-box;
  padding:clamp(20px,3vw,40px);gap:18px;overflow:hidden;
  color:var(--md-on-surface);font-family:var(--font-family);
  background:
    radial-gradient(900px 460px at 102% -10%,color-mix(in srgb,var(--md-primary) 12%,transparent),transparent 60%),
    var(--md-surface);
}
#app .poke *{box-sizing:border-box}
#app .poke h1,#app .poke p{margin:0}
#app .poke button{font-family:inherit;position:static;min-height:0;isolation:auto}

.poke-head{margin:0}
.poke-eyebrow{margin:0 0 6px;color:var(--md-primary);font:800 12px/1 ui-monospace,monospace;letter-spacing:.18em}
.poke-head h1{font-size:clamp(26px,3vw,38px);font-weight:800;letter-spacing:-.02em}
.poke-sub{margin-top:8px;color:var(--md-on-surface-variant);font-size:14px;line-height:1.6;max-width:60ch}

.poke-stats{display:flex;gap:14px;flex-wrap:wrap}
#app .poke .poke-stat{
  flex:1;min-width:150px;padding:16px 18px;border-radius:20px;
  background:var(--md-surface-container-low);
}
.poke-stat-label{display:block;font-size:12px;opacity:.7;letter-spacing:.04em}
.poke-stat-value{font-size:26px;font-weight:800;line-height:1.2}
.poke-stat-value small{font-size:14px;font-weight:700;opacity:.7;margin-left:6px}
.poke-affinity{height:8px;border-radius:999px;background:var(--md-surface-container-highest);overflow:hidden;margin-top:12px}
.poke-affinity > i{display:block;height:100%;width:0;background:linear-gradient(90deg,#ff8fab,#ff5b7f);transition:width .35s cubic-bezier(.22,1,.36,1)}
.poke-stat-hint{font-size:12px;opacity:.6;margin-top:8px;line-height:1.5}

.poke-stage{
  flex:1;position:relative;border-radius:28px;overflow:hidden;min-height:240px;
  touch-action:none;cursor:grab;
  background:
    radial-gradient(120% 90% at 50% 0%,color-mix(in srgb,var(--md-primary) 14%,transparent),transparent 60%),
    var(--md-surface-container-lowest);
}
.poke-stage.dragging{cursor:grabbing}
.poke-stage canvas{position:absolute;inset:0;display:block}
.poke-overlay{
  position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  text-align:center;padding:28px;color:var(--md-on-surface-variant);
  font-size:15px;line-height:1.7;pointer-events:none;
}

.poke-bubble{
  position:absolute;pointer-events:none;max-width:230px;padding:10px 14px;border-radius:16px;
  background:var(--md-surface-container-high);color:var(--md-on-surface);
  font-size:14px;line-height:1.45;box-shadow:0 10px 28px rgba(0,0,0,.2);text-align:center;
  transform:translate(-50%,-100%);animation:poke-bubble 2.6s ease forwards;z-index:5;
}
.poke-bubble::after{content:'';position:absolute;left:50%;bottom:-7px;transform:translateX(-50%);
  border:7px solid transparent;border-top-color:var(--md-surface-container-high);border-bottom:0}
@keyframes poke-bubble{
  0%{opacity:0;transform:translate(-50%,-86%) scale(.9)}
  12%{opacity:1;transform:translate(-50%,-100%) scale(1)}
  82%{opacity:1}
  100%{opacity:0;transform:translate(-50%,-108%) scale(1)}
}

.poke-floater{
  position:absolute;pointer-events:none;font-size:30px;
  text-shadow:0 2px 10px rgba(0,0,0,.15);
  animation:poke-float 1.1s ease-out forwards;
}
@keyframes poke-float{
  0%{transform:translate(-50%,-50%) scale(.5);opacity:0}
  18%{opacity:1;transform:translate(-50%,-60%) scale(1)}
  100%{transform:translate(-50%,-170%) scale(1.15);opacity:0}
}

.poke-fly{
  position:absolute;left:0;top:0;pointer-events:none;font-size:34px;
  filter:drop-shadow(0 3px 6px rgba(0,0,0,.2));
  animation:poke-fly .5s ease-in forwards;
}
@keyframes poke-fly{
  0%{transform:translate(-50%,-50%) translate(var(--x0),var(--y0)) scale(.5);opacity:0}
  20%{opacity:1}
  100%{transform:translate(-50%,-50%) translate(var(--x1),var(--y1)) scale(1.15);opacity:1}
}

.poke-actions{display:flex;gap:12px;flex-wrap:wrap}
#app .poke .poke-act{
  display:inline-flex;align-items:center;gap:8px;height:44px;padding:0 18px;
  border:0;border-radius:14px;cursor:pointer;font:700 14px/1 inherit;
  background:var(--md-surface-container-high);color:var(--md-on-surface);
  transition:transform .15s ease,background-color .2s;
}
#app .poke .poke-act:hover{transform:translateY(-2px)}
#app .poke .poke-act:active{transform:translateY(0) scale(.96)}
.poke-act-ico{font-size:18px}
.poke-hint{font-size:12px;opacity:.55;margin-left:auto;align-self:center}
`

const STYLE_ID = '0kay-poke-style'
function mountStyle() {
  if (typeof document === 'undefined') return
  const el = document.getElementById(STYLE_ID)
  if (el && el.textContent === CSS) return
  if (el) el.remove()
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

// ---------- i18n ----------
function langKeyOf() {
  let lang = 'en'
  try { lang = localStorage.getItem('0kay_lang') || navigator.language || 'en' } catch { /* ignore */ }
  const l = String(lang).toLowerCase()
  if (l.startsWith('ja')) return 'ja'
  if (l.startsWith('zh')) return 'zh'
  return 'en'
}

const LABELS = {
  zh: {
    title: '戳一戳',
    sub: '拖动调整位置，滚轮缩放；点不同部位反应不同，戳多了会被嫌。好感是 TA 的，互动不会改变它。',
    relLabel: 'TA 的好感',
    tapsLabel: '互动',
    times: '下',
    relHint: '取自 L.I.F.E，互动不会改变它',
    relOffline: '需要 L.I.F.E 在线才能读取 TA 的好感',
    actPoke: '戳一下', actFeed: '喂零食', actPet: '摸摸头',
    dragHint: '拖动移动 · 滚轮缩放 · 头上晃动可摸头',
    loading: '加载中…',
    needRuntime: 'Live2D 运行库还没就绪，请确认 0KAY 已经正常启动。',
    appFail: '画面初始化失败：',
    listFail: '拿不到模型列表：',
    noModel: '还没有可用的 Live2D 模型。先去设置里加一个模型，再回来玩。',
    modelFail: '模型加载失败：',
  },
  en: {
    title: 'Poke',
    sub: 'Drag to move, scroll to zoom. Different spots, different reactions — overdo it and they get annoyed.',
    relLabel: 'Their affection',
    tapsLabel: 'Interactions',
    times: 'times',
    relHint: 'Read from L.I.F.E; playing does not change it',
    relOffline: 'L.I.F.E must be online to read their affection',
    actPoke: 'Poke', actFeed: 'Feed', actPet: 'Pet',
    dragHint: 'drag to move · scroll to zoom · wiggle on head to pet',
    loading: 'Loading…',
    needRuntime: 'Live2D runtime is not ready — make sure 0KAY started up.',
    appFail: 'Failed to init canvas: ',
    listFail: 'Could not load model list: ',
    noModel: 'No Live2D model available yet. Add one in Settings, then come back.',
    modelFail: 'Model failed to load: ',
  },
  ja: {
    title: 'ぽこっと',
    sub: 'ドラッグで移動、スクロールで拡大。場所で反応が変わる。連続でつつくとむっとする。',
    relLabel: '相手の好感度',
    tapsLabel: 'インタラクション',
    times: '回',
    relHint: 'L.I.F.E から取得。遊んでも変わらない',
    relOffline: 'L.I.F.E がオンラインなら読めます',
    actPoke: 'つつく', actFeed: 'おやつ', actPet: 'なでる',
    dragHint: 'ドラッグ移動・拡大・頭を揺らすと撫でる',
    loading: '読み込み中…',
    needRuntime: 'Live2D ランタイムがまだ準備できていません。0KAY が起動しているか確認してください。',
    appFail: '画面の初期化に失敗：',
    listFail: 'モデル一覧の取得に失敗：',
    noModel: '使える Live2D モデルがありません。設定で追加してから戻ってきてね。',
    modelFail: 'モデルの読み込みに失敗：',
  },
}

// 本地预置话术（按 互动种类 × 部位 / 连点 组合）。不调用后端。
const LINES = {
  zh: {
    poke: {
      face: ['戳脸做什么。', '脸别戳。', '别对着脸下手。', '脸上有什么好戳的。'],
      head: ['别戳头发。', '头顶凉。', '发型被弄乱了。', '头不是给你戳的。'],
      body: ['肚子别戳。', '那里不行。', '偷袭肚子？', '痒，别挠。'],
      feet: ['脚不许戳。', '往下戳什么。', '脚很痒。', '再戳脚就踢你。'],
      default: ['？', '戳到了。', '嗯？', '被你发现了。'],
      spam: ['别戳了。', '够了吧。', '再戳我生气。', '你是不是闲的。', '适可而止。'],
    },
    feed: {
      default: ['谢了。', '这个不错。', '味道还行。', '又投喂。', '好吃。'],
    },
    pet: {
      default: ['别老摸头。', '摸就摸吧。', '行了。', '……还行。', '别停。'],
    },
  },
  en: {
    poke: {
      face: ['Why poke my face.', 'Leave the face alone.', 'Not the face.', 'What\'s on my face.'],
      head: ['Stop poking my hair.', 'Top of head is cold.', 'You ruined my hair.', 'Head\'s not for poking.'],
      body: ['Not the belly.', 'That spot\'s off-limits.', 'Sneak-attack the belly?', 'Ticklish, stop.'],
      feet: ['Feet are off-limits.', 'Why down there.', 'Feet are ticklish.', 'Poke my feet and I kick.'],
      default: ['?', 'Got poked.', 'Hmm?', 'You found me.'],
      spam: ['Stop poking.', 'Enough.', 'Poke me again and I\'m mad.', 'You must be bored.', 'Cut it out.'],
    },
    feed: {
      default: ['Thanks.', 'Not bad.', 'Tastes fine.', 'More snacks?', 'Good.'],
    },
    pet: {
      default: ['Stop petting my head.', 'Fine, pet it.', 'Okay okay.', '…not bad.', 'Don\'t stop.'],
    },
  },
  ja: {
    poke: {
      face: ['なんで顔をつつく。', '顔はやめて。', '顔はだめだよ。', '顔に何あるの。'],
      head: ['髪の毛やめて。', '頭のてっぺんひんやり。', 'ヘアスタイル崩れた。', '頭はつつくな。'],
      body: ['お腹はやめて。', 'そこはダメ。', 'お腹の不意打ち？', 'くすぐったい、やめて。'],
      feet: ['足はダメ。', 'なんで下なの。', '足くすぐったい。', '足つつしたら蹴る。'],
      default: ['？', 'つつかれた。', 'ん？', 'バレたか。'],
      spam: ['つつくのやめて。', 'もういい。', 'これ以上したら怒る。', '暇なんだね。', 'やめなよ。'],
    },
    feed: {
      default: ['ありがとう。', '悪くない。', 'まあまあ美味い。', 'またおやつ？', '美味しい。'],
    },
    pet: {
      default: ['頭ばかり撫でるな。', '撫でるなら撫でて。', 'もういい。', '…悪くない。', 'やめないで。'],
    },
  },
}

const SNACKS = ['🍪', '🍓', '🍙', '🍰', '🍬', '🥐', '🍎', '🧁', '🍡', '🍫']
const MOTION_GROUPS = {
  poke: ['TapBody', 'Tap', 'Flick'],
  feed: ['Eat', 'Food', 'Happy', 'Surprise'],
  pet: ['Flick', 'Idle', 'Happy', 'Touch'],
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

export default {
  name: 'PokePage',
  setup() {
    mountStyle()
    const langKey = langKeyOf()
    const t = LABELS[langKey]
    const lines = LINES[langKey]

    const relationship = ref({ affinity: null, stage: null })
    const relOk = ref(false)
    const taps = ref(0)
    const status = ref('loading')
    const statusMsg = ref('')
    const models = ref([])
    const current = ref(0)
    const floaters = ref([])
    const flyers = ref([])
    const bubble = ref(null)

    const relPct = computed(() => {
      const a = relationship.value.affinity
      if (typeof a !== 'number') return 0
      return Math.max(0, Math.min(100, ((a + 1) / 2) * 100))
    })

    let app = null
    let model = null
    let stageEl = null
    let baseScale = 1
    let userScale = 1
    let userX = 0
    let userY = 0
    let anim = null
    let tickerFn = null
    let pointerDown = null
    let lastHover = null
    let hoverDir = 0
    let wiggles = 0
    let hoverDist = 0
    let petCooldown = 0
    let bubbleTimer = null
    let lastPoke = 0
    let pokeStreak = 0

    function applyPose() {
      if (!model || !stageEl) return
      const sc = baseScale * userScale
      let mul = 1
      let dy = 0
      let rot = 0
      const now = performance.now()
      if (anim) {
        const p = Math.min(1, (now - anim.t0) / anim.dur)
        if (p >= 1) {
          anim = null
        } else {
          // 衰减振荡：先过冲再回弹，做出「Q 弹」果冻感（同步缩放，不变形）
          const osc = Math.sin(p * Math.PI * 3) * Math.exp(-3.0 * p)
          const pop = Math.abs(Math.sin(p * Math.PI))
          if (anim.kind === 'poke') { mul = 1 + pop * 0.04; dy = -pop * 5; rot = Math.sin(p * Math.PI) * 0.015 }
          else if (anim.kind === 'feed') { mul = 1 + Math.sin(p * Math.PI) * 0.07; dy = -pop * 6 }
          else if (anim.kind === 'pet') { mul = 1 + Math.sin(p * Math.PI * 2) * 0.04; rot = Math.sin(p * Math.PI * 2) * 0.03 }
        }
      }
      // 待机时轻微悬浮 + 极轻摇晃，让角色「活」起来（不喧宾夺主）
      const tt = now / 1000
      dy += Math.sin(tt * 1.1) * 4
      if (!anim) rot += Math.sin(tt * 0.7) * 0.012
      const w = stageEl.clientWidth
      const hgt = stageEl.clientHeight
      model.scale.set(sc * mul)
      model.rotation = rot
      model.x = (w - model.width * sc) / 2 + userX
      model.y = (hgt - model.height * sc) / 2 + userY + dy
    }

    function fitModel() {
      if (!model || !stageEl) return
      const w = stageEl.clientWidth
      const hgt = stageEl.clientHeight
      if (!w || !hgt) return
      baseScale = Math.min(w / model.width, hgt / model.height) * 0.92
      applyPose()
    }

    function modelCenter() {
      if (!model) return [0, 0]
      const b = model.getBounds()
      return [b.x + b.width / 2, b.y + b.height / 2]
    }

    // 按点击相对模型包围盒的位置判定部位
    function hitPart(px, py) {
      if (!model) return 'default'
      const b = model.getBounds()
      const relY = (py - b.y) / b.height
      const relX = (px - b.x) / b.width
      if (relY < 0.32) return Math.abs(relX - 0.5) < 0.3 ? 'face' : 'head'
      if (relY > 0.8) return 'feet'
      return 'body'
    }

    function say(text, x, y) {
      bubble.value = { text, x, y }
      if (bubbleTimer) clearTimeout(bubbleTimer)
      bubbleTimer = setTimeout(() => { bubble.value = null }, 2500)
    }

    function spawnFloater(x, y, emoji, color) {
      const id = performance.now() + Math.random()
      floaters.value = floaters.value.concat({ id, x, y, emoji, color })
      setTimeout(() => {
        floaters.value = floaters.value.filter((f) => f.id !== id)
      }, 1100)
    }

    function playMotion(kind) {
      if (!model) return
      for (const g of MOTION_GROUPS[kind] || []) {
        try { model.motion(g); return } catch { /* 该组没有就试下一个 */ }
      }
    }

    function triggerAnim(kind, dur) {
      anim = { kind, t0: performance.now(), dur: dur || 600 }
    }

    function doPoke(px, py) {
      if (status.value !== 'ready' || !model) return
      taps.value += 1
      const part = hitPart(px, py)
      const now = performance.now()
      if (now - lastPoke < 650) pokeStreak += 1
      else pokeStreak = 1
      lastPoke = now
      triggerAnim('poke', 420)
      playMotion('poke')
      spawnFloater(px, py, '♥', '#ff5b7f')
      const text = pokeStreak >= 4 ? pick(lines.poke.spam) : pick(lines.poke[part] || lines.poke.default)
      say(text, px, py - 46)
    }

    function petTalk(x, y) {
      if (status.value !== 'ready' || !model) return
      taps.value += 1
      say(pick(lines.pet.default), x, y - 46)
    }

    function doFeed() {
      if (status.value !== 'ready' || !model || !stageEl) return
      taps.value += 1
      const r = stageEl.getBoundingClientRect()
      const x0 = r.width / 2
      const y0 = r.height - 16
      const c = modelCenter()
      const x1 = c[0]
      const y1 = c[1] - model.height * baseScale * userScale * 0.2
      const id = performance.now() + Math.random()
      const emoji = SNACKS[Math.floor(Math.random() * SNACKS.length)]
      flyers.value = flyers.value.concat({ id, emoji, x0, y0, x1, y1 })
      setTimeout(() => {
        flyers.value = flyers.value.filter((f) => f.id !== id)
        triggerAnim('feed', 560)
        playMotion('feed')
        spawnFloater(x1, y1, '♥', '#ff5b7f')
        say(pick(lines.feed.default), x1, y1 - 46)
      }, 470)
    }

    // ---- 指针交互：点模型外=戳，点模型内可拖动，松手没移动=戳 ----
    function onPointerDown(e) {
      if (status.value !== 'ready' || !model || !stageEl) return
      const rect = stageEl.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const b = model.getBounds()
      const onModel = px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
      pointerDown = { px, py, mx: userX, my: userY, onModel, moved: false }
      if (onModel) stageEl.classList.add('dragging')
      stageEl.setPointerCapture?.(e.pointerId)
    }
    function onPointerMove(e) {
      if (!model || !stageEl) return
      const rect = stageEl.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      if (pointerDown) {
        if (Math.abs(px - pointerDown.px) > 4 || Math.abs(py - pointerDown.py) > 4) pointerDown.moved = true
        if (pointerDown.onModel) {
          userX = pointerDown.mx + (px - pointerDown.px)
          userY = pointerDown.my + (py - pointerDown.py)
        }
        return
      }
      // 未按下：在头顶区域「来回」晃动（需方向反转）才摸头，且只说话
      const part = hitPart(px, py)
      if (part === 'head' || part === 'face') {
        if (lastHover) {
          const dx = px - lastHover.x
          const dy = py - lastHover.y
          hoverDist += Math.hypot(dx, dy)
          const dir = Math.abs(dx) > Math.abs(dy) ? Math.sign(dx) : Math.sign(dy)
          if (dir !== 0 && hoverDir !== 0 && dir !== hoverDir) {
            wiggles += 1
            hoverDir = dir
          } else if (dir !== 0) {
            hoverDir = dir
          }
        }
        lastHover = { x: px, y: py }
        const now = performance.now()
        if (wiggles >= 1 && hoverDist > 30 && now > petCooldown) {
          petTalk(px, py)
          wiggles = 0
          hoverDist = 0
          petCooldown = now + 1100
        }
      } else {
        hoverDist = 0
        wiggles = 0
        hoverDir = 0
        lastHover = null
      }
    }
    function onPointerUp(e) {
      if (!pointerDown) return
      const moved = pointerDown.moved
      pointerDown = null
      if (stageEl) stageEl.classList.remove('dragging')
      if (!moved) {
        const rect = stageEl.getBoundingClientRect()
        doPoke(e.clientX - rect.left, e.clientY - rect.top)
      }
    }
    function onWheel(e) {
      if (status.value !== 'ready' || !model) return
      e.preventDefault()
      const next = userScale * (e.deltaY < 0 ? 1.1 : 0.9)
      userScale = Math.max(0.5, Math.min(2.5, next))
    }

    async function loadModel(url) {
      const PIXI = window.PIXI
      if (model) {
        try { app.stage.removeChild(model); model.destroy() } catch { /* ignore */ }
        model = null
      }
      userScale = 1
      userX = 0
      userY = 0
      anim = null
      status.value = 'loading'
      statusMsg.value = t.loading
      try {
        model = await PIXI.live2d.Live2DModel.from(url, { autoInteract: true })
        model.eventMode = 'static'
        model.rotation = 0
        app.stage.addChild(model)
        fitModel()
        status.value = 'ready'
        statusMsg.value = ''
      } catch (err) {
        status.value = 'error'
        statusMsg.value = t.modelFail + (err && err.message ? err.message : err)
      }
    }

    async function loadRelationship() {
      try {
        const res = await fetch('/api/life/companion')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        const rel = data.relationship || data.companion || data || {}
        const aff = typeof rel.affinity === 'number' ? rel.affinity
          : (typeof rel.score === 'number' ? rel.score : null)
        const stage = rel.stage || (rel.relationship && rel.relationship.stage) || null
        relationship.value = { affinity: aff, stage }
        relOk.value = (aff !== null || stage !== null)
      } catch {
        relOk.value = false
      }
    }

    async function init() {
      const PIXI = window.PIXI
      if (!PIXI || !PIXI.Application || !PIXI.live2d || !PIXI.live2d.Live2DModel) {
        status.value = 'error'
        statusMsg.value = t.needRuntime
        return
      }
      try {
        app = new PIXI.Application({
          backgroundAlpha: 0,
          antialias: true,
          resizeTo: stageEl,
          autoDensity: true,
          resolution: window.devicePixelRatio || 1,
        })
      } catch (err) {
        status.value = 'error'
        statusMsg.value = t.appFail + (err && err.message ? err.message : err)
        return
      }
      if (app.view) stageEl.appendChild(app.view)
      app.stage.eventMode = 'static'

      tickerFn = () => applyPose()
      app.ticker.add(tickerFn)

      try {
        const res = await fetch('/api/live2d')
        if (!res.ok) throw new Error('HTTP ' + res.status)
        const data = await res.json()
        models.value = Array.isArray(data.models) ? data.models : []
      } catch (err) {
        status.value = 'error'
        statusMsg.value = t.listFail + (err && err.message ? err.message : err)
        return
      }

      if (!models.value.length) {
        status.value = 'nolive2d'
        statusMsg.value = t.noModel
        return
      }
      await loadModel(models.value[current.value].url)
    }

    function onResize() { fitModel() }

    onMounted(() => {
      init()
      loadRelationship()
      window.addEventListener('resize', onResize)
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      if (stageEl) stageEl.addEventListener('wheel', onWheel, { passive: false })
    })
    onBeforeUnmount(() => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      if (stageEl) stageEl.removeEventListener('wheel', onWheel)
      if (bubbleTimer) clearTimeout(bubbleTimer)
      if (tickerFn && app) { try { app.ticker.remove(tickerFn) } catch { /* ignore */ } }
      if (model) { try { model.destroy() } catch { /* ignore */ } }
      if (app) { try { app.destroy(true, { children: true }) } catch { /* ignore */ } }
    })

    const statItem = (label, valueNode, hint, barPct) =>
      h('div', { class: 'poke-stat' }, [
        h('span', { class: 'poke-stat-label' }, label),
        h('span', { class: 'poke-stat-value' }, valueNode),
        hint ? h('div', { class: 'poke-stat-hint' }, hint) : null,
        typeof barPct === 'number'
          ? h('div', { class: 'poke-affinity' }, [ h('i', { style: 'width:' + barPct + '%' }) ])
          : null,
      ])

    const actBtn = (label, icon, on) =>
      h('button', { class: 'poke-act', onClick: on }, [
        h('span', { class: 'poke-act-ico' }, icon),
        h('span', {}, label),
      ])

    return () =>
      h('div', { class: 'poke' }, [
        h('header', { class: 'poke-head' }, [
          h('p', { class: 'poke-eyebrow' }, '0KAY · 互动间'),
          h('h1', {}, t.title),
          h('p', { class: 'poke-sub' }, t.sub),
        ]),

        h('div', { class: 'poke-stats' }, [
          statItem(
            t.relLabel,
            relOk.value && typeof relationship.value.affinity === 'number'
              ? [relationship.value.affinity.toFixed(2), relationship.value.stage ? h('small', {}, relationship.value.stage) : null]
              : '—',
            relOk.value ? t.relHint : t.relOffline,
            relPct.value,
          ),
          statItem(t.tapsLabel, [String(taps.value), h('small', {}, t.times)], null),
        ]),

        h('div', {
          class: 'poke-stage',
          ref: (el) => { stageEl = el },
          onPointerdown: onPointerDown,
        }, [
          status.value !== 'ready'
            ? h('div', { class: 'poke-overlay' }, statusMsg.value || t.loading)
            : null,
          bubble.value
            ? h('div', {
                class: 'poke-bubble',
                style: 'left:' + bubble.value.x + 'px;top:' + bubble.value.y + 'px',
              }, bubble.value.text)
            : null,
          ...floaters.value.map((f) =>
            h('span', { class: 'poke-floater', style: 'left:' + f.x + 'px;top:' + f.y + 'px;color:' + f.color }, f.emoji),
          ),
          ...flyers.value.map((f) =>
            h('span', {
              class: 'poke-fly',
              style: 'left:0;top:0;--x0:' + f.x0 + 'px;--y0:' + f.y0 + 'px;--x1:' + f.x1 + 'px;--y1:' + f.y1 + 'px',
            }, f.emoji),
          ),
        ]),

        h('div', { class: 'poke-actions' }, [
          actBtn(t.actPoke, '👆', () => { const c = modelCenter(); doPoke(c[0], c[1]) }),
          actBtn(t.actFeed, '🍪', doFeed),
          h('span', { class: 'poke-hint' }, t.dragHint),
        ]),

        models.value.length > 1
          ? h('div', { class: 'poke-models' }, models.value.map((m, i) =>
              h('button', {
                key: m.id || i,
                class: 'poke-chip' + (i === current.value ? ' on' : ''),
                onClick: () => { current.value = i; loadModel(m.url) },
              }, m.label || ('model ' + (i + 1))),
            ))
          : null,
      ])
  },
}
