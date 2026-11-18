import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ffmpegPath } from './bin.js'
import { runTool } from './run.js'

export type MakeVideoOpts = {
  seconds: number
  audio: 'none' | 'tone' | 'burst'
  sceneCutAtSec?: number
  rotate90?: boolean
}

let counter = 0

/** Gera um MP4 curto (640x360, 10 fps) para testes, com o próprio ffmpeg do pacote. */
export async function makeVideo(dir: string, opts: MakeVideoOpts): Promise<string> {
  await mkdir(dir, { recursive: true })
  const { seconds, audio, sceneCutAtSec, rotate90 } = opts
  const out = join(dir, `video-${process.pid}-${counter++}.mp4`)
  const args = ['-v', 'error', '-y']

  let filter: string
  if (sceneCutAtSec !== undefined) {
    args.push('-f', 'lavfi', '-i', `color=c=black:s=640x360:r=10:d=${sceneCutAtSec}`)
    args.push('-f', 'lavfi', '-i', `color=c=white:s=640x360:r=10:d=${seconds - sceneCutAtSec}`)
    filter = '[0:v][1:v]concat=n=2:v=1:a=0[v]'
  } else {
    args.push('-f', 'lavfi', '-i', `testsrc2=s=640x360:r=10:d=${seconds}`)
    filter = '[0:v]null[v]'
  }
  const audioIndex = sceneCutAtSec !== undefined ? 2 : 1
  if (audio === 'tone') args.push('-f', 'lavfi', '-i', `sine=f=440:r=16000:d=${seconds}`)
  if (audio === 'burst') {
    // Seno a -40 dBFS com 1 s a -6 dBFS no segundo 4.
    const expr = "'if(between(t,4,5),0.5,0.01)*sin(2*PI*440*t)'"
    args.push('-f', 'lavfi', '-i', `aevalsrc=${expr}:s=16000:d=${seconds}`)
  }
  args.push('-filter_complex', filter, '-map', '[v]')
  if (audio !== 'none') args.push('-map', `${audioIndex}:a`, '-c:a', 'aac')
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-t', String(seconds))

  if (!rotate90) {
    await runTool(ffmpegPath(), [...args, out], { timeoutMs: 60_000 })
    return out
  }
  // Rotação como metadado (display matrix): remux sem recodificar.
  const plain = out.replace(/\.mp4$/, '-plain.mp4')
  await runTool(ffmpegPath(), [...args, plain], { timeoutMs: 60_000 })
  await runTool(
    ffmpegPath(),
    ['-v', 'error', '-y', '-display_rotation:v:0', '90', '-i', plain, '-c', 'copy', out],
    { timeoutMs: 60_000 },
  )
  return out
}
