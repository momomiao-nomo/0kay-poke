// 0KAY 戳一戳 — WebUI build step.
//
// index.js 已经是浏览器就绪的 ESM：裸 `vue` 由 WebUI 的 importmap -> host bridge
// 在运行时解析，Live2D 直接用宿主挂到全局的 window.PIXI，不需要打包 PIXI。
// 所以这一步只是把源文件复制到 dist/，pm 再把它发到 CORE_DATA_DIR/plugin-ui/poke/。
//
// 零 node_modules：整条构建就是 `node build.mjs`。

import { copyFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const dist = resolve(here, 'dist')
mkdirSync(dist, { recursive: true })

const files = ['index.js']
for (const f of files) {
  const src = resolve(here, f)
  if (!existsSync(src)) {
    console.error(`[poke] missing source file: ${f}`)
    process.exit(1)
  }
  copyFileSync(src, resolve(dist, f))
  console.log(`[poke] ${f} -> dist/${f}`)
}
