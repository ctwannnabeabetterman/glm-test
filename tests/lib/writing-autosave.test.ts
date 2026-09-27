import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManuscriptAutosave, type SavePayload } from '@/lib/writing/autosave'

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

afterEach(() => vi.useRealTimers())

describe('manuscript autosave', () => {
  it('keeps independent A/B drafts when switching before the debounce elapses', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (_id: string, _payload: SavePayload) => {})
    const queue = new ManuscriptAutosave(save)
    queue.schedule('A', { title: 'A title', sections: [{ content: 'A body' }] })
    // Switch manuscript: flush A immediately, then edit B while A is saving.
    const flushing = queue.flush('A')
    queue.schedule('B', { title: 'B title' })
    queue.schedule('A', { venue: 'Journal' })
    await flushing
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledWith('A', { title: 'A title', sections: [{ content: 'A body' }] })
    expect(save).toHaveBeenCalledWith('A', { venue: 'Journal' })
    expect(save).toHaveBeenCalledWith('B', { title: 'B title' })
    expect(queue.getStatus('A').state).toBe('saved')
    expect(queue.getStatus('B').state).toBe('saved')
  })

  it('serializes overlapping flushes on the same manuscript; a late old response cannot overwrite the newest edit', async () => {
    const first = deferred()
    const second = deferred()
    const save = vi.fn().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    const queue = new ManuscriptAutosave(save)
    queue.schedule('A', { sections: ['old'], title: 'title' })
    const oldFlush = queue.flush('A')
    queue.schedule('A', { sections: ['new'] })
    const newFlush = queue.flush('A')
    expect(save).toHaveBeenCalledTimes(1)
    first.resolve()
    await oldFlush
    await Promise.resolve()
    expect(save).toHaveBeenCalledTimes(2)
    expect(save).toHaveBeenLastCalledWith('A', { sections: ['new'] })
    expect(queue.getStatus('A').state).toBe('saving')
    second.resolve()
    await newFlush
    expect(queue.getStatus('A').state).toBe('saved')
  })

  it('keeps failed fields and newer fields in a visible, retryable state after the editor unmounts', async () => {
    const failing = deferred()
    const save = vi.fn().mockImplementationOnce(() => failing.promise).mockResolvedValue(undefined)
    const queue = new ManuscriptAutosave(save)
    queue.schedule('A', { title: 'first', venue: 'old venue' })
    const unmountFlush = queue.flushAll()
    queue.schedule('A', { title: 'new title' })
    failing.reject(new Error('network'))
    await unmountFlush
    expect(queue.getFailedIds()).toEqual(['A'])
    expect(queue.getStatus('A').state).toBe('error')
    expect(queue.getUnpersisted('A')).toEqual({ title: 'new title', venue: 'old venue' })
    await queue.flush('A')
    expect(save).toHaveBeenLastCalledWith('A', { title: 'new title', venue: 'old venue' })
    expect(queue.getFailedIds()).toEqual([])
    expect(queue.getStatus('A').state).toBe('saved')
  })

  it('waits for any in-flight PUT before DELETE and drops queued edits for the deleted manuscript', async () => {
    const writing = deferred()
    const save = vi.fn(() => writing.promise)
    const remove = vi.fn(async () => {})
    const queue = new ManuscriptAutosave(save)
    queue.schedule('A', { title: 'old' })
    const flushing = queue.flush('A')
    queue.schedule('A', { title: 'new' })
    const deleting = queue.delete('A', remove)
    expect(remove).not.toHaveBeenCalled()
    writing.resolve()
    await flushing
    await deleting
    await queue.flushAll()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    expect(queue.getStatus('A').state).toBe('idle')
    queue.schedule('A', { title: 'late callback' })
    await queue.flushAll()
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('retains queued edits if DELETE fails so they can still be retried', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => {})
    const queue = new ManuscriptAutosave(save)
    queue.schedule('A', { title: 'unfinished' })
    await expect(queue.delete('A', async () => { throw new Error('delete failed') })).rejects.toThrow('delete failed')
    await vi.advanceTimersByTimeAsync(800)
    expect(save).toHaveBeenCalledWith('A', { title: 'unfinished' })
  })

  it('does not retry or report a failed PUT when the manuscript is being deleted', async () => {
    const writing = deferred()
    const save = vi.fn(() => writing.promise)
    const queue = new ManuscriptAutosave(save)
    queue.schedule('A', { title: 'old' })
    const flushing = queue.flush('A')
    queue.schedule('A', { title: 'queued' })
    const deleting = queue.delete('A', async () => {})
    writing.reject(new Error('network'))
    await flushing
    await deleting
    expect(queue.getFailedIds()).toEqual([])
    expect(save).toHaveBeenCalledTimes(1)
  })
})
