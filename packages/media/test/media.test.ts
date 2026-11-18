import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  MediaToolError,
  analyzeSignals,
  extractAudioChunks,
  ffmpegPath,
  frameTimes,
  probe,
  runTool,
  sampleFrames,
  sha256File,
} from '../src/index.js'
import { makeVideo } from '../src/testing.js'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'central-media-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('probe', () => {
  it('lê duração, resolução e áudio', async () => {
    const file = await makeVideo(dir, { seconds: 8, audio: 'tone' })
    const info = await probe(file)
    expect(info.durationMs).toBeGreaterThanOrEqual(7900)
    expect(info.durationMs).toBeLessThanOrEqual(8100)
    expect(info.video?.width).toBe(640)
    expect(info.video?.height).toBe(360)
    expect(info.audio).not.toBeNull()
  })

  it('aplica rotação', async () => {
    const file = await makeVideo(dir, { seconds: 2, audio: 'none', rotate90: true })
    const info = await probe(file)
    expect(info.video?.width).toBe(360)
    expect(info.video?.height).toBe(640)
  })

  it('de vídeo sem áudio devolve audio null', async () => {
    const file = await makeVideo(dir, { seconds: 2, audio: 'none' })
    expect((await probe(file)).audio).toBeNull()
  })

  it('de arquivo truncado rejeita com MediaToolError', async () => {
    const file = await makeVideo(dir, { seconds: 2, audio: 'tone' })
    const size = (await stat(file)).size
    await truncate(file, Math.floor(size / 2))
    await expect(probe(file)).rejects.toBeInstanceOf(MediaToolError)
  })
})

describe('extractAudioChunks', () => {
  it('com chunkSec 3 em vídeo de 8 s gera 3 blocos com offsets 0, 3000, 6000', async () => {
    const file = await makeVideo(dir, { seconds: 8, audio: 'tone' })
    const chunks = await extractAudioChunks(file, join(dir, 'chunks'), 8000, 3)
    expect(chunks.map((c) => c.offsetMs)).toEqual([0, 3000, 6000])
    for (const c of chunks) expect((await stat(c.path)).size).toBeGreaterThan(0)
  })
})

describe('analyzeSignals', () => {
  it('encontra o pico no segundo 4 e o corte de cena no segundo 5', async () => {
    const file = await makeVideo(dir, { seconds: 10, audio: 'burst', sceneCutAtSec: 5 })
    const signals = await analyzeSignals(file, 10_000)
    expect(signals.loudPeaksSec).toContain(4)
    const cut = signals.sceneCutsSec.find((s) => s >= 4.5 && s <= 5.5)
    expect(cut).toBeDefined()
    expect(signals.motion.length).toBeGreaterThan(0)
  })

  it('sem áudio devolve loudPeaksSec vazio', async () => {
    const file = await makeVideo(dir, { seconds: 4, audio: 'none' })
    expect((await analyzeSignals(file, 4000)).loudPeaksSec).toEqual([])
  })
})

describe('quadros', () => {
  it('respeitam intervalo mínimo de 10 s e teto de 40', async () => {
    const file = await makeVideo(dir, { seconds: 25, audio: 'none' })
    const frames = await sampleFrames(file, 25_000, join(dir, 'frames'))
    expect(frames.map((f) => f.atSec)).toEqual([0, 10, 20])
    for (const f of frames) expect((await stat(f.path)).size).toBeGreaterThan(0)
    expect(frameTimes(3 * 3_600_000)).toHaveLength(40)
  })
})

describe('runTool', () => {
  it('mata o processo no timeout', async () => {
    const err = await runTool(
      ffmpegPath(),
      ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc', '-f', 'null', '-'],
      { timeoutMs: 500 },
    ).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MediaToolError)
    expect((err as MediaToolError).code).toBe('TIMEOUT')
  })
})

describe('sha256File', () => {
  it('bate com createHash do conteúdo', async () => {
    const file = join(dir, 'dados.bin')
    await writeFile(file, 'conteúdo de teste')
    const expected = createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
    expect(await sha256File(file)).toBe(expected)
  })
})
