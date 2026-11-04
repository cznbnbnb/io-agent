# iO Agent 桌面图标

沿用产品青绿色，以几何 iO 字标区分原厂应用。底色 `#008B72`，字标 `#FFFFFF`，i 的圆点 `#B4F8E4`；不使用原厂标志、字体文件或外部图标库。仅更换桌面图标，不更改应用内 UI。

108 单位画布、24 单位圆角，主体居中；不添加渐变、阴影或角标，确保小尺寸清楚。SVG 为矢量交付，五种 PNG 对应当前固定宿主 1.0.10 的 launcher 资源；资源 ID 不变，不改资源表或无关图片。后续正式独立 App 应使用自己的 adaptive icon 资源；当前 PNG 不冒充 adaptive icon。

重新生成：`python3 tools/android/render-launcher-icon.py`（仅生成时需要 Pillow）。构建直接读取已提交的 PNG，不新增手机或构建运行时依赖。最终打包审计逐字节核对五个替换项，其他原厂资源仍必须保持原样。

图标变化不等于包名迁移，也不能改变签名或系统扫描结果。参见 `docs/research/app-coexistence-2026-11-03.md`。
