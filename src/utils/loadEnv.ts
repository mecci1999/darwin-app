import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'

export const resolveProjectRoot = () => path.resolve(__dirname, '../..')

export const loadProjectEnv = () => {
  const projectRoot = resolveProjectRoot()
  const envFile = process.env.NODE_ENV ? `.env.${process.env.NODE_ENV}` : '.env'
  const candidates = [
    path.resolve(projectRoot, envFile),
    path.resolve(projectRoot, '.env'),
    path.resolve(projectRoot, 'docker/.env')
  ]

  candidates.forEach((filePath) => {
    if (fs.existsSync(filePath)) {
      dotenv.config({ path: filePath, override: false })
    }
  })

  return { projectRoot, envFile, candidates }
}

loadProjectEnv()
