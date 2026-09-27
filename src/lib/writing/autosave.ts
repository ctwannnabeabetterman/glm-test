export type SavePayload = Record<string, unknown>
export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

type Entry = {
  pending: SavePayload | null
  inFlight: SavePayload | null
  request: Promise<void> | null
  timer: ReturnType<typeof setTimeout> | null
  failed: boolean
  deleting: boolean
  savedAt: number | null
}

/** One queue per mounted app, not per editor instance: an unmounted editor can still finish or retry its saves. */
export class ManuscriptAutosave {
  private entries = new Map<string, Entry>()
  private deleted = new Set<string>()
  private listeners = new Set<() => void>()
  private revision = 0

  constructor(
    private readonly save: (id: string, payload: SavePayload) => Promise<void>,
    private readonly delay = 800,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getRevision = () => this.revision

  private notify() {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  private entry(id: string) {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = { pending: null, inFlight: null, request: null, timer: null, failed: false, deleting: false, savedAt: null }
      this.entries.set(id, entry)
    }
    return entry
  }

  private clearTimer(entry: Entry) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
  }

  schedule(id: string, payload: SavePayload) {
    if (this.deleted.has(id)) return
    const entry = this.entry(id)
    entry.pending = { ...entry.pending, ...payload }
    this.clearTimer(entry)
    if (!entry.deleting) entry.timer = setTimeout(() => { void this.flush(id) }, this.delay)
    this.notify()
  }

  async flush(id: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || entry.deleting) return
    this.clearTimer(entry)
    if (entry.request) {
      await entry.request
      // A second flush during an in-flight PUT must send edits made after that PUT, in order.
      if (!entry.failed) await this.flush(id)
      return
    }
    if (!entry.pending) return

    const job = entry.pending
    entry.pending = null
    entry.inFlight = job
    entry.failed = false
    entry.request = (async () => {
      try {
        await this.save(id, job)
        entry.savedAt = Date.now()
      } catch {
        // Newer fields always win over fields from a failed, older request.
        entry.pending = { ...job, ...entry.pending }
        if (!entry.deleting) entry.failed = true
      } finally {
        entry.inFlight = null
        entry.request = null
        this.notify()
      }
    })()
    this.notify()
    await entry.request
  }

  async flushAll() {
    await Promise.all([...this.entries.keys()].map((id) => this.flush(id)))
  }

  /** Wait for an already-sent PUT, then delete. No queued PUT may recreate a deleted manuscript. */
  async delete(id: string, remove: () => Promise<void>) {
    if (this.deleted.has(id)) return
    const entry = this.entry(id)
    if (entry.deleting) return
    entry.deleting = true
    this.clearTimer(entry)
    this.notify()
    try {
      if (entry.request) await entry.request
      await remove()
      this.deleted.add(id)
      this.entries.delete(id)
      this.notify()
    } catch (error) {
      entry.deleting = false
      // A failed DELETE leaves the manuscript intact. Save any changes held during deletion.
      if (entry.pending) void this.flush(id)
      this.notify()
      throw error
    }
  }

  getStatus(id: string | null): { state: SaveState; savedAt: number | null } {
    const entry = id ? this.entries.get(id) : null
    if (!entry) return { state: 'idle', savedAt: null }
    const state: SaveState = entry.deleting || entry.inFlight ? 'saving'
      : entry.failed ? 'error'
      : entry.pending ? 'pending'
      : entry.savedAt ? 'saved' : 'idle'
    return { state, savedAt: entry.savedAt }
  }

  getFailedIds() {
    return [...this.entries].filter(([, entry]) => entry.failed && !entry.deleting).map(([id]) => id)
  }

  /** Reapply local edits if the workbench remounts before an outstanding save succeeds. */
  getUnpersisted(id: string): SavePayload {
    const entry = this.entries.get(id)
    return { ...entry?.inFlight, ...entry?.pending }
  }
}

export const manuscriptAutosave = new ManuscriptAutosave(async (id, payload) => {
  const res = await fetch(`/api/writing/manuscripts/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('save failed')
})
