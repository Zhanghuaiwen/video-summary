import { spawn } from 'child_process'

export interface RunCallbacks {
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
}

export interface RunOptions {
  /** 非零退出码不视为失败，返回原始输出（用于 ffmpeg -i 探测等场景） */
  allowNonZero?: boolean
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

function emitLines(text: string, cb: ((line: string) => void) | undefined): void {
  if (!cb) return
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) cb(line)
  }
}

export function runCommand(cmd: string, args: string[], callbacks?: RunCallbacks, options?: RunOptions): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stdout += chunk
      emitLines(chunk, callbacks?.onStdout)
    })
    child.stderr?.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stderr += chunk
      emitLines(chunk, callbacks?.onStderr)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0 || options?.allowNonZero) {
        resolve({ code: code ?? -1, stdout, stderr })
      } else {
        reject(new Error(`命令失败(${cmd}) code=${code}: ${stderr.trim().slice(0, 500)}`))
      }
    })
  })
}
