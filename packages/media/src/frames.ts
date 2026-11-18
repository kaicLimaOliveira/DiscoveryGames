import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ffmpegPath } from './bin.js'
import { runTool } from './run.js'

const MAX_FRAMES = 40
const MIN_STEP_SEC = 10
const MAX_SIDE = 768

/** Segundos dos quadros: a cada max(10 s, duração/40) a partir de 0, no máximo 40. */
export function frameTimes(durationMs: number): number[] {
  const durationSec = durationMs / 1000
  const step = Math.max(MIN_STEP_SEC, durationSec / MAX_FRAMES)
  const times: number[] = []
  for (let t = 0; t < durationSec && times.length < MAX_FRAMES; t += step) times.push(t)
  return times.length ? times : [0]
}

/** Um JPEG (até 768 px no maior lado) por tempo de `frameTimes`. */
export async function sampleFrames(
  input: string,
  durationMs: number,
  outDir: string,
): Promise<Array<{ path: string; atSec: number }>> {
  await mkdir(outDir, { recursive: true })
  const scale = `scale=w='if(gte(iw,ih),min(${MAX_SIDE},iw),-2)':h='if(gte(iw,ih),-2,min(${MAX_SIDE},ih))'`
  const frames: Array<{ path: string; atSec: number }> = []
  for (const [i, atSec] of frameTimes(durationMs).entries()) {
    const path = join(outDir, `frame_${String(i).padStart(3, '0')}.jpg`)
    await runTool(
      ffmpegPath(),
      [
        ...['-v', 'error', '-y', '-ss', String(atSec), '-i', input],
        ...['-frames:v', '1', '-vf', scale, '-q:v', '4', path],
      ],
      { timeoutMs: 60_000 },
    )
    frames.push({ path, atSec })
  }
  return frames
}
