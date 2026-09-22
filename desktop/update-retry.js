/**
 * 更新检查的重试策略 —— 纯函数，**刻意不 require('electron')**
 * （与 `hardening.js` 同一套路：能被 vitest 直接 require，不必起 Electron）。
 *
 * 背景（2026-09-21 在用户机器的 update.log 里实测到的现场）：
 *
 *   [15:23:45] Checking for update
 *   [15:23:58] [updater:error] HttpError: 504
 *              GET https://github.com/…/glm-test/releases.atom
 *              <h1>504 Gateway Time-out</h1>
 *   [15:23:58] 启动静默检查未成功：unknown — 504
 *
 * 更新源用 **GitHub provider** 时，每次检查都要先拉 `releases.atom` 才能判断最新 tag；
 * 这个 feed 是动态生成、不吃缓存的，会偶发 5xx（同一次故障里，本机请求同一地址是 200 —— 边缘节点瞬时问题）。
 * 而启动检查**只跑一次**、失败只写日志 ⇒ **那一次启动就等于「不更新」**，
 * 用户看到的现象就是「客户端不会自动更新」，而且他没有任何重试的机会。
 *
 * 所以这里给两件事：
 *   1. 退避序列（启动时用户不在等，可以慢；手动点时人在等，要快）；
 *   2. **该不该重试**的判据 —— 只重试瞬时故障；401/403/404/版本回退这类重试一百次也一样，
 *      徒增等待还会把「发布侧的问题」伪装成「网络问题」。
 */

/** 启动时的静默检查：首次立即，之后 30 秒、2 分钟（覆盖 GitHub 边缘 5xx 抖动的量级） */
const STARTUP_RETRY_DELAYS = [0, 30_000, 120_000]

/** 用户主动点「检查更新」：人在等，节奏快一些，别让人干等两分钟 */
const MANUAL_RETRY_DELAYS = [0, 3_000, 8_000]

/** 瞬时故障：HTTP 5xx、连接类错误 —— 值得重试 */
const TRANSIENT_RE =
  /(50[0-9]|Gateway Time|Bad Gateway|Service Unavailable|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|socket hang up|network error|timed? ?out)/i

/** 明确「重试也没用」：鉴权失败、资源不存在、发布侧没有正式版本、禁止降级 */
const PERMANENT_RE =
  /(401|403|406|404|Cannot parse releases feed|LATEST_VERSION_NOT_FOUND|Unable to find latest version|CHANNEL_FILE_NOT_FOUND|No published versions|downgrade is disallowed)/i

/**
 * 判断一次更新检查失败该不该重试。
 *
 * @returns {{ retry: boolean, reason: 'transient' | 'permanent' | 'unknown' }}
 *
 * 认不出来时**倾向重试**：更新失败的代价是「这一版拿不到」，比多试两次更糟；
 * 而真正的永久性错误（406/404 等）会被 PERMANENT_RE 先拦下，不会白等。
 */
function classifyRetry(err) {
  const msg = String((err && (err.message || err.stack)) || err || '')
  if (!msg) return { retry: true, reason: 'unknown' }
  // 同时含 5xx 与 404 这类混合文本时以「有 5xx」为准（5xx 是瞬时的，404 的那部分多半是别处的 URL）
  if (PERMANENT_RE.test(msg) && !/50[0-9]/.test(msg)) return { retry: false, reason: 'permanent' }
  if (TRANSIENT_RE.test(msg)) return { retry: true, reason: 'transient' }
  return { retry: true, reason: 'unknown' }
}

/** 取退避序列（返回副本，调用方改它不会污染这里） */
function retryDelays(mode) {
  return (mode === 'manual' ? MANUAL_RETRY_DELAYS : STARTUP_RETRY_DELAYS).slice()
}

module.exports = { STARTUP_RETRY_DELAYS, MANUAL_RETRY_DELAYS, classifyRetry, retryDelays }
