import PDFDocument from 'pdfkit'
import { existsSync } from 'node:fs'
import path from 'node:path'

/** Embed a local CJK font; never silently emit a Latin-only Chinese PDF. */
export async function buildSimplePdf(title: string, body: string): Promise<Uint8Array> {
  const candidates = [
    process.env.NOTE_PDF_FONT,
    path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'msyh.ttf'),
    path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'msyh.ttc'),
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/System/Library/Fonts/PingFang.ttc',
  ].filter((p): p is string => Boolean(p))
  const font = candidates.find((p) => existsSync(p))
  if (!font) throw new Error('PDF requires a local Chinese font. Set NOTE_PDF_FONT to a CJK TTF/OTF file.')
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: {
    Title: title, Author: 'AI Network Lab', Subject: 'Research notes', Creator: 'AI Network Lab',
  } })
  const chunks: Buffer[] = []
  const result = new Promise<Uint8Array>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  try {
    const family = font.toLowerCase().endsWith('.ttc')
      ? (font.toLowerCase().includes('msyh') ? 'MicrosoftYaHei' : font.includes('Noto') ? 'NotoSansCJKsc-Regular' : 'PingFangSC-Regular')
      : undefined
    if (family) doc.font(font, family)
    else doc.font(font)
    doc.fontSize(18).text(title)
    doc.moveDown().fontSize(11).text(body, { lineGap: 4 })
    doc.end()
  } catch (error) {
    doc.destroy(error as Error)
  }
  return result
}
