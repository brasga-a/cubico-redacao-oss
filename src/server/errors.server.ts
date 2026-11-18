import '@tanstack/react-start/server-only'
import type { AppErrorCode, SafeError, ServerResult } from '../lib/correction'

export type { AppErrorCode, SafeError, ServerResult }

export class AppError extends Error {
  readonly code: AppErrorCode

  constructor(code: AppErrorCode, message: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
  }
}

export function toSafeError(error: unknown): SafeError {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message }
  }

  return {
    code: 'INTERNAL',
    message: 'Ocorreu um erro inesperado. Tente novamente em instantes.',
  }
}
