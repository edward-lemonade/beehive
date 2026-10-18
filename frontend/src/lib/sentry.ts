import * as Sentry from '@sentry/react'
import { API_URL } from '../api/client'

const dsn = (import.meta.env.VITE_SENTRY_DSN as string | undefined)?.trim()
export const sentryEnabled = Boolean(dsn) && import.meta.env.MODE !== 'test'

if (sentryEnabled) {
  Sentry.init({
    dsn,
    environment: (import.meta.env.VITE_SENTRY_ENVIRONMENT as string | undefined) || import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE as string | undefined,
    dataCollection: { userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false },
    integrations: [
      Sentry.browserTracingIntegration(),
      // Text and inputs stay masked: listings, chat and contact details are private. Clicks, layout and timing remain.
      Sentry.replayIntegration({ maskAllText: true, maskAllInputs: true, blockAllMedia: true }),
      Sentry.feedbackIntegration({ colorScheme: 'light', showName: false, showEmail: false, triggerLabel: 'Report a problem' }),
      Sentry.consoleLoggingIntegration({ levels: ['warn', 'error'] }),
    ],
    tracesSampleRate: 1.0,
    // Continues the trace into the API, so one trace runs from the click to the agents it woke and the LLM calls they made.
    tracePropagationTargets: [API_URL],
    replaysSessionSampleRate: 1.0,
    replaysOnErrorSampleRate: 1.0,
  })
}

export { Sentry }
