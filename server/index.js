import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { randomUUID } from 'crypto'

const PORT = process.env.PORT || 8790
const TICK_MS = 1000 / 60
const ARENA = { w: 1280, h: 720 }
const MAX_PLAYERS = 8

const app = express()
app.use(cors())
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'velocity-arena' }))

const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: '*' } })

/** @type {Map<string, import('socket.io').Socket>} */
const sockets = new Map()

const state = {
  players: /** @type {Record<string, any>} */ ({}),
  orbs: [],
  bullets: [],
  scores: {},
  startedAt: Date.now(),
}

function spawnOrb() {
  state.orbs.push({
    id: randomUUID().slice(0, 8),
    x: 80 + Math.random() * (ARENA.w - 160),
    y: 80 + Math.random() * (ARENA.h - 160),
    r: 10 + Math.random() * 6,
    worth: 1,
  })
}

function resetOrbs() {
  state.orbs = []
  for (let i = 0; i < 18; i++) spawnOrb()
}
resetOrbs()

function spawnPlayer(id, name) {
  const angle = Math.random() * Math.PI * 2
  return {
    id,
    name: (name || 'Pilot').slice(0, 16),
    x: ARENA.w / 2 + Math.cos(angle) * 180,
    y: ARENA.h / 2 + Math.sin(angle) * 120,
    vx: 0,
    vy: 0,
    angle: angle + Math.PI,
    hp: 100,
    score: 0,
    color: `hsl(${Math.floor(Math.random() * 360)} 70% 58%)`,
    input: { up: false, down: false, left: false, right: false, fire: false },
    cooldown: 0,
    alive: true,
    bot: false,
  }
}

function ensureBots() {
  const humans = Object.values(state.players).filter((p) => !p.bot).length
  const bots = Object.values(state.players).filter((p) => p.bot)
  const want = humans === 0 ? 3 : Math.max(0, 2 - (Object.keys(state.players).length - bots.length > 1 ? 0 : 0))
  // Keep 2–3 bots when few humans so the arena feels alive
  const targetBots = humans <= 1 ? 3 : humans === 2 ? 2 : 1
  while (bots.length > targetBots) {
    const b = bots.pop()
    delete state.players[b.id]
  }
  while (Object.values(state.players).filter((p) => p.bot).length < targetBots) {
    const id = 'bot_' + randomUUID().slice(0, 6)
    const p = spawnPlayer(id, 'CPU-' + id.slice(-3).toUpperCase())
    p.bot = true
    state.players[id] = p
  }
}

function botThink(p, dt) {
  const nearestOrb = state.orbs.reduce(
    (best, o) => {
      const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2
      return !best || d < best.d ? { o, d } : best
    },
    null,
  )
  const foe = Object.values(state.players)
    .filter((o) => o.id !== p.id && o.alive)
    .reduce((best, o) => {
      const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2
      return !best || d < best.d ? { o, d } : best
    }, null)

  let tx = ARENA.w / 2
  let ty = ARENA.h / 2
  if (foe && foe.d < 280 ** 2 && p.hp > 35) {
    tx = foe.o.x
    ty = foe.o.y
    p.input.fire = foe.d < 420 ** 2
  } else if (nearestOrb) {
    tx = nearestOrb.o.x
    ty = nearestOrb.o.y
    p.input.fire = false
  }
  const desired = Math.atan2(ty - p.y, tx - p.x)
  let diff = desired - p.angle
  while (diff > Math.PI) diff -= Math.PI * 2
  while (diff < -Math.PI) diff += Math.PI * 2
  p.input.left = diff < -0.08
  p.input.right = diff > 0.08
  p.input.up = Math.abs(diff) < 0.6
  p.input.down = false
}

function step(dt) {
  ensureBots()
  for (const p of Object.values(state.players)) {
    if (!p.alive) {
      p.respawn = (p.respawn || 0) - dt
      if (p.respawn <= 0) {
        const fresh = spawnPlayer(p.id, p.name)
        fresh.color = p.color
        fresh.score = p.score
        fresh.bot = p.bot
        state.players[p.id] = fresh
      }
      continue
    }
    if (p.bot) botThink(p, dt)

    const turn = (p.input.left ? -1 : 0) + (p.input.right ? 1 : 0)
    p.angle += turn * 3.2 * dt
    const thrust = (p.input.up ? 1 : 0) + (p.input.down ? -0.45 : 0)
    p.vx += Math.cos(p.angle) * thrust * 520 * dt
    p.vy += Math.sin(p.angle) * thrust * 520 * dt
    p.vx *= 0.985
    p.vy *= 0.985
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.x = Math.max(24, Math.min(ARENA.w - 24, p.x))
    p.y = Math.max(24, Math.min(ARENA.h - 24, p.y))
    if (p.x <= 24 || p.x >= ARENA.w - 24) p.vx *= -0.4
    if (p.y <= 24 || p.y >= ARENA.h - 24) p.vy *= -0.4

    p.cooldown = Math.max(0, p.cooldown - dt)
    if (p.input.fire && p.cooldown <= 0) {
      p.cooldown = 0.22
      state.bullets.push({
        id: randomUUID().slice(0, 8),
        owner: p.id,
        x: p.x + Math.cos(p.angle) * 22,
        y: p.y + Math.sin(p.angle) * 22,
        vx: Math.cos(p.angle) * 640 + p.vx * 0.2,
        vy: Math.sin(p.angle) * 640 + p.vy * 0.2,
        life: 1.1,
      })
    }

    for (let i = state.orbs.length - 1; i >= 0; i--) {
      const o = state.orbs[i]
      if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 < (o.r + 16) ** 2) {
        p.score += o.worth
        state.orbs.splice(i, 1)
        spawnOrb()
      }
    }
  }

  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i]
    b.life -= dt
    b.x += b.vx * dt
    b.y += b.vy * dt
    if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > ARENA.w || b.y > ARENA.h) {
      state.bullets.splice(i, 1)
      continue
    }
    for (const p of Object.values(state.players)) {
      if (!p.alive || p.id === b.owner) continue
      if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < 20 ** 2) {
        p.hp -= 18
        state.bullets.splice(i, 1)
        if (p.hp <= 0) {
          p.alive = false
          p.respawn = 2.2
          const killer = state.players[b.owner]
          if (killer) killer.score += 5
        }
        break
      }
    }
  }
}

let last = Date.now()
setInterval(() => {
  const now = Date.now()
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  step(dt)
  const snapshot = {
    t: now,
    arena: ARENA,
    players: Object.values(state.players).map((p) => ({
      id: p.id,
      name: p.name,
      x: p.x,
      y: p.y,
      angle: p.angle,
      hp: p.hp,
      score: p.score,
      color: p.color,
      alive: p.alive,
      bot: p.bot,
    })),
    orbs: state.orbs,
    bullets: state.bullets.map((b) => ({ id: b.id, x: b.x, y: b.y, owner: b.owner })),
  }
  io.emit('state', snapshot)
}, TICK_MS)

io.on('connection', (socket) => {
  if (Object.values(state.players).filter((p) => !p.bot).length >= MAX_PLAYERS) {
    socket.emit('full')
    socket.disconnect(true)
    return
  }
  sockets.set(socket.id, socket)
  let player = null

  socket.on('join', (payload = {}) => {
    player = spawnPlayer(socket.id, payload.name)
    state.players[socket.id] = player
    socket.emit('welcome', { id: socket.id, arena: ARENA })
  })

  socket.on('input', (input) => {
    const p = state.players[socket.id]
    if (!p || p.bot) return
    p.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      fire: !!input.fire,
    }
  })

  socket.on('disconnect', () => {
    sockets.delete(socket.id)
    delete state.players[socket.id]
  })
})

httpServer.listen(PORT, () => console.log(`velocity-arena on :${PORT}`))
