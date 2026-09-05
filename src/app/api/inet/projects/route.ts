import { NextResponse } from 'next/server'
import { createManifest, validateManifest } from '@/lib/inet/manifest'

export async function POST(request: Request) {
  try {
    const body = await request.json(); const manifest = createManifest(body ?? {})
    const diagnostics = validateManifest(manifest)
    return NextResponse.json({ manifest: { ...manifest, oppRunPath: undefined }, diagnostics, ready: diagnostics.length === 0 })
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }
}
