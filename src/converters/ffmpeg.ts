// ffmpeg: any audio/video to H.264 + AAC in a faststart MP4, which every Chromium plays.
import { MIN, type Converter } from './types'

/** Even dimensions keep libx264 happy; `?` maps make audio-only and video-only inputs work. */
export function ffmpegArgs(input: string, out: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out
  ]
}

const converter: Converter = {
  async run({ src, out, tool, exec }) {
    await exec(tool, ffmpegArgs(src, out), { timeoutMs: 30 * MIN })
    return out
  }
}
export default converter
