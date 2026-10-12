interface QuitEvent {
  preventDefault: () => void
}

interface CheckoutQuitDeps<Event extends QuitEvent> {
  preflightStateDb: (home: string, log: (message: string) => void) => Promise<void>
  heldQuitForActiveWork: (event: Event) => boolean
  teardown: (event: Event) => void
  quit: () => void
}

/** The checkout preflight and Electron before-quit share one lifecycle owner. */
export function createCheckoutQuitLifecycle<Event extends QuitEvent>(deps: CheckoutQuitDeps<Event>) {
  let pending: Promise<void> | null = null
  let quitting = false
  let waitingForPreflight = false

  const cancelled = (): Error => new Error('Update cancelled because Desktop is quitting.')

  return {
    async preflightStateDb(home: string, log: (message: string) => void): Promise<void> {
      if (quitting) {
        throw cancelled()
      }

      // Include config/launcher resolution, not just the snapshot child. Keep
      // ownership until the caller's continuation has been admitted or refused.
      pending = Promise.resolve().then(() => deps.preflightStateDb(home, log))

      try {
        await pending

        if (quitting) {
          throw cancelled()
        }
      } finally {
        pending = null
      }
    },
    beforeQuit(event: Event): void {
      // "Keep Running" must neither cancel the update nor latch teardown.
      if (deps.heldQuitForActiveWork(event)) {
        return
      }

      quitting = true

      if (pending) {
        event.preventDefault()

        if (!waitingForPreflight) {
          waitingForPreflight = true
          // Don't kill the snapshot or allow a stale updater handoff. Even a
          // failed snapshot may release an explicitly requested ordinary quit;
          // the update itself still rejects before any update teardown/spawn.
          void pending.then(deps.quit, deps.quit)
        }

        return
      }

      deps.teardown(event)
    }
  }
}
