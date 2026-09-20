import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

/**
 * desktop/hardening.js 的回归守卫。
 *
 * 为什么值得单独守
 * ----------------
 * 加固代码的特点是「删掉/改错之后应用照样能跑」—— 功能上完全无感，
 * 只有被攻击时才暴露。所以它极容易被后续重构顺手改坏而没人发现。
 * 这个文件把几条关键性质钉住：
 *
 *  1. **DevTools 在生产必须关死**。开着 DevTools 意味着能直接读渲染进程内存
 *     （里面存着用户填的 LLM API Key）、改前端逻辑绕过校验、以及看到全部请求。
 *  2. **打包态与开发态行为不同**。开发时必须能调试，否则没法干活；
 *     打包态必须锁死。两条都要断言，防止「一刀切」改坏其中一边。
 *  3. **导航白名单**。外部站点若能在本窗口打开，它就拿到了挂着 preload 的
 *     执行环境，可以调 IPC（虽有 guardSender 兜底，但不能只押一层）。
 *  4. **CSP 的关键指令与唯一的让步**。特别要钉住「不许出现 unsafe-eval」——
 *     那是比 unsafe-inline 严重得多的口子。
 *  5. **权限一律拒绝**，且 `setPermissionCheckHandler` 也要拒
 *     （只设 RequestHandler 会漏掉不走 request 路径的同步查询）。
 */
const nodeRequire = createRequire(import.meta.url)
const h = nodeRequire('../../desktop/hardening.js') as {
  buildCsp: () => string
  lockDownDevTools: (win: unknown, isPackaged: boolean) => void
  guardNavigation: (win: unknown, trustedOrigin: string, shellRef?: unknown) => void
  denyAllPermissions: (sessionRef: unknown) => void
  applyCsp: (trustedOrigin: string, sessionRef: unknown) => void
}

const ORIGIN = 'http://127.0.0.1:43123'

/** 造一个最小的 BrowserWindow 替身，记录注册了哪些监听器 */
function fakeWindow() {
  const handlers = new Map<string, Array<(...a: unknown[]) => void>>()
  const wc = {
    closeDevTools: vi.fn(),
    on: (evt: string, fn: (...a: unknown[]) => void) => {
      if (!handlers.has(evt)) handlers.set(evt, [])
      handlers.get(evt)!.push(fn)
    },
    emit: (evt: string, ...args: unknown[]) => {
      for (const fn of handlers.get(evt) || []) fn(...args)
    },
    handlerCount: (evt: string) => (handlers.get(evt) || []).length,
  }
  return { win: { webContents: wc }, wc }
}

/** 造一个最小的 session 替身 */
function fakeSession() {
  return {
    setSpellCheckerEnabled: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
    setDevicePermissionHandler: vi.fn(),
    webRequest: { onHeadersReceived: vi.fn() },
  }
}

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('buildCsp：渲染进程的内容安全策略', () => {
  const csp = h.buildCsp()

  it('把所有能力默认收回到同源', () => {
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("worker-src 'self' blob:")
    expect(csp).toContain("manifest-src 'self'")
  })

  it('关掉高风险的加载类型', () => {
    // object/embed 是经典的插件逃逸面，本项目完全不需要
    expect(csp).toContain("object-src 'none'")
    // 防 <base> 改写相对 URL 指向攻击者站点
    expect(csp).toContain("base-uri 'none'")
    // 防表单把数据 POST 到外部
    expect(csp).toContain("form-action 'none'")
    // 防被别的页面 iframe 套走
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('⚠️ 绝不允许 unsafe-eval（比 unsafe-inline 严重得多的口子）', () => {
    expect(csp).not.toContain('unsafe-eval')
  })

  it("script-src 只放行 'self' 与 'unsafe-inline'，且两者都必须写明", () => {
    const m = csp.match(/script-src([^;]*)/)
    expect(m).not.toBeNull()
    const scriptSrc = m![1]
    expect(scriptSrc).toContain("'self'")
    // Next 的 App Router 会在 HTML 里内联引导脚本（本项目的主题初始化也是内联脚本），
    // 因此这一项不能去掉 —— 去掉会直接白屏。
    expect(scriptSrc).toContain("'unsafe-inline'")
    expect(scriptSrc).not.toContain('http://')
    expect(scriptSrc).not.toContain('https://')
  })

  it('图片允许同源与 data:/blob:（图标与 canvas），但不允许任意远程域', () => {
    const m = csp.match(/img-src([^;]*)/)
    expect(m).not.toBeNull()
    expect(m![1]).toContain("'self'")
    expect(m![1]).toContain('data:')
    expect(m![1]).not.toContain('http')
  })

  it('不含任何通配来源', () => {
    expect(csp).not.toContain('*')
  })
})

describe('applyCsp：只给受信任源套策略', () => {
  it('受信任源的响应被加上 CSP 与 nosniff', () => {
    const ses = fakeSession()
    h.applyCsp(ORIGIN, ses)

    const cb = vi.fn()
    const listener = ses.webRequest.onHeadersReceived.mock.calls[0][0]
    listener({ url: `${ORIGIN}/`, responseHeaders: { 'Content-Type': ['text/html'] } }, cb)

    const headers = cb.mock.calls[0][0].responseHeaders
    expect(headers['Content-Security-Policy']).toEqual([h.buildCsp()])
    expect(headers['X-Content-Type-Options']).toEqual(['nosniff'])
  })

  it('非受信任源的响应原样放行', () => {
    const ses = fakeSession()
    h.applyCsp(ORIGIN, ses)

    const cb = vi.fn()
    const listener = ses.webRequest.onHeadersReceived.mock.calls[0][0]
    const original = { 'Content-Type': ['image/png'] }
    listener({ url: 'https://example.com/a.png', responseHeaders: original }, cb)

    expect(cb.mock.calls[0][0].responseHeaders).toBe(original)
  })

  it('已有的 CSP 头被覆盖而不是追加（重复的 CSP 会取交集，行为难预测）', () => {
    const ses = fakeSession()
    h.applyCsp(ORIGIN, ses)

    const cb = vi.fn()
    const listener = ses.webRequest.onHeadersReceived.mock.calls[0][0]
    listener(
      {
        url: `${ORIGIN}/x`,
        responseHeaders: { 'content-security-policy': ['default-src *'] },
      },
      cb,
    )

    const headers = cb.mock.calls[0][0].responseHeaders
    const keys = Object.keys(headers).filter((k) => k.toLowerCase() === 'content-security-policy')
    expect(keys).toHaveLength(1)
    expect(headers[keys[0]]).not.toContain('*')
  })

  it('受信任源为空时不注册监听（避免给所有请求乱套策略）', () => {
    const ses = fakeSession()
    h.applyCsp('', ses)
    expect(ses.webRequest.onHeadersReceived).not.toHaveBeenCalled()
  })
})

describe('denyAllPermissions：权限一律拒绝', () => {
  it('请求路径与同步查询路径都拒，且关闭设备选择器', () => {
    const ses = fakeSession()
    h.denyAllPermissions(ses)

    // request handler 必须直接回调 false
    const reqCb = vi.fn()
    ses.setPermissionRequestHandler.mock.calls[0][0](null, 'media', reqCb)
    expect(reqCb).toHaveBeenCalledWith(false)

    // ⚠️ 同步查询路径也要拒 —— 有些 API 不经过 request handler
    expect(ses.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false)
    expect(ses.setDevicePermissionHandler.mock.calls[0][0]()).toBe(false)
  })

  it('老版本 Electron 缺少 setDevicePermissionHandler 时不抛异常', () => {
    const ses = fakeSession()
    // @ts-expect-error 故意删掉以模拟老版本
    delete ses.setDevicePermissionHandler
    expect(() => h.denyAllPermissions(ses)).not.toThrow()
  })
})

describe('lockDownDevTools：生产关死，开发放行', () => {
  it('打包态下 DevTools 一打开就被强制关闭', () => {
    const { win, wc } = fakeWindow()
    h.lockDownDevTools(win, true)

    wc.emit('devtools-opened')
    expect(wc.closeDevTools).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalled()
  })

  it.each([
    ['F12', { key: 'F12', type: 'keyDown' }],
    ['Ctrl+Shift+I', { key: 'i', control: true, shift: true, type: 'keyDown' }],
    ['Ctrl+Shift+J', { key: 'j', control: true, shift: true, type: 'keyDown' }],
    ['Ctrl+Shift+C', { key: 'C', control: true, shift: true, type: 'keyDown' }],
    ['Ctrl+U（查源码）', { key: 'u', control: true, type: 'keyDown' }],
  ])('打包态拦截快捷键：%s', (_label, input) => {
    const { win, wc } = fakeWindow()
    h.lockDownDevTools(win, true)

    const ev = { preventDefault: vi.fn() }
    wc.emit('before-input-event', ev, input)
    expect(ev.preventDefault).toHaveBeenCalled()
  })

  it('普通按键不被拦（不能因为加固把键盘吃掉）', () => {
    const { win, wc } = fakeWindow()
    h.lockDownDevTools(win, true)

    const ev = { preventDefault: vi.fn() }
    wc.emit('before-input-event', ev, { key: 'a', type: 'keyDown' })
    wc.emit('before-input-event', ev, { key: 'i', control: true, type: 'keyDown' })
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })

  it('⚠️ 开发态（未打包）不注册任何监听 —— 否则自己没法调试', () => {
    const { win, wc } = fakeWindow()
    h.lockDownDevTools(win, false)

    expect(wc.handlerCount('devtools-opened')).toBe(0)
    expect(wc.handlerCount('before-input-event')).toBe(0)
  })
})

describe('guardNavigation：导航白名单', () => {
  it('受信任源内的跳转放行', () => {
    const { win, wc } = fakeWindow()
    const shellRef = { openExternal: vi.fn() }
    h.guardNavigation(win, ORIGIN, shellRef)

    const ev = { preventDefault: vi.fn() }
    wc.emit('will-navigate', ev, `${ORIGIN}/api/stats`)
    expect(ev.preventDefault).not.toHaveBeenCalled()
    expect(shellRef.openExternal).not.toHaveBeenCalled()
  })

  it('外部跳转被拦下，并交给系统浏览器打开', () => {
    const { win, wc } = fakeWindow()
    const shellRef = { openExternal: vi.fn() }
    h.guardNavigation(win, ORIGIN, shellRef)

    const ev = { preventDefault: vi.fn() }
    wc.emit('will-navigate', ev, 'https://evil.example.com/steal')
    expect(ev.preventDefault).toHaveBeenCalled()
    expect(shellRef.openExternal).toHaveBeenCalledWith('https://evil.example.com/steal')
  })

  it('非 http(s)（如 file://）被拦下但不会去调 openExternal', () => {
    const { win, wc } = fakeWindow()
    const shellRef = { openExternal: vi.fn() }
    h.guardNavigation(win, ORIGIN, shellRef)

    const ev = { preventDefault: vi.fn() }
    wc.emit('will-navigate', ev, 'file:///C:/Windows/System32/calc.exe')
    expect(ev.preventDefault).toHaveBeenCalled()
    expect(shellRef.openExternal).not.toHaveBeenCalled()
  })

  it('子框架导航到外部同样被拦', () => {
    const { win, wc } = fakeWindow()
    h.guardNavigation(win, ORIGIN, { openExternal: vi.fn() })

    const ev = { preventDefault: vi.fn(), url: 'https://evil.example.com/frame' }
    wc.emit('will-frame-navigate', ev)
    expect(ev.preventDefault).toHaveBeenCalled()
  })

  it('openExternal 抛错不应影响主流程', () => {
    const { win, wc } = fakeWindow()
    const shellRef = {
      openExternal: () => {
        throw new Error('no browser')
      },
    }
    h.guardNavigation(win, ORIGIN, shellRef)

    const ev = { preventDefault: vi.fn() }
    expect(() => wc.emit('will-navigate', ev, 'https://a.example.com')).not.toThrow()
    expect(ev.preventDefault).toHaveBeenCalled()
  })

  it('受信任源为空时不注册监听', () => {
    const { win, wc } = fakeWindow()
    h.guardNavigation(win, '', { openExternal: vi.fn() })
    expect(wc.handlerCount('will-navigate')).toBe(0)
  })
})
