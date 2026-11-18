// yt-dlp falso para os testes: imita `--dump-single-json` e o download. Comportamento por env:
//   FAKE_YTDLP_MODE     ok (padrão) | fail
//   FAKE_YTDLP_DURATION duração em segundos devolvida no JSON (padrão 4)
//   FAKE_YTDLP_VIDEO    MP4 copiado para o destino do `-o`
//   FAKE_YTDLP_LOG      arquivo onde cada chamada é anotada (uma linha JSON com os argumentos)
import { appendFileSync, copyFileSync } from 'node:fs'
import process from 'node:process'

const args = process.argv.slice(2)
if (process.env.FAKE_YTDLP_LOG)
  appendFileSync(process.env.FAKE_YTDLP_LOG, JSON.stringify(args) + '\n')

if (process.env.FAKE_YTDLP_MODE === 'fail') {
  process.stderr.write('ERROR: Sign in to confirm you are not a bot\n')
  process.exit(1)
}
if (args.includes('--dump-single-json')) {
  const duration = Number(process.env.FAKE_YTDLP_DURATION ?? 4)
  process.stdout.write(JSON.stringify({ id: 'abc', duration }) + '\n')
  process.exit(0)
}
const out = args[args.indexOf('-o') + 1]
if (!out || !process.env.FAKE_YTDLP_VIDEO) process.exit(2)
copyFileSync(process.env.FAKE_YTDLP_VIDEO, out.replace('%(ext)s', 'mp4'))
