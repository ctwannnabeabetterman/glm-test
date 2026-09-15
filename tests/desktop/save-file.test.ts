import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

/**
 * 用 vm 把 desktop/main.js 整体加载进一个受控上下文，取出它的 IPC handler 来测。
 *
 * 这个 harness 需要提供 main.js 顶层真正会用到的一切：
 *  - `app.requestSingleInstanceLock`：main.js 在**顶层**就调用它做单实例锁，
 *    mock 里缺了会直接 TypeError（这是 d576c70 引入单实例锁后遗留的 mock 空档，
 *    与业务代码无关，但会让整个文件红掉）。
 *  - IPC handler **按 channel 存**：main.js 会注册多个 channel（save-file /
 *    check-for-updates…），若像以前那样只用一个变量覆盖，最后只剩最后一个，
 *    测 save-file 会拿到别的 handler。
 */
function harness() {
  const handlers: Record<string, (...args: any[]) => Promise<any>> = {}
  const dialog = { showSaveDialog: vi.fn(), showErrorBox: vi.fn() }
  const write = vi.fn()
  const electron = {
    app: {
      whenReady: () => ({ then: () => ({ catch: () => {} }) }),
      on: vi.fn(),
      requestSingleInstanceLock: () => true, // 顶层调用点，缺了会 TypeError
      isPackaged: false,
      getVersion: () => '1.2.1',
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: any[]) => Promise<any>) => {
        handlers[channel] = fn
      },
    },
    dialog,
  }
  const context = vm.createContext({
    require: (name: string) =>
      name === 'electron' ? electron : name === 'fs' ? { writeFileSync: write } : name === 'path' ? path : name === './migrate-database' ? {} : {},
    Buffer,
    ArrayBuffer,
    URL,
    console,
    process,
    __dirname: path.resolve('desktop'),
  })
  vm.runInContext(readFileSync(path.resolve('desktop/main.js'), 'utf8'), context)
  vm.runInContext("mainWindow = { webContents: { mainFrame: { url: 'http://127.0.0.1:1234/' } } }; trustedOrigin = 'http://127.0.0.1:1234'; globalThis.sender = mainWindow.webContents;", context)
  return {
    call: (payload: unknown) => {
      const fn = handlers['save-file']
      if (!fn) throw new Error('save-file handler 未注册')
      return fn({ sender: context.sender, senderFrame: context.sender.mainFrame }, payload)
    },
    dialog,
    write,
  }
}
const payload = () => ({ filename: '中文笔记.md', mime: 'text/markdown', buffer: new TextEncoder().encode('中文正文').buffer })
describe('desktop native save handler', () => {
  it('writes exact bytes after approval', async () => {
    const h = harness()
    h.dialog.showSaveDialog.mockResolvedValue({ filePath: 'test.md', canceled: false })
    expect((await h.call(payload())).ok).toBe(true)
    expect(h.write.mock.calls[0][1].toString()).toBe('中文正文')
  })
  it('does not write after cancellation and resets saving state', async () => {
    const h = harness()
    h.dialog.showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await h.call(payload())).toEqual({ ok: false, canceled: true })
    expect(await h.call(payload())).toEqual({ ok: false, canceled: true })
    expect(h.write).not.toHaveBeenCalled()
  })
  it('rejects unsafe filenames', async () => {
    const h = harness()
    expect((await h.call({ ...payload(), filename: '../note.md' })).ok).toBe(false)
    expect(h.dialog.showSaveDialog).not.toHaveBeenCalled()
  })
})
