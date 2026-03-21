import { defineConfig } from 'vite'

// 匹配 4 字节 emoji（U+10000+）及变体选择符
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}]|\u{FE0F}|\u{200D}|[\u{2700}-\u{27BF}]/gu

/**
 * Vite 插件：在 dev server 响应中将 emoji 转义为安全格式
 * 解决 Tauri WebView2 的 UTF-8 4字节编码显示问题
 */
function emojiEscapePlugin() {
  return {
    name: 'emoji-escape',
    transform(code, id) {
      // 只处理 JS/CSS，HTML 由 transformIndexHtml 处理
      if (!id.match(/\.(js|css)$/)) return null
      EMOJI_RE.lastIndex = 0
      if (!EMOJI_RE.test(code)) return null

      EMOJI_RE.lastIndex = 0
      const ext = id.endsWith('.css') ? '.css' : '.js'

      const escaped = code.replace(EMOJI_RE, (char) => {
        const cp = char.codePointAt(0)
        if (ext === '.css') {
          return `\\${cp.toString(16).toUpperCase()} `
        }
        if (cp > 0xFFFF) {
          const hi = 0xD800 + ((cp - 0x10000) >> 10)
          const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF)
          return `\\u${hi.toString(16)}\\u${lo.toString(16)}`
        }
        return `\\u${cp.toString(16).padStart(4, '0')}`
      })

      return { code: escaped, map: null }
    },
  }
}

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 51420,
    strictPort: true,
  },
  plugins: [emojiEscapePlugin()],
})
