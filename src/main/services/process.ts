import { spawn } from 'child_process'

export interface RunCallbacks {
  onStdout?: (line: string) => void
  onStderr?: (line: string) => void
}

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export function runCommand(cmd: string, args: string[], callbacks?: RunCallbacks): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString()
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) callbacks?.onStdout?.(line)
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString()
      for (const line of d.toString().split(/\r?\n/)) if (line.trim()) callbacks?.onStderr?.(line)
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr })
      } else {
        reject(new Error(`命令失败(${cmd}) code=${code}: ${stderr.trim().slice(0, 500)}`))
      }
    })
  })
}
