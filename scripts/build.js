/**
 * Tauri 前端构建脚本
 * 将所有需要的文件复制到 dist/ 目录，供 Tauri 打包使用
 * 对文本文件中的 emoji 进行转义处理，避免 WebView2 编码问题
 */

import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { resolve, dirname, extname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const dist = resolve(root, 'dist')

// 清理 dist
if (existsSync(dist)) {
  rmSync(dist, { recursive: true, force: true })
}
mkdirSync(dist, { recursive: true })

// ==================== Emoji 转义处理 ====================

// 匹配 4 字节 UTF-8 emoji（Supplementary Multilingual Plane: U+10000+）
const EMOJI_RE = /[\u{1F000}-\u{1FFFF}]|\u{FE0F}|\u{200D}|[\u{2700}-\u{27BF}]/gu

// 需要处理 emoji 的文件扩展名
const TEXT_EXTS = new Set(['.html', '.css', '.js', '.json'])

/**
 * 将 emoji 字符转义为安全格式：
 * - HTML/CSS: &#xHEX; 实体
 * - JS:  \uXXXX 代理对
 * - JSON: \uXXXX 代理对
 */
function escapeEmoji(content, ext) {
  return content.replace(EMOJI_RE, (char) => {
    const code = char.codePointAt(0)

    if (ext === '.html') {
      return `&#x${code.toString(16).toUpperCase()};`
    }

    if (ext === '.css') {
      // CSS content 属性中用 \HHHHHH 格式
      return `\\${code.toString(16).toUpperCase()} `
    }

    // JS / JSON: 用 UTF-16 代理对
    if (code > 0xFFFF) {
      const hi = 0xD800 + ((code - 0x10000) >> 10)
      const lo = 0xDC00 + ((code - 0x10000) & 0x3FF)
      return `\\u${hi.toString(16)}\\u${lo.toString(16)}`
    }
    return `\\u${code.toString(16).padStart(4, '0')}`
  })
}

/**
 * 递归处理目录：复制文件，对文本文件转义 emoji
 */
function copyWithEmojiEscape(srcDir, destDir) {
  if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true })

  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry)
    const destPath = join(destDir, entry)
    const stat = statSync(srcPath)

    if (stat.isDirectory()) {
      copyWithEmojiEscape(srcPath, destPath)
    } else {
      const ext = extname(entry).toLowerCase()
      if (TEXT_EXTS.has(ext)) {
        const content = readFileSync(srcPath, 'utf-8')
        if (EMOJI_RE.test(content)) {
          // 重置 regex lastIndex（因为用了 /g 标志）
          EMOJI_RE.lastIndex = 0
          const escaped = escapeEmoji(content, ext)
          writeFileSync(destPath, escaped, 'utf-8')
          console.log(`  escaped: ${srcPath.replace(root + '\\', '').replace(root + '/', '')}`)
        } else {
          cpSync(srcPath, destPath)
        }
      } else {
        cpSync(srcPath, destPath)
      }
    }
  }
}

// ==================== 构建 ====================

const copies = [
  { src: 'assets', dest: 'assets' },
  { src: 'data', dest: 'data' },
  { src: 'i18n', dest: 'i18n' },
  { src: 'libs', dest: 'libs' },
  { src: 'src', dest: 'src' },
]

for (const { src, dest } of copies) {
  const srcPath = resolve(root, src)
  const destPath = resolve(dist, dest)
  if (existsSync(srcPath)) {
    copyWithEmojiEscape(srcPath, destPath)
    console.log(`  copied: ${src} -> dist/${dest}`)
  } else {
    console.warn(`  warning: ${src} not found, skipping`)
  }
}

// 复制 tauri.html（已手动处理过 emoji）
cpSync(resolve(root, 'tauri.html'), resolve(dist, 'index.html'))
console.log('  copied: tauri.html -> dist/index.html')

console.log('\nBuild complete! Output: dist/')
