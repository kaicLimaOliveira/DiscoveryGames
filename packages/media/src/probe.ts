import { stat } from 'node:fs/promises'
import { ffprobePath } from './bin.js'
import { runTool } from './run.js'

export type MediaProbe = {
  container: string
  durationMs: number
  sizeBytes: number
  bitrate: number | null
  video: { codec: string; width: number; height: number; fps: number; isVfr: boolean } | null
  audio: { codec: string; sampleRate: number; channels: number } | null
  tags: Record<string, string>
}

type Stream = {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  sample_rate?: string
  channels?: number
  avg_frame_rate?: string
  r_frame_rate?: string
  tags?: Record<string, string>
  side_data_list?: Array<{ rotation?: number }>
}

type Format = {
  format_name?: string
  duration?: string
  size?: string
  bit_rate?: string
  tags?: Record<string, string>
}

function ratio(value: string | undefined): number {
  const [n, d] = (value ?? '').split('/').map(Number)
  if (!n || !d) return 0
  return n / d
}

function rotationOf(stream: Stream): number {
  const side = stream.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation
  return side ?? Number(stream.tags?.rotate ?? 0)
}

/** Lê o contêiner com o ffprobe e normaliza (largura/altura já depois da rotação). */
export async function probe(path: string): Promise<MediaProbe> {
  const { stdout } = await runTool(
    ffprobePath(),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { timeoutMs: 60_000 },
  )
  const data = JSON.parse(stdout) as { format?: Format; streams?: Stream[] }
  const streams = data.streams ?? []
  const v = streams.find((s) => s.codec_type === 'video')
  const a = streams.find((s) => s.codec_type === 'audio')
  const format = data.format ?? {}

  let video: MediaProbe['video'] = null
  if (v) {
    const swap = Math.abs(rotationOf(v)) % 180 === 90
    const avg = ratio(v.avg_frame_rate)
    const real = ratio(v.r_frame_rate)
    video = {
      codec: v.codec_name ?? 'unknown',
      width: (swap ? v.height : v.width) ?? 0,
      height: (swap ? v.width : v.height) ?? 0,
      fps: avg || real,
      isVfr: avg > 0 && real > 0 && Math.abs(avg - real) / real > 0.01,
    }
  }

  const sizeBytes = format.size ? Number(format.size) : (await stat(path)).size
  return {
    container: format.format_name ?? 'unknown',
    durationMs: Math.round(Number(format.duration ?? 0) * 1000),
    sizeBytes,
    bitrate: format.bit_rate ? Number(format.bit_rate) : null,
    video,
    audio: a
      ? {
          codec: a.codec_name ?? 'unknown',
          sampleRate: Number(a.sample_rate ?? 0),
          channels: a.channels ?? 0,
        }
      : null,
    tags: format.tags ?? {},
  }
}
