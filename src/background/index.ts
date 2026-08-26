/**
 * MV3 service worker.
 *
 * Keep in mind throughout this file: Chrome terminates this worker
 * aggressively (roughly 30s idle). Nothing may live only in module scope and
 * be assumed to survive - durable state belongs in chrome.storage.local, and
 * anything time based belongs in chrome.alarms.
 *
 * Milestone 1: skeleton only. Realtime subscription, badge counting and the
 * polling fallback arrive in milestone 5/6.
 */
import { log } from '@/shared/log'

const POLL_ALARM = 'v2f-poll'
const POLL_PERIOD_MINUTES = 5

chrome.runtime.onInstalled.addListener((details) => {
  log.info('installed:', details.reason)
  void chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES })
})

chrome.runtime.onStartup.addListener(() => {
  log.info('browser startup')
  void chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_PERIOD_MINUTES })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== POLL_ALARM) return
  log.debug('poll tick')
  // Milestone 5: refresh shares, update badge, notify open YouTube tabs.
})
