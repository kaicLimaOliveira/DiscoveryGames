import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

/** Caminho do ffmpeg: `FFMPEG_PATH` tem prioridade sobre o binário do `ffmpeg-static`. */
export function ffmpegPath(): string {
  const path = process.env.FFMPEG_PATH ?? ffmpegStatic
  if (!path) throw new Error('Binário do ffmpeg não encontrado (defina FFMPEG_PATH)')
  return path
}

/** Caminho do ffprobe: `FFPROBE_PATH` tem prioridade sobre o binário do `ffprobe-static`. */
export function ffprobePath(): string {
  return process.env.FFPROBE_PATH ?? ffprobeStatic.path
}

/** Timeout das operações longas (docs/10 §10): 10 × duração + 120 s. */
export function longTimeoutMs(durationMs: number): number {
  return 10 * durationMs + 120_000
}
