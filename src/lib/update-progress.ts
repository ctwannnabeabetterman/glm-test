/**
 * 更新进度的展示层格式化。
 *
 * 为什么单独抽出来：`update-notifier`（右下角常驻卡片）与 `settings-section`
 *（设置 → 软件更新）两处都要显示「下载中」的细节。以前两边各写一份格式化代码，
 * 结果就是「同样的数据、两处说法不一致」。抽成一个纯函数模块还能顺带被单测覆盖 ——
 * 这个仓库的测试跑在 node 环境（无 jsdom、不测 React 组件），纯函数是唯一能锁住
 * 「给用户看什么字」的地方。
 *
 * 这些函数直接对应用户 2026-09-18 的反馈：「不知道怎么下的」——
 * 只有百分比数字是不够的，必须给出传输量、速度、剩余时间，用户才能判断
 * 「在下 / 在慢慢下 / 卡住了」。
 */

/** 把字节/秒格式化成短字符串；未知或 0 返回空串（不显示假数据） */
export function formatUpdateSpeed(bytesPerSecond?: number): string {
  const v = Number(bytesPerSecond) || 0
  if (v <= 0) return ''
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`
  return `${Math.max(1, Math.round(v / 1024))} KB/s`
}

/** 已下载 / 总量 的 MB 文案；缺数据时返回空串 */
export function formatUpdateSize(transferred?: number, total?: number): string {
  const t = Number(total) || 0
  if (t <= 0) return ''
  const done = Number(transferred) || 0
  return `${(done / 1048576).toFixed(1)} / ${(t / 1048576).toFixed(1)} MB`
}

/**
 * 用剩余字节 + 速度估「约剩多久」，人话粒度。
 *
 * ⚠️ 速度或剩余量未知时**返回空串，不猜**。进度条旁边挂一个每帧乱跳的
 * 「约剩 3 分钟 / 约剩 40 分钟」比不显示更糟 —— 用户会以为网络出问题了。
 */
export function estimateUpdateEta(remainBytes?: number, bytesPerSecond?: number): string {
  const speed = Number(bytesPerSecond) || 0
  const remain = Number(remainBytes) || 0
  if (speed <= 0 || remain <= 0) return ''
  const sec = remain / speed
  if (!Number.isFinite(sec) || sec <= 0) return ''
  if (sec < 60) return `${Math.max(1, Math.round(sec))} 秒`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} 分钟`
  return `${Math.round(min / 60)} 小时`
}

/**
 * 把「下载中」的零散字段拼成一行副标题。
 * 返回空串表示没有任何可用数据（调用方据此决定不渲染这一行）。
 */
export function describeDownloadDetail(payload: {
  transferred?: number
  total?: number
  speed?: number
}): string {
  const total = Number(payload.total) || 0
  const transferred = Number(payload.transferred) || 0
  const speed = formatUpdateSpeed(payload.speed)
  const eta = estimateUpdateEta(total - transferred, payload.speed)
  return [formatUpdateSize(transferred, total), speed, eta ? `约剩 ${eta}` : ''].filter(Boolean).join(' · ')
}

/** 把任意进度值收敛到 0–100 的整数（主进程理论上会给合法值，但 UI 不该被脏数据撑破） */
export function clampPercent(percent?: number): number {
  const v = Math.round(Number(percent) || 0)
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, v))
}
