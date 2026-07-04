import { io } from 'socket.io-client'

export function createAnalyticsClient() {
  let socket
  let publicStats = createEmptyStats()
  let developerStats = null
  let connection = 'connecting'
  const listeners = new Set()

  function connect() {
    if (socket) return socket

    const analyticsUrl = import.meta.env.VITE_ANALYTICS_URL || window.location.origin
    socket = io(analyticsUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 8,
    })

    socket.on('connect', () => {
      connection = 'live'
      notify()
      socket.emit('visitor:join', createVisitPayload())
    })

    socket.on('disconnect', () => {
      connection = 'offline'
      notify()
    })

    socket.on('connect_error', () => {
      connection = 'offline'
      notify()
    })

    socket.on('analytics:public', (payload) => {
      publicStats = normalizeStats(payload)
      updatePublicCounter(publicStats.activeCount)
      notify()
    })

    socket.on('analytics:dev', (payload) => {
      developerStats = payload
      notify()
    })

    const heartbeatTimer = window.setInterval(() => {
      socket.emit('visitor:heartbeat')
    }, 15000)

    const leave = () => {
      socket.emit('visitor:leave')
    }

    const heartbeatWhenVisible = () => {
      if (document.visibilityState === 'visible') {
        socket.emit('visitor:heartbeat')
      }
    }

    window.addEventListener('beforeunload', leave)
    document.addEventListener('visibilitychange', heartbeatWhenVisible)

    socket.on('disconnect', () => {
      window.clearInterval(heartbeatTimer)
      window.removeEventListener('beforeunload', leave)
      document.removeEventListener('visibilitychange', heartbeatWhenVisible)
    })

    return socket
  }

  async function authenticateDeveloper(token) {
    const activeSocket = connect()

    return new Promise((resolve) => {
      if (!activeSocket.connected) {
        activeSocket.once('connect', () => authenticateDeveloper(token).then(resolve))
        return
      }

      activeSocket.emit('developer:authenticate', { token }, (response) => {
        resolve(response || { ok: false, message: 'Server analytics tidak merespons.' })
      })
    })
  }

  function logoutDeveloper() {
    socket?.emit('developer:logout')
    developerStats = null
    notify()
  }

  function subscribe(callback) {
    listeners.add(callback)
    callback(getState())
    return () => listeners.delete(callback)
  }

  function getState() {
    return {
      stats: publicStats,
      developerStats,
      connection,
    }
  }

  function notify() {
    const state = getState()
    listeners.forEach((callback) => callback(state))
  }

  return {
    connect,
    authenticateDeveloper,
    logoutDeveloper,
    subscribe,
    getState,
  }
}

function createVisitPayload() {
  const visitorId = getStoredId(localStorage, 'ayoppg_visitor_id', 'visitor')
  const sessionId = getStoredId(sessionStorage, 'ayoppg_session_id', 'session')

  return {
    visitorId,
    sessionId,
    path: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    referrer: document.referrer || 'Direct',
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
  }
}

function getStoredId(storage, key, prefix) {
  try {
    const existing = storage.getItem(key)
    if (existing) return existing

    const nextId = `${prefix}_${createId()}`
    storage.setItem(key, nextId)
    return nextId
  } catch {
    return `${prefix}_${createId()}`
  }
}

function createId() {
  if ('randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function normalizeStats(payload = {}) {
  return {
    ...createEmptyStats(),
    ...payload,
    hourly: Array.isArray(payload.hourly) && payload.hourly.length ? payload.hourly : createEmptyStats().hourly,
  }
}

function createEmptyStats() {
  return {
    activeCount: 1,
    totalVisits: 0,
    uniqueVisitors: 0,
    updatedAt: new Date().toISOString(),
    hourly: Array.from({ length: 12 }, (_, index) => ({
      label: `${String(index).padStart(2, '0')}:00`,
      count: 0,
    })),
  }
}

function updatePublicCounter(count) {
  const counterEl = document.getElementById('live-users-count')
  if (!counterEl) return

  counterEl.textContent = String(count)
  counterEl.style.transform = 'scale(1.15)'
  counterEl.style.color = 'var(--success)'
  counterEl.style.transition = 'all 0.2s ease'

  window.setTimeout(() => {
    counterEl.style.transform = 'scale(1)'
    counterEl.style.color = ''
  }, 200)
}
