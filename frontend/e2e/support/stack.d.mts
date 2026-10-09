export const FRONTEND_DIR: string
export const REPO_ROOT: string
export const SEED_ROWS: string
export const API_PORT: number
export const WEB_PORT: number
export const API_URL: string
export const WEB_URL: string
export const PYTHON: string
export function testDatabaseUrl(): string
export function backendEnv(): NodeJS.ProcessEnv
export function python(args: string[], extraEnv?: Record<string, string>, cwd?: string): void
export function seedRows(...args: string[]): void
