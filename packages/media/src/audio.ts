import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ffmpegPath } from './bin.js'
import { runTool } from './run.js'

/** Divide o áudio em blocos ogg/opus 16 kHz mono 32 kbps (entrada do transcritor). */
export async function extractAudioChunks(
  input: string,
  outDir: string,
  chunkSec = 600,
): Promise<Array<{ path: string; offsetMs: number }>> {
  await mkdir(outDir, { recursive: true })
  await runTool(
    ffmpegPath(),
    [
      ...['-v', 'error', '-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000'],
      ...['-c:a', 'libopus', '-b:a', '32k'],
      ...['-f', 'segment', '-segment_format', 'ogg', '-segment_time', String(chunkSec)],
      ...['-reset_timestamps', '1', join(outDir, 'chunk_%04d.ogg')],
    ],
    { timeoutMs: 3_600_000 },
  )
  const files = (await readdir(outDir)).filter((f) => /^chunk_\d+\.ogg$/.test(f)).sort()
  return files.map((f, i) => ({ path: join(outDir, f), offsetMs: i * chunkSec * 1000 }))
}
