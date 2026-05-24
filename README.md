# 作品名称：校园跑步路线规划器

项目英文名：`PacePath`

## 1. 项目简介

本项目是一个面向高校校园场景的跑步路线规划工具。用户可以在校园手绘地图上选择起点、终点和途经点，输入目标跑步距离，系统自动生成尽量接近目标距离的可跑路线，并在地图上直观展示。

目标用户：

- 校园跑步用户（学生、教职工）
- 校园活动组织者（晨跑、社团活动）
- 需要固定距离训练的跑者

解决的问题：

- 校园内部道路复杂，难以快速规划合适路线
- 常见导航应用更偏向通勤，不强调跑步距离匹配
- 用户希望结合校园熟悉地点进行路线规划

## 2. 核心功能

- 校园地图显示
- 地点选择
- 起点 / 终点 / 途经点设置
- 跑步距离输入
- 路线生成
- 路线长度估算
- 地图路线可视化

补充：

- `Running Route Planner`：支持目标距离与候选路线
- `Shortest Route Navigation`：输出最短路径与距离

## 3. 技术方案

- React + Vite + TypeScript
- CSV 数据驱动
- SVG 地图叠加
- 道路 graph 构建
- Dijkstra 最短路径算法
- 跑步距离近似生成算法

实现思路简述：

1. 从 CSV 读取地点与道路数据
2. 将道路几何（LINESTRING）解析为图结构（nodes + edges）
3. 最短路径使用 Dijkstra 求解
4. 目标距离模式下生成多候选，并按误差与质量标签排序

## 4. 数据说明

主要数据文件位于 `public/data`：

- `public/data/csv/place-annotated.csv`：地点数据（名称、坐标、可路由标记等）
- `public/data/csv/place-road-mapping.csv`：地点与道路关联信息
- `public/data/guide_roads.csv`：道路网络主数据（含几何、属性）
- `public/data/meta/map-calibration.json`：像素与实际距离换算校准数据

主要图片资源：

- `public/data/images/maps/cover-map.jpg`：Home 封面图
- `public/data/images/guides/campus-guide.jpg`：规划页地图底图
- `public/data/images/logo/logo.png`：导航栏 Logo

## 5. 运行方式

安装依赖：

```bash
npm install
```

本地开发：

```bash
npm run dev
```

构建生产包：

```bash
npm run build
```

本地预览生产包：

```bash
npm run preview
```

## 6. 部署方式

项目使用 GitHub Pages 静态部署（GitHub Actions 自动发布）。

已包含工作流文件：

- `.github/workflows/deploy-pages.yml`

部署步骤：

1. 推送代码到 `main` 分支
2. GitHub 仓库 `Settings -> Pages`
3. `Source` 选择 `GitHub Actions`
4. 等待 `Deploy to GitHub Pages` 工作流成功

访问地址：

```text
https://<你的用户名>.github.io/<仓库名>/
```

## 7. 项目目录结构

```text
PacePath/
|- public/
|  |- data/
|     |- csv/                     # 地点与映射 CSV
|     |- images/                  # 地图、封面、Logo
|     |- meta/                    # 校准信息
|     |- guide_roads.csv          # 道路主数据
|- src/
|  |- components/
|  |  |- LandingPage.tsx          # Home 封面页
|  |  |- TopNav.tsx               # 顶部导航栏
|  |  |- Planner.tsx              # 规划核心界面（跑步/最短路径）
|  |  |- HelpPage.tsx             # 帮助页
|  |- hooks/                      # 数据加载与图构建 hooks
|  |- lib/                        # 路由算法、距离换算、CSV/WKT 解析
|  |- App.tsx                     # 页面路由入口
|  |- main.tsx                    # 应用启动入口
|- .github/workflows/
|  |- deploy-pages.yml            # GitHub Pages 自动部署
|- vite.config.ts                 # Vite 配置
```

## 8. 创新点

- 面向校园跑步场景，而非通用通勤导航
- 在手绘校园地图上直接交互选点，降低使用门槛
- 支持“目标距离优先”的路线生成，而不只是最短路径
- 对超出目标距离的路线分段标注热身/放松路程
- 提供最短路径模式与跑步训练模式双工作流

## 9. 局限性与后续优化

当前局限：

- 路线质量依赖道路 CSV 数据精度
- 距离估算基于像素校准，存在近似误差
- 候选路线解释信息可进一步可视化（如图例、分段详情）

后续优化方向：

- 增加实时路线编辑（拖拽节点）
- 增强地点搜索与分类筛选
- 加入配速、预计时间、海拔等训练指标
- 提供多校园数据切换与后台标注工具
- 增加 PWA 离线能力与移动端交互优化
