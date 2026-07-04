import { animate, stagger } from 'motion'

export function renderDeveloperDashboard(analytics) {
  document.body.innerHTML = `
    <main class="developer-page">
      <header class="developer-topbar">
        <a class="developer-brand" href="/">
          <span class="developer-brand-icon">AP</span>
          <span>AyoPPG Developer</span>
        </a>
        <div class="developer-topbar-actions">
          <span class="developer-status" data-status="connecting">Sync</span>
          <a class="developer-web-link" href="/">Buka Web</a>
        </div>
      </header>

      <section class="developer-hero">
        <div>
          <p class="developer-kicker">Realtime visitor history</p>
          <h1>Riwayat Pengunjung AyoPPG</h1>
          <p>Mode ini menampilkan jumlah pengunjung aktif dan rekam kunjungan yang pernah masuk ke situs.</p>
        </div>
        <div class="developer-live-card">
          <span class="developer-live-label">Aktif sekarang</span>
          <strong id="dev-active-count">0</strong>
          <span id="dev-updated-at">-</span>
        </div>
      </section>

      <section class="developer-login-panel" id="developer-login-panel">
        <form id="developer-login-form">
          <label for="developer-token">Token developer</label>
          <div class="developer-token-row">
            <input id="developer-token" type="password" placeholder="Masukkan token" autocomplete="off" />
            <button type="submit">Unlock</button>
          </div>
          <p class="developer-error" id="developer-error"></p>
        </form>
      </section>

      <section class="developer-dashboard-panel is-locked" id="developer-dashboard-panel">
        <div class="developer-metrics">
          <article><span>Aktif</span><strong id="metric-active">0</strong></article>
          <article><span>Total Kunjungan</span><strong id="metric-total">0</strong></article>
          <article><span>Visitor Unik</span><strong id="metric-unique">0</strong></article>
          <article><span>History Limit</span><strong id="metric-limit">0</strong></article>
        </div>

        <div class="developer-table-shell">
          <div class="developer-table-head">
            <span>Waktu</span>
            <span>Visitor</span>
            <span>Device</span>
            <span>Halaman</span>
            <span>Durasi</span>
            <span>Status</span>
          </div>
          <div id="developer-visitor-list" class="developer-visitor-list">
            <div class="developer-empty">Masukkan token untuk melihat riwayat.</div>
          </div>
        </div>
      </section>
    </main>
  `

  const form = document.getElementById('developer-login-form')
  const tokenInput = document.getElementById('developer-token')
  const errorEl = document.getElementById('developer-error')
  const loginPanel = document.getElementById('developer-login-panel')
  const dashboardPanel = document.getElementById('developer-dashboard-panel')
  let isUnlocked = false

  analytics.connect()
  analytics.subscribe((state) => {
    renderConnection(state.connection)
    renderPublicStats(state.stats)
    if (state.developerStats) {
      isUnlocked = true
      loginPanel.classList.add('hidden')
      dashboardPanel.classList.remove('is-locked')
      renderDeveloperStats(state.developerStats)
    }
  })

  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    errorEl.textContent = ''

    const result = await analytics.authenticateDeveloper(tokenInput.value.trim())
    if (!result.ok) {
      errorEl.textContent = result.message || 'Token developer tidak valid.'
      return
    }

    isUnlocked = true
    loginPanel.classList.add('hidden')
    dashboardPanel.classList.remove('is-locked')
  })

  animate(
    '.developer-hero > *, .developer-login-panel, .developer-dashboard-panel',
    { opacity: [0, 1], y: [18, 0] },
    { delay: stagger(0.08), duration: 0.45, easing: 'ease-out' },
  )

  function renderDeveloperStats(stats) {
    if (!isUnlocked) return

    document.getElementById('metric-active').textContent = formatNumber(stats.activeCount)
    document.getElementById('metric-total').textContent = formatNumber(stats.totalVisits)
    document.getElementById('metric-unique').textContent = formatNumber(stats.uniqueVisitors)
    document.getElementById('metric-limit').textContent = formatNumber(stats.maxHistory || 0)

    const list = document.getElementById('developer-visitor-list')
    if (!stats.recentVisitors?.length) {
      list.innerHTML = '<div class="developer-empty">Belum ada riwayat.</div>'
      return
    }

    list.innerHTML = stats.recentVisitors.map((visitor) => `
      <div class="developer-visitor-row">
        <span>${formatDateTime(visitor.startedAt)}</span>
        <span class="developer-mono">#${escapeHtml(visitor.visitorId)}</span>
        <span>${escapeHtml(visitor.device)} / ${escapeHtml(visitor.browser)}</span>
        <span title="${escapeHtml(visitor.path)}">${escapeHtml(visitor.path)}</span>
        <span>${formatDuration(visitor.durationMs)}</span>
        <span class="developer-visit-status status-${escapeHtml(visitor.status)}">${escapeHtml(visitor.status)}</span>
      </div>
    `).join('')
  }
}

function renderConnection(connection) {
  const status = document.querySelector('.developer-status')
  if (!status) return

  status.dataset.status = connection
  status.textContent = connection === 'live' ? 'Live' : connection === 'connecting' ? 'Sync' : 'Offline'
}

function renderPublicStats(stats) {
  document.getElementById('dev-active-count').textContent = formatNumber(stats.activeCount)
  document.getElementById('dev-updated-at').textContent = formatDateTime(stats.updatedAt)
}

function formatNumber(value) {
  return new Intl.NumberFormat('id-ID').format(value || 0)
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function formatDuration(value) {
  if (!value || value < 1000) return '0s'
  const seconds = Math.floor(value / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
