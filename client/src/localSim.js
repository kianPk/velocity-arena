/** Offline arena simulation for GitHub Pages (no Socket.IO server). */

const ARENA = { w: 1280, h: 720 }

function uid() {
  return Math.random().toString(36).slice(2, 10)
}

function spawnPlayer(id, name, bot = false) {
  const angle = Math.random() * Math.PI * 2
  return {
    id,
    name,
    x: ARENA.w / 2 + Math.cos(angle) * 200,
    y: ARENA.h / 2 + Math.sin(angle) * 140,
    vx: 0,
    vy: 0,
    angle: angle + Math.PI,
    hp: 100,
    score: 0,
    color: bot
      ? `hsl(${180 + Math.floor(Math.random() * 80)} 70% 60%)`
      : '#3dffa8',
    input: { up: false, down: false, left: false, right: false, fire: false },
    cooldown: 0,
    alive: true,
    bot,
    respawn: 0,
  }
}

function spawnOrb(orbs) {
  orbs.push({
    id: uid(),
    x: 80 + Math.random() * (ARENA.w - 160),
    y: 80 + Math.random() * (ARENA.h - 160),
    r: 10 + Math.random() * 6,
    worth: 1,
  })
}

export function createLocalSim(playerName = 'You') {
  const me = spawnPlayer('local', playerName, false)
  const players = { [me.id]: me }
  for (let i = 0; i < 3; i++) {
    const b = spawnPlayer('bot_' + i, 'CPU-' + (i + 1), true)
    players[b.id] = b
  }
  const orbs = []
  for (let i = 0; i < 18; i++) spawnOrb(orbs)
  const bullets = []

  function botThink(p) {
    const nearestOrb = orbs.reduce((best, o) => {
      const d = (o.x - p.x) ** 2 + (o.y - p.y) ** 2
      return !best || d < best.d ? { o, d } : best
    }, null)
    const foe = Object.values(players)
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
  }

  function step(dt) {
    for (const p of Object.values(players)) {
      if (!p.alive) {
        p.respawn -= dt
        if (p.respawn <= 0) {
          const fresh = spawnPlayer(p.id, p.name, p.bot)
          fresh.color = p.color
          fresh.score = p.score
          players[p.id] = fresh
        }
        continue
      }
      if (p.bot) botThink(p)
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
        bullets.push({
          id: uid(),
          owner: p.id,
          x: p.x + Math.cos(p.angle) * 22,
          y: p.y + Math.sin(p.angle) * 22,
          vx: Math.cos(p.angle) * 640 + p.vx * 0.2,
          vy: Math.sin(p.angle) * 640 + p.vy * 0.2,
          life: 1.1,
        })
      }

      for (let i = orbs.length - 1; i >= 0; i--) {
        const o = orbs[i]
        if ((o.x - p.x) ** 2 + (o.y - p.y) ** 2 < (o.r + 16) ** 2) {
          p.score += o.worth
          orbs.splice(i, 1)
          spawnOrb(orbs)
        }
      }
    }

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i]
      b.life -= dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > ARENA.w || b.y > ARENA.h) {
        bullets.splice(i, 1)
        continue
      }
      for (const p of Object.values(players)) {
        if (!p.alive || p.id === b.owner) continue
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 < 20 ** 2) {
          p.hp -= 18
          bullets.splice(i, 1)
          if (p.hp <= 0) {
            p.alive = false
            p.respawn = 2.2
            const killer = players[b.owner]
            if (killer) killer.score += 5
          }
          break
        }
      }
    }
  }

  return {
    arena: ARENA,
    get me() {
      return players.local
    },
    setInput(input) {
      if (players.local) players.local.input = { ...players.local.input, ...input }
    },
    tick(dt) {
      step(dt)
      return {
        t: Date.now(),
        arena: ARENA,
        players: Object.values(players).map((p) => ({
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
        orbs: orbs.map((o) => ({ ...o })),
        bullets: bullets.map((b) => ({ id: b.id, x: b.x, y: b.y, owner: b.owner })),
      }
    },
  }
}
