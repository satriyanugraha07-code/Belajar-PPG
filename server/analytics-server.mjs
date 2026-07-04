import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { Server } from 'socket.io'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const dataDir = path.join(__dirname, 'data')
const dataFile = path.join(dataDir, 'visits.json')
const distDir = path.join(projectRoot, 'dist')

const PORT = Number(process.env.PORT || 4100)
const DEV_TOKEN =
  process.env.DEV_TOKEN || (process.env.NODE_ENV === 'production' ? '' : 'dev-mode-local')
const IP_SALT = process.env.IP_SALT || 'ayoppg-visitors'
const MAX_HISTORY = 5000
const ACTIVE_TIMEOUT_MS = 45_000
const SESSION_REUSE_MS = 10 * 60_000

fs.mkdirSync(dataDir, { recursive: true })

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true,
  },
})

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())

let visits = readVisits()
let persistTimer

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, updatedAt: new Date().toISOString() })
})

app.get('/api/analytics/public', (_req, res) => {
  res.json(getPublicSummary())
})

app.get('/api/analytics/history', requireDeveloper, (_req, res) => {
  res.json(getDeveloperSummary())
})

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

io.on('connection', (socket) => {
  socket.emit('analytics:public', getPublicSummary())

  socket.on('visitor:join', (payload = {}) => {
    const visit = upsertVisit(socket, payload)
    socket.data.visitId = visit.id
    publishStats()
  })

  socket.on('visitor:heartbeat', () => {
    if (touchVisit(socket)) {
      publishDeveloperStats()
    }
  })

  socket.on('visitor:leave', () => {
    if (closeVisit(socket, 'left')) {
      publishStats()
    }
  })

  socket.on('developer:authenticate', (payload = {}, callback) => {
    if (!isDeveloperToken(payload.token)) {
      callback?.({ ok: false, message: 'Token developer tidak valid.' })
      return
    }

    socket.join('developers')
    callback?.({ ok: true })
    socket.emit('analytics:dev', getDeveloperSummary())
  })

  socket.on('developer:logout', () => {
    socket.leave('developers')
  })

  socket.on('disconnect', () => {
    if (closeVisit(socket, 'disconnected')) {
      publishStats()
    }
  })
})

setInterval(() => {
  if (expireStaleVisits()) {
    publishStats()
  }
}, 15_000)

server.listen(PORT, () => {
  console.log(`AyoPPG analytics server: http://127.0.0.1:${PORT}`)
  console.log(`Developer access: ${DEV_TOKEN ? 'configured' : 'not configured'}`)
})

function readVisits() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(-MAX_HISTORY).map((visit) => ({
      ...visit,
      status: visit.status === 'active' ? 'ended' : visit.status || 'ended',
      currentSocketId: undefined,
    }))
  } catch {
    return []
  }
}

function schedulePersist() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    const safeVisits = visits
      .slice(-MAX_HISTORY)
      .map(({ currentSocketId: _currentSocketId, ...visit }) => visit)
    fs.writeFileSync(dataFile, JSON.stringify(safeVisits, null, 2))
  }, 250)
}

function upsertVisit(socket, payload) {
  const now = new Date().toISOString()
  const visitorId = safeText(payload.visitorId, `visitor_${crypto.randomUUID()}`, 96)
  const sessionId = safeText(payload.sessionId, `session_${crypto.randomUUID()}`, 96)
  const existing = [...visits]
    .reverse()
    .find(
      (visit) =>
        visit.sessionId === sessionId &&
        Date.now() - Date.parse(visit.startedAt) < SESSION_REUSE_MS,
    )

  const metadata = getVisitMetadata(socket, payload)
  const visit =
    existing ||
    {
      id: `visit_${crypto.randomUUID()}`,
      visitorId,
      sessionId,
      startedAt: now,
      ipHash: hashValue(getIp(socket)),
      ...metadata,
    }

  Object.assign(visit, {
    ...metadata,
    visitorId,
    sessionId,
    lastSeenAt: now,
    endedAt: null,
    status: 'active',
    currentSocketId: socket.id,
  })

  if (!existing) {
    visits.push(visit)
  }

  trimHistory()
  schedulePersist()
  return visit
}

function getVisitMetadata(socket, payload) {
  const userAgent = safeText(socket.handshake.headers['user-agent'], 'Unknown', 320)
  const screen = normalizeScreen(payload.screen)

  return {
    path: safeText(payload.path, '/', 180),
    referrer: safeText(payload.referrer, 'Direct', 240) || 'Direct',
    language: safeText(payload.language, 'Unknown', 40),
    timezone: safeText(payload.timezone, 'Unknown', 80),
    screen,
    device: getDeviceType(screen.width),
    browser: getBrowser(userAgent),
    os: getOperatingSystem(userAgent),
    userAgent,
  }
}

function touchVisit(socket) {
  const visit = findVisitBySocket(socket)
  if (!visit) return false

  visit.lastSeenAt = new Date().toISOString()
  visit.status = 'active'
  schedulePersist()
  return true
}

function closeVisit(socket, reason) {
  const visit = findVisitBySocket(socket)
  if (!visit || visit.currentSocketId !== socket.id) return false

  const now = new Date().toISOString()
  visit.lastSeenAt = now
  visit.endedAt = now
  visit.status = reason
  visit.currentSocketId = undefined
  schedulePersist()
  return true
}

function findVisitBySocket(socket) {
  const visitId = socket.data.visitId
  if (!visitId) return null
  return visits.find((visit) => visit.id === visitId) || null
}

function expireStaleVisits() {
  let changed = false
  const now = Date.now()

  for (const visit of visits) {
    if (visit.status !== 'active') continue
    if (now - Date.parse(visit.lastSeenAt) <= ACTIVE_TIMEOUT_MS) continue

    visit.endedAt = visit.lastSeenAt
    visit.status = 'timeout'
    visit.currentSocketId = undefined
    changed = true
  }

  if (changed) {
    schedulePersist()
  }

  return changed
}

function publishStats() {
  io.emit('analytics:public', getPublicSummary())
  publishDeveloperStats()
}

function publishDeveloperStats() {
  io.to('developers').emit('analytics:dev', getDeveloperSummary())
}

function getPublicSummary() {
  expireStaleVisits()

  const activeVisits = getActiveVisits()
  return {
    activeCount: activeVisits.length,
    totalVisits: visits.length,
    uniqueVisitors: new Set(visits.map((visit) => visit.visitorId)).size,
    updatedAt: new Date().toISOString(),
    hourly: getHourlyBuckets(12),
  }
}

function getDeveloperSummary() {
  return {
    ...getPublicSummary(),
    maxHistory: MAX_HISTORY,
    recentVisitors: visits
      .slice(-100)
      .reverse()
      .map((visit) => ({
        id: visit.id,
        visitorId: shortId(visit.visitorId),
        sessionId: shortId(visit.sessionId),
        startedAt: visit.startedAt,
        lastSeenAt: visit.lastSeenAt,
        endedAt: visit.endedAt,
        durationMs: getDurationMs(visit),
        status: visit.status,
        path: visit.path,
        referrer: visit.referrer,
        language: visit.language,
        timezone: visit.timezone,
        screen: visit.screen,
        device: visit.device,
        browser: visit.browser,
        os: visit.os,
        ipHash: visit.ipHash,
      })),
  }
}

function getActiveVisits() {
  const now = Date.now()
  return visits.filter(
    (visit) =>
      visit.status === 'active' && now - Date.parse(visit.lastSeenAt) <= ACTIVE_TIMEOUT_MS,
  )
}

function getHourlyBuckets(hours) {
  const now = new Date()
  const buckets = []

  for (let index = hours - 1; index >= 0; index -= 1) {
    const start = new Date(now)
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() - index)
    const end = new Date(start)
    end.setHours(end.getHours() + 1)

    buckets.push({
      label: start.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }),
      count: visits.filter((visit) => {
        const startedAt = Date.parse(visit.startedAt)
        return startedAt >= start.getTime() && startedAt < end.getTime()
      }).length,
    })
  }

  return buckets
}

function requireDeveloper(req, res, next) {
  const token = req.header('x-dev-token') || req.query.token
  if (!isDeveloperToken(token)) {
    res.status(401).json({ message: 'Token developer tidak valid.' })
    return
  }

  next()
}

function isDeveloperToken(token) {
  return typeof token === 'string' && token.length > 0 && token === DEV_TOKEN
}

function trimHistory() {
  if (visits.length <= MAX_HISTORY) return
  visits = visits.slice(-MAX_HISTORY)
}

function getIp(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }

  return socket.handshake.address || 'unknown'
}

function hashValue(value) {
  return crypto.createHash('sha256').update(`${IP_SALT}:${value}`).digest('hex').slice(0, 12)
}

function safeText(value, fallback = '', maxLength = 120) {
  if (typeof value !== 'string') return fallback
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length > 0 ? clean.slice(0, maxLength) : fallback
}

function normalizeScreen(value) {
  const width = Number(value?.width)
  const height = Number(value?.height)
  return {
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0,
  }
}

function getDeviceType(width) {
  if (!width) return 'Unknown'
  if (width < 768) return 'Mobile'
  if (width < 1100) return 'Tablet'
  return 'Desktop'
}

function getBrowser(userAgent) {
  if (/Edg\//.test(userAgent)) return 'Edge'
  if (/OPR\//.test(userAgent)) return 'Opera'
  if (/Firefox\//.test(userAgent)) return 'Firefox'
  if (/Chrome\//.test(userAgent)) return 'Chrome'
  if (/Safari\//.test(userAgent)) return 'Safari'
  return 'Unknown'
}

function getOperatingSystem(userAgent) {
  if (/Windows/i.test(userAgent)) return 'Windows'
  if (/Mac OS X/i.test(userAgent)) return 'macOS'
  if (/Android/i.test(userAgent)) return 'Android'
  if (/iPhone|iPad/i.test(userAgent)) return 'iOS'
  if (/Linux/i.test(userAgent)) return 'Linux'
  return 'Unknown'
}

function getDurationMs(visit) {
  const end = Date.parse(visit.endedAt || visit.lastSeenAt || visit.startedAt)
  const start = Date.parse(visit.startedAt)
  if (!Number.isFinite(end) || !Number.isFinite(start)) return 0
  return Math.max(0, end - start)
}

function shortId(value) {
  return String(value || '').replace(/^(visitor|session)_/, '').slice(0, 8)
}
