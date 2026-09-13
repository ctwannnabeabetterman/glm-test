import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

function harness() {
  let handler: (...args: any[]) => Promise<any>
  const dialog = { showSaveDialog: vi.fn(), showErrorBox: vi.fn() }
  const write = vi.fn()
  const electron = { app: { whenReady: () => ({then: () => ({catch: () => {}})}), on: vi.fn()}, ipcMain: {handle: (_: string, fn: typeof handler) => {handler = fn}}, dialog }
  const context = vm.createContext({ require: (name: string) => name === 'electron' ? electron : name === 'fs' ? {writeFileSync: write} : name === 'path' ? path : name === './migrate-database' ? {} : {}, Buffer, ArrayBuffer, URL, console, process, __dirname: path.resolve('desktop') })
  vm.runInContext(readFileSync(path.resolve('desktop/main.js'), 'utf8'), context)
  vm.runInContext("mainWindow = { webContents: { mainFrame: { url: 'http://127.0.0.1:1234/' } } }; trustedOrigin = 'http://127.0.0.1:1234'; globalThis.sender = mainWindow.webContents;", context)
  return {call: (payload: unknown) => handler!({ sender: context.sender, senderFrame: context.sender.mainFrame }, payload), dialog, write}
}
const payload = () => ({filename: '中文笔记.md', mime: 'text/markdown', buffer: new TextEncoder().encode('中文正文').buffer})
describe('desktop native save handler', () => {
  it('writes exact bytes after approval', async () => {
    const h = harness()
    h.dialog.showSaveDialog.mockResolvedValue({filePath: 'test.md', canceled: false})
    expect((await h.call(payload())).ok).toBe(true)
    expect(h.write.mock.calls[0][1].toString()).toBe('中文正文')
  })
  it('does not write after cancellation and resets saving state', async () => {
    const h = harness()
    h.dialog.showSaveDialog.mockResolvedValue({canceled: true})
    expect(await h.call(payload())).toEqual({ok: false, canceled: true})
    expect(await h.call(payload())).toEqual({ok: false, canceled: true})
    expect(h.write).not.toHaveBeenCalled()
  })
  it('rejects unsafe filenames', async () => {
    const h = harness()
    expect((await h.call({...payload(), filename: '../note.md'})).ok).toBe(false)
    expect(h.dialog.showSaveDialog).not.toHaveBeenCalled()
  })
})
