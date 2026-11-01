# Fitness OS · V1.3.0

简体中文、iPhone优先的个人力量训练与跑步机爬坡记录PWA。数据默认只保存在本机IndexedDB，无账号、云后端或付费API。正式地址：[GitHub Pages](https://a13532810-glitch.github.io/fitness-os/)。

- 力量训练以重量×次数快速记录，自动保存有效草稿，支持历史、计划及目标。
- 训练模块切换“跑步机爬坡”，首次默认40分钟、坡度10%、4.7km/h，复用最近有效参数，支持补录、同日多次、编辑与删除确认，显示本周次数/分钟。
- 身体指标日常入口已移除，历史数据仍保留在数据库和完整备份中。
- AI周报采用本地JSON/Markdown导出、外部分析及手动保存；爬坡和力量数据独立，不推算热量等未知指标。

## 开发与验证

使用Node.js 24、pnpm 11.25.0：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:e2e
FITNESS_BASE_PATH=/fitness-os/ pnpm build
```

当前本机也可使用 `sh scripts/local.sh test`、`sh scripts/local.sh build`、`sh scripts/local.sh preview --port 4181`。完整浏览器测试会临时替换并恢复dist，请勿与发布构建同时运行。测试仅使用隔离配置和虚构数据。

## 数据、更新与回滚

数据库为fitness-os-real，Dexie schema2仅增加独立爬坡表，保留原八表。旧fitness-os-demo不合并、不删除。完整备份输出version2，可恢复version1旧备份；合并按稳定ID保留已有数据，同ID不同内容保留本地。覆盖恢复必须先下载备份并明确确认。

看到更新提示后先保存训练，再更新应用；不要清除站点数据。iPhone和Mac不自动同步，建议每周导出备份。浏览器清理、卸载或存储回收可能造成数据丢失。

未经修改的schema1旧代码不保证可读取新版数据库。回滚应保留schema2及新版model/backup兼容层，通过正常修复PR恢复旧UI；不得降级数据库、删新表、强推main或覆盖旧标签。

## 发布与验收

开发分支为codex/fitness-os-v1.3.0。正常PR检查通过后合并main，由现有Pages工作流发布；线上验收通过后才创建正式标签。状态与证据以[发布报告](docs/V1.3.0_RELEASE_REPORT.md)为准。

本地单元33项、Chromium/WebKit回归98项通过。真实iPhone Safari、主屏幕PWA、软键盘、安全区及真人录入速度仍待人工验收，桌面WebKit不代替真机。

项目规范见[AGENTS.md](AGENTS.md)。严禁提交真实健康记录、IndexedDB导出、个人备份、密码或Token。

运行依赖许可证声明见 [第三方声明](public/third-party-notices.txt)。
