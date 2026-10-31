# Fitness OS · V1.2.1

简体中文、手机优先的个人健身记录 PWA。V1.2.1 开发候选版统一紧凑界面，并修复仅浏览就创建空白草稿；尚未发布。V1.2 精简训练录入与全站导航，以已发布的 V1.1.1（`4a10d42`）为基线，保留全部移动端修复。正式地址始终为 [GitHub Pages](https://a13532810-glitch.github.io/fitness-os/)。无需登录、后端或付费服务，训练数据只保存在本机 IndexedDB。

- [V1.2.1 交付与验收](docs/V1.2.1_ACCEPTANCE.md)
- [V1.2.1 视觉规范](docs/V1.2.1_DESIGN_SYSTEM.md)
- [V1.2.1 实施计划](docs/V1.2.1_PLAN.md)
- [V1.2.1 iPhone 待验收](docs/V1.2.1_IPHONE_CHECKLIST.md)

- [V1.2 发布与回滚说明](docs/V1.2_RELEASE.md)
- [V1.2 开发验收报告与截图](docs/V1.2_ACCEPTANCE.md)
- [V1.2 iPhone 真机检查表](docs/V1.2_IPHONE_CHECKLIST.md)

## 本地体验

Node.js 24、pnpm 11.25.0：

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm preview --port 4181
```

打开 `http://127.0.0.1:4181/`。停止服务：终端按 `Ctrl+C`。开发热更新可使用 `pnpm dev`，但离线验收必须使用生产构建。端口 4181 用于候选版验收，不触及旧版本机入口。已安装依赖的当前工作区也可用 `sh scripts/local.sh build`、`sh scripts/local.sh preview --port 4181`。

打开直接进入训练总览：选择 A/B/C → 逐动作填实际重量与次数 → 完成训练。上次成绩仅供参考；实际输入保持空白。器械配置从最近实际完成的动作带出；主动修改默认配置会优先生效。日常只填写动作、重量和次数；「添加动作」独立展示。器械信息在动作详情自愿填写，时长在训练右上角菜单。历史疲劳、感受和质量字段原样保留。打开与类型切换不持久化默认空白组，实际输入或主动填写器械配置后自动保存同一草稿。关闭等待保存；菜单区分保存草稿、放弃本次修改和删除训练。删除前确认并下载可恢复的完整 JSON。

## 审阅与验收

- [V1.1.1 验收与截图](docs/V1.1.1_ACCEPTANCE.md)
- [V1.1 改造前后截图与设计说明](docs/V1.1_VISUAL_REVIEW.md)
- [V1.1 完整交付报告](docs/V1.1_ACCEPTANCE.md)
- [测试报告](docs/TEST_REPORT.md)
- [真实 iPhone 验收清单](docs/IPHONE_CHECKLIST.md)
- [备份恢复](docs/BACKUP.md) · [数据模型](docs/DATA_MODEL.md)
- [已知问题及依赖审计](docs/KNOWN_ISSUES.md)
- [发布与回滚准备](docs/V1.1_RELEASE_PLAN.md)

```sh
pnpm test
pnpm exec playwright install chromium webkit
pnpm build
pnpm test:e2e
```

测试仅使用隔离浏览器、临时数据库与明确虚构记录，不读取用户的正式浏览器数据。完整测试会临时替换、恢复本项目 `dist`，不要同时发布或运行第二套测试。升级测试通过 Git 读取固定 V1.0 / V1.1 提交，需保留仓库历史。自动操作耗时不代表 iPhone 真人录入时间。

## 数据与版本

只连接原个人数据库 `fitness-os-real`，旧 `fitness-os-demo` 原样保留、不合并也不删除、Dexie version 1、JSON backup version 1，没有删库或迁移。旧版备份可恢复，新版导出仍使用旧版契约。健康备份为明文文件，请安全保管，勿放入仓库。换设备、清网站数据或卸载 PWA 可能造成数据丢失，iPhone / Mac 默认不自动同步；正式使用前完成备份恢复测试，之后每周备份。

## GitHub 分支与发布保护

当前开发分支：`codex/fitness-os-v1.2.1-premium`，基于已发布 V1.2 main `d4c980d`；本轮禁止合并、正式部署和 Release。历史 V1.2 开发分支：`codex/fitness-os-v1.2-minimal`。发布需用户明确授权、开发检查全部通过后再合并 `main`，通过现有 Pages Actions 部署。开发检查工作流只运行单元测试与生产构建，不具备 Pages 写权限。Pages 工作流同时限制 main 触发和 main 执行；请勿手动部署开发分支。历史 V1.2 发布授权不延伸至 V1.2.1；真实 iPhone 验收仍待执行。底部四导航为总览、训练、趋势、AI 周报；数据管理位于总览右上角菜单，训练计划仍可从总览调整。

GitHub Pages 构建使用：

```sh
FITNESS_BASE_PATH=/fitness-os/ pnpm build
```

Vite base、manifest id/start_url/scope、图标、SW scope 和导航回退均以该子路径构建。无深层 URL 路由依赖。公开网页和源码不提供私人访问控制；本轮不创建预览站点或上传用户数据。

## 目录

```text
src/          现有页面、独立训练编辑器、设计 Token、数据及分析
public/       PWA 图标
 tests/       数据安全、兼容性与分析测试
 e2e/         双引擎功能、视觉、离线、升级回滚与性能验收
 docs/        说明、截图、交付与人工验收
 scripts/     本机启动辅助
.github/      开发检查与生产发布工作流
```
