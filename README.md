# 0kay-poke · 互动间

在 0KAY 的独立「互动间」页面里和你的 Live2D 角色玩：戳一下、喂零食、摸摸头，还能拖动和缩放。

## 功能

- **戳不同部位**：脸 / 头 / 身体 / 脚，TA 会有不同反应，并冒出对应的对话气泡（三语言）
- **连着戳会炸毛**：短时间内连续戳同一个地方，TA 会切换到嫌弃的话术
- **喂零食**：零食从底部飞到嘴边，TA 吃掉并冒爱心
- **摸摸头**：鼠标在头顶区域来回晃动即可触发（无需按钮），TA 只说话、不做动作
- **拖动 + 滚轮缩放**：按住角色拖动，滚轮调整大小
- **活起来**：开启 `autoInteract`（眼睛/身体跟随鼠标），待机时轻微悬浮
- **好感度只读**：从 L.I.F.E（`/api/life/companion`）读取展示，互动不会改变它

## 它怎么工作的

0KAY 聊天页里那个 Live2D 实例是闭包的，第三方插件够不着，也没法让它播「被戳」动作。
所以这个插件不碰聊天页，而是开一个独立的「互动间」页面（nav + router patch），
用宿主已经挂好的 `window.PIXI.live2d.Live2DModel` 重新加载**同一个**模型，自己处理交互。

- 侧栏「互动间」入口（`nav` patch）
- `/poke` 路由加载原生 ESM 页面（`router` patch）
- 页面里 `fetch('/api/live2d')` 拿模型列表，挑一个加载
- 互动 = 轻微弹性脉冲（同步缩放，不失真）+ 优先播放模型自带 motion（TapBody / Eat / Happy 等）+ 飘粒子 + 本地话术气泡

## 安装

```powershell
curl.exe -X POST http://127.0.0.1:8080/api/plugins/install `
  -H "Content-Type: application/json" `
  -d "{\"package\":\"momomiao-nomo/0kay-poke\"}"
```

或手动构建部署：

```powershell
cd plugin-web/poke; node build.mjs
# dist/index.js -> <core>/data/plugin-ui/poke/
# core/data/ui/poke.patch -> <core>/data/ui/
```

## 本地开发

```powershell
cd plugin-web/poke
node build.mjs            # 产出 dist/index.js
```

改完 `index.js` 后重新 build，并把 `poke.patch` 里 router module 的 `?v=` 加一，避开浏览器对入口文件的缓存。

## 注意

- 需要先有一个可用的 Live2D 模型（设置页里添加过）。没有模型时页面会提示你去加一个。
- 这是纯前端玩具：好感度只读 L.I.F.E，互动不写入后端；话术是本地预置，不调用 L.I.F.E 生成。想要「AI 主动互动」那种体验，得动 Core/L.I.F.E 源码，本插件刻意没碰。
