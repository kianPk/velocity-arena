<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { io } from 'socket.io-client'
import { createLocalSim } from './localSim'

const canvasRef = ref(null)
const name = ref('Pilot')
const phase = ref('menu') // menu | playing
const mode = ref('local') // local | online
const hud = ref({ score: 0, hp: 100, rank: 1, players: 0, status: 'Ready' })
const leaderboard = ref([])

let raf = 0
let sim = null
let socket = null
let myId = 'local'
let snapshot = null
let keys = { up: false, down: false, left: false, right: false, fire: false }
let particles = []
let lastTs = 0
let shake = 0

function onKey(e, down) {
  const k = e.key.toLowerCase()
  if (['arrowup', 'w'].includes(k)) keys.up = down
  if (['arrowdown', 's'].includes(k)) keys.down = down
  if (['arrowleft', 'a'].includes(k)) keys.left = down
  if (['arrowright', 'd'].includes(k)) keys.right = down
  if (k === ' ' || k === 'j') {
    keys.fire = down
    e.preventDefault()
  }
}

function spawnBurst(x, y, color) {
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2
    const sp = 40 + Math.random() * 120
    particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 0.4 + Math.random() * 0.35,
      color,
    })
  }
}

function draw(ctx, state) {
  const { w, h } = state.arena
  const canvas = ctx.canvas
  const scale = Math.min(canvas.clientWidth / w, canvas.clientHeight / h)
  const ow = w * scale
  const oh = h * scale
  const ox = (canvas.clientWidth - ow) / 2
  const oy = (canvas.clientHeight - oh) / 2

  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#070b12'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const sx = shake ? (Math.random() - 0.5) * shake : 0
  const sy = shake ? (Math.random() - 0.5) * shake : 0
  ctx.setTransform(scale, 0, 0, scale, ox + sx, oy + sy)

  // arena grid
  ctx.strokeStyle = 'rgba(126,200,255,0.06)'
  ctx.lineWidth = 1
  for (let x = 0; x <= w; x += 64) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
    ctx.stroke()
  }
  for (let y = 0; y <= h; y += 64) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  ctx.strokeStyle = 'rgba(61,255,168,0.35)'
  ctx.lineWidth = 3
  ctx.strokeRect(2, 2, w - 4, h - 4)

  // orbs
  for (const o of state.orbs) {
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 2)
    g.addColorStop(0, 'rgba(126,200,255,0.95)')
    g.addColorStop(1, 'rgba(126,200,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(o.x, o.y, o.r * 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#cfe9ff'
    ctx.beginPath()
    ctx.arc(o.x, o.y, o.r * 0.55, 0, Math.PI * 2)
    ctx.fill()
  }

  // bullets
  for (const b of state.bullets) {
    ctx.fillStyle = '#3dffa8'
    ctx.shadowColor = '#3dffa8'
    ctx.shadowBlur = 12
    ctx.beginPath()
    ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
  }

  // ships
  for (const p of state.players) {
    if (!p.alive) continue
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(p.angle)
    ctx.fillStyle = p.color
    ctx.shadowColor = p.color
    ctx.shadowBlur = 16
    ctx.beginPath()
    ctx.moveTo(18, 0)
    ctx.lineTo(-12, 11)
    ctx.lineTo(-7, 0)
    ctx.lineTo(-12, -11)
    ctx.closePath()
    ctx.fill()
    ctx.shadowBlur = 0
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath()
    ctx.arc(2, 0, 3, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // name + hp
    ctx.fillStyle = 'rgba(232,240,255,0.75)'
    ctx.font = '12px Space Grotesk'
    ctx.textAlign = 'center'
    ctx.fillText(p.name, p.x, p.y - 28)
    ctx.fillStyle = 'rgba(20,30,45,0.8)'
    ctx.fillRect(p.x - 18, p.y + 22, 36, 4)
    ctx.fillStyle = p.hp > 40 ? '#3dffa8' : '#ff6b7a'
    ctx.fillRect(p.x - 18, p.y + 22, 36 * (p.hp / 100), 4)
  }

  // particles in arena space
  for (const pt of particles) {
    ctx.globalAlpha = Math.max(0, pt.life)
    ctx.fillStyle = pt.color
    ctx.beginPath()
    ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
}

function updateHud(state) {
  const me = state.players.find((p) => p.id === myId)
  const sorted = [...state.players].sort((a, b) => b.score - a.score)
  leaderboard.value = sorted.slice(0, 5)
  if (me) {
    hud.value = {
      score: me.score,
      hp: Math.max(0, Math.round(me.hp)),
      rank: sorted.findIndex((p) => p.id === myId) + 1,
      players: state.players.length,
      status: me.alive ? (mode.value === 'online' ? 'Online' : 'Local arena') : 'Respawning…',
    }
  }
}

function frame(ts) {
  raf = requestAnimationFrame(frame)
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  if (canvas.width !== canvas.clientWidth * dpr || canvas.height !== canvas.clientHeight * dpr) {
    canvas.width = canvas.clientWidth * dpr
    canvas.height = canvas.clientHeight * dpr
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016
  lastTs = ts

  if (mode.value === 'local' && sim) {
    sim.setInput(keys)
    const prevHp = snapshot?.players?.find((p) => p.id === myId)?.hp
    snapshot = sim.tick(dt)
    const me = snapshot.players.find((p) => p.id === myId)
    if (me && prevHp != null && me.hp < prevHp) {
      shake = 8
      spawnBurst(me.x, me.y, me.color)
    }
  } else if (socket) {
    socket.emit('input', keys)
  }

  shake = Math.max(0, shake - dt * 30)
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]
    p.life -= dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    if (p.life <= 0) particles.splice(i, 1)
  }

  if (snapshot) {
    draw(ctx, snapshot)
    updateHud(snapshot)
  }
}

function startLocal() {
  cleanupNet()
  mode.value = 'local'
  myId = 'local'
  sim = createLocalSim(name.value.trim() || 'You')
  snapshot = sim.tick(0)
  phase.value = 'playing'
  lastTs = 0
}

function startOnline() {
  cleanupNet()
  mode.value = 'online'
  phase.value = 'playing'
  hud.value.status = 'Connecting…'
  const url = import.meta.env.VITE_SOCKET_URL || undefined
  socket = io(url, { transports: ['websocket', 'polling'] })
  socket.on('connect', () => {
    socket.emit('join', { name: name.value.trim() || 'Pilot' })
  })
  socket.on('welcome', (msg) => {
    myId = msg.id
    hud.value.status = 'Online'
  })
  socket.on('state', (s) => {
    const prev = snapshot?.players?.find((p) => p.id === myId)
    snapshot = s
    const me = s.players.find((p) => p.id === myId)
    if (me && prev && me.hp < prev.hp) {
      shake = 8
      spawnBurst(me.x, me.y, me.color)
    }
  })
  socket.on('connect_error', () => {
    hud.value.status = 'Server offline — switching to local'
    startLocal()
  })
  socket.on('full', () => {
    hud.value.status = 'Arena full'
  })
}

function cleanupNet() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
  sim = null
}

function backMenu() {
  phase.value = 'menu'
  cleanupNet()
}

onMounted(() => {
  window.addEventListener('keydown', (e) => onKey(e, true))
  window.addEventListener('keyup', (e) => onKey(e, false))
  raf = requestAnimationFrame(frame)
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  cleanupNet()
  window.removeEventListener('keydown', (e) => onKey(e, true))
  window.removeEventListener('keyup', (e) => onKey(e, false))
})

const controls = computed(() => 'WASD / Arrows move · Space / J fire')
</script>

<template>
  <div class="page">
    <header class="top">
      <div class="brand">
        <div class="mark" aria-hidden="true" />
        <div>
          <h1>Velocity Arena</h1>
          <p>Realtime dogfight · collect orbs · outscore the field</p>
        </div>
      </div>
      <div v-if="phase === 'playing'" class="hud">
        <div><b>{{ hud.score }}</b><span>Score</span></div>
        <div><b>{{ hud.hp }}</b><span>Hull</span></div>
        <div><b>#{{ hud.rank }}</b><span>Rank</span></div>
        <div><b>{{ hud.players }}</b><span>Ships</span></div>
      </div>
    </header>

    <section class="stage">
      <canvas ref="canvasRef" class="view" />

      <div v-if="phase === 'menu'" class="overlay">
        <div class="panel">
          <h2>Enter the arena</h2>
          <p>Original multiplayer dogfight — local bots on Pages, Socket.IO when the Node server is up.</p>
          <label>
            Callsign
            <input v-model="name" maxlength="16" placeholder="Pilot" />
          </label>
          <div class="actions">
            <button class="primary" type="button" @click="startLocal">Play now</button>
            <button class="ghost" type="button" @click="startOnline">Join online</button>
          </div>
          <p class="hint">{{ controls }}</p>
        </div>
      </div>

      <aside v-if="phase === 'playing'" class="side">
        <div class="status">{{ hud.status }}</div>
        <ol>
          <li v-for="(p, i) in leaderboard" :key="p.id" :class="{ me: p.id === 'local' || p.id === myId }">
            <span>{{ i + 1 }}. {{ p.name }}</span>
            <b>{{ p.score }}</b>
          </li>
        </ol>
        <button class="ghost" type="button" @click="backMenu">Leave</button>
      </aside>
    </section>
  </div>
</template>

<style scoped>
.page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 18px clamp(14px, 3vw, 28px) 24px;
  gap: 14px;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  align-items: center;
}
.brand {
  display: flex;
  gap: 14px;
  align-items: center;
}
.mark {
  width: 46px;
  height: 46px;
  border-radius: 14px;
  background:
    linear-gradient(145deg, rgba(61, 255, 168, 0.25), transparent 55%),
    linear-gradient(180deg, #122033, #0a121c);
  border: 1px solid rgba(61, 255, 168, 0.35);
  position: relative;
}
.mark::before {
  content: '';
  position: absolute;
  inset: 12px 14px 14px 14px;
  background: var(--mint);
  clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
  animation: pulse 2.4s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    opacity: 0.85;
    transform: translateY(0);
  }
  50% {
    opacity: 1;
    transform: translateY(-1px);
  }
}
h1 {
  margin: 0;
  font-family: var(--display);
  font-size: clamp(1.2rem, 2.4vw, 1.55rem);
  letter-spacing: 0.04em;
}
.brand p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 0.9rem;
}
.hud {
  display: flex;
  gap: 8px;
}
.hud div {
  min-width: 70px;
  padding: 8px 10px;
  border-radius: 12px;
  background: rgba(13, 20, 32, 0.9);
  border: 1px solid var(--line);
  display: grid;
}
.hud b {
  font-family: var(--display);
  font-size: 1rem;
}
.hud span {
  font-size: 0.68rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.stage {
  position: relative;
  flex: 1;
  min-height: min(72vh, 720px);
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--line);
  background: #05080f;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
}
.view {
  width: 100%;
  height: 100%;
  display: block;
  min-height: min(72vh, 720px);
}
.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 40%, rgba(61, 255, 168, 0.08), rgba(5, 8, 15, 0.82));
  animation: fadeIn 0.4s ease;
}
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.panel {
  width: min(420px, 92%);
  padding: 28px 24px;
  border-radius: 18px;
  background: rgba(13, 20, 32, 0.94);
  border: 1px solid rgba(61, 255, 168, 0.25);
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  animation: rise 0.45s ease;
}
@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.panel h2 {
  margin: 0 0 8px;
  font-family: var(--display);
  letter-spacing: 0.03em;
}
.panel > p {
  margin: 0 0 18px;
  color: var(--muted);
  line-height: 1.45;
  font-size: 0.92rem;
}
label {
  display: grid;
  gap: 6px;
  font-size: 0.8rem;
  color: var(--muted);
  margin-bottom: 16px;
}
input {
  padding: 11px 12px;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #070b12;
  outline: none;
}
input:focus {
  border-color: rgba(61, 255, 168, 0.5);
  box-shadow: 0 0 0 3px rgba(61, 255, 168, 0.12);
}
.actions {
  display: grid;
  gap: 8px;
}
.primary,
.ghost {
  padding: 12px 14px;
  border-radius: 10px;
  font-weight: 600;
}
.primary {
  background: linear-gradient(180deg, #63ffb8, #1fb87a);
  color: #04140e;
}
.ghost {
  border: 1px solid var(--line);
  color: var(--text);
  background: rgba(255, 255, 255, 0.02);
}
.hint {
  margin: 14px 0 0;
  color: var(--muted);
  font-size: 0.78rem;
}
.side {
  position: absolute;
  top: 14px;
  right: 14px;
  width: min(200px, 46vw);
  padding: 12px;
  border-radius: 14px;
  background: rgba(7, 11, 18, 0.82);
  border: 1px solid var(--line);
  backdrop-filter: blur(8px);
  display: grid;
  gap: 10px;
}
.status {
  font-size: 0.75rem;
  color: var(--mint);
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
ol {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}
li {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 0.82rem;
  color: var(--muted);
}
li.me {
  color: var(--mint);
}
li b {
  font-family: var(--display);
  font-size: 0.78rem;
}
@media (max-width: 700px) {
  .side {
    top: auto;
    bottom: 12px;
    right: 12px;
    left: 12px;
    width: auto;
  }
  .hud {
    width: 100%;
  }
  .hud div {
    flex: 1;
  }
}
</style>
