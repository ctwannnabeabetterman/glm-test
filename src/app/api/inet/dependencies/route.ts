import { NextResponse } from 'next/server'
import { execFile } from 'node:child_process'

export async function GET() {
  return new Promise<Response>((resolve) => {
    execFile('opp_run', ['-h'], { timeout: 5000 }, (error) => {
      resolve(NextResponse.json({ ready: !error, status: error ? '未检测到 opp_run，请在设置中配置 OMNeT++/INET' : 'INET 运行依赖可用' }))
    })
  })
}
