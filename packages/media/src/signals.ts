import { ffmpegPath, longTimeoutMs } from './bin.js'
import { probe } from './probe.js'
import { runTool } from './run.js'

export type Signals = {
  loudPeaksSec: number[]
  sceneCutsSec: number[]
  motion: Array<{ startSec: number; score: number }>
}

const SCENE_CUT = 0.4
const MIN_PEAK_DBFS = -30
const PEAK_PERCENTILE = 0.9
const MOTION_WINDOW_SEC = 5
const MOTION_TOP = 20

/** Lê pares (pts_time, valor) da saída de texto de `metadata=print`/`ametadata=print`. */
function parsePrint(stdout: string, key: string): Array<{ t: number; v: number }> {
  const rows: Array<{ t: number; v: number }> = []
  let t: number | null = null
  for (const line of stdout.split(/\r?\n/)) {
    const time = /pts_time:(\S+)/.exec(line)
    if (time) {
      t = Number(time[1])
      continue
    }
    const eq = line.indexOf('=')
    if (t !== null && eq > 0 && line.slice(0, eq).trim() === key) {
      const raw = line.slice(eq + 1).trim()
      rows.push({ t, v: raw === '-inf' ? -Infinity : Number(raw) })
    }
  }
  return rows
}

async function videoScores(input: string, timeoutMs: number) {
  const { stdout } = await runTool(
    ffmpegPath(),
    [
      ...['-v', 'error', '-i', input, '-an'],
      ...['-vf', "fps=2,scale=320:-2,select='gte(scene,0)',metadata=print:file=-"],
      ...['-f', 'null', '-'],
    ],
    { timeoutMs },
  )
  return parsePrint(stdout, 'lavfi.scene_score')
}

async function audioLevels(input: string, timeoutMs: number) {
  const filter =
    'aresample=16000,asetnsamples=16000,astats=metadata=1:reset=1,' +
    'ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-'
  const { stdout } = await runTool(
    ffmpegPath(),
    ['-v', 'error', '-i', input, '-vn', '-af', filter, '-f', 'null', '-'],
    { timeoutMs },
  )
  return parsePrint(stdout, 'lavfi.astats.Overall.RMS_level')
}

/** Sinais técnicos em uma passada de vídeo e uma de áudio (valores da R10). */
export async function analyzeSignals(input: string, durationMs: number): Promise<Signals> {
  const timeoutMs = longTimeoutMs(durationMs)
  const scores = await videoScores(input, timeoutMs)
  const levels = (await probe(input)).audio ? await audioLevels(input, timeoutMs) : []

  const sceneCutsSec = scores.filter((s) => s.v > SCENE_CUT).map((s) => s.t)

  const windows = new Map<number, number[]>()
  for (const s of scores) {
    const k = Math.floor(s.t / MOTION_WINDOW_SEC)
    windows.set(k, [...(windows.get(k) ?? []), s.v])
  }
  const motion = [...windows.entries()]
    .map(([k, vs]) => ({
      startSec: k * MOTION_WINDOW_SEC,
      score: vs.reduce((a, b) => a + b, 0) / vs.length,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MOTION_TOP)
    .sort((a, b) => a.startSec - b.startSec)

  let loudPeaksSec: number[] = []
  if (levels.length) {
    const sorted = levels.map((l) => l.v).sort((a, b) => a - b)
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * PEAK_PERCENTILE))]!
    const threshold = Math.max(p90, MIN_PEAK_DBFS)
    loudPeaksSec = levels.filter((l) => l.v >= threshold).map((l) => Math.floor(l.t))
  }
  return { loudPeaksSec, sceneCutsSec, motion }
}
