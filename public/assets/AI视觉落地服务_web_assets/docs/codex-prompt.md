请基于我提供的素材包，把「AI视觉落地服务」首页落地成真实网页 UI。

品牌信息：
- 品牌名：AI视觉落地服务
- 英文名：AI VISUAL IMPLEMENTATION SERVICE
- 定位：从商品图到完整视觉方案
- 关键词：智能、高效、专业、未来感

重要说明：
- 参考图中部分文字是「AI电商视觉策划助手」，实现时请全部替换为「AI视觉落地服务」。
- 不要把整张参考图直接作为网页背景。
- 请用 HTML / CSS / React 组件真实还原布局，文字必须是真实文本。
- 只把素材作为 logo、AI 魔方、图标、光效等元素使用。
- 优先使用 SVG 图标；AI 魔方可使用 PNG/WebP。

可用素材：
- 参考图：assets/reference/homepage-reference-original.png
- Logo：assets/logo/logo-lockup.svg、assets/logo/logo-mark.svg
- AI 魔方完整场景：assets/hero/hero-right-full-scene.webp
- AI 魔方透明版：assets/hero/ai-cube-transparent-approx.png
- 轨道装饰：assets/icons/decorative-orbits.svg
- UI 图标：assets/icons/*.svg
- 设计变量：docs/design-tokens.json

页面结构：
1. 顶部导航
   - 左侧 logo + AI视觉落地服务
   - 中间导航：产品能力、解决方案、案例、价格
   - 右侧 CTA：开始创建项目

2. Hero 区
   - 标签：AI 驱动 · 从商品图到完整视觉方案
   - 主标题：让商品图一键进化为主图、详情页与 AI 提示词
   - “AI 提示词”用科技蓝高亮
   - 副文案：智能识别商品，深度挖掘卖点与场景，自动生成高转化视觉方案与多平台 AI 提示词，助力内容创作更快、更准、更出色。
   - 按钮：立即体验、查看演示
   - 功能标签：智能识别、卖点洞察、一键生成、高效输出

3. 右侧主视觉
   - 使用 AI 魔方作为主视觉。
   - 魔方周围叠加轨道线、粒子光效、浮动标签：
     主图生成、详情页策略、AI提示词、视觉方案。
   - 不要做上传商品图卡片，不要做步骤流程卡片。

4. 数据条
   - 10,000+ 商家使用
   - 3 分钟 生成完整方案
   - 多平台 提示词支持
   - 高效输出 降本增效看得见

5. 功能卡片
   - 商品识别：精准识别商品品类、属性与核心特征，理解商品本质与使用场景
   - 卖点分析：挖掘核心卖点与用户痛点，提炼高转化的营销关键词
   - 页面结构生成：智能规划主图与详情页结构，输出可直接落地的视觉方案
   - AI 提示词输出：生成多平台、高质量 AI 提示词，支持文生图与图生图创作

视觉要求：
- 科技极简风，冰白背景，科技蓝主色，少量蓝紫光效。
- 大面积留白，玻璃拟态卡片，圆角统一，阴影柔和。
- 不要使用随机颜色，使用 docs/design-tokens.json 中的设计变量。
- 页面需适配桌面宽屏，基础响应式也要可用。
- 代码中抽离可复用组件：Header、Hero、HeroVisual、StatsStrip、FeatureCard。
- 完成后运行项目，修复 lint / typecheck / build 报错。
