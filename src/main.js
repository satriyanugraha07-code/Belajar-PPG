import '../style.css'
import './realtime.css'
import { initAyoMotion } from './motion-effects.js'
import { createAnalyticsClient } from './visitor-analytics.js'
import { renderDeveloperDashboard } from './developer-dashboard.js'

const analytics = createAnalyticsClient()
window.AyoAnalytics = analytics

if (window.location.pathname.startsWith('/developer')) {
  renderDeveloperDashboard(analytics)
} else {
  await import('../app.js')
  initAyoMotion()
}
