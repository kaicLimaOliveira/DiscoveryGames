import { ConfigError } from '@central/shared'
import { closeServices, useServices } from '../utils/services'

// Valida a configuração na subida (falha cedo listando só os nomes das variáveis) e
// encerra as conexões ao desligar.
export default defineNitroPlugin((nitroApp) => {
  try {
    useServices()
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message)
      process.exit(1)
    }
    throw err
  }
  nitroApp.hooks.hook('close', () => closeServices())
})
