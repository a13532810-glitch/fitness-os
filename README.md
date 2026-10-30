# Fitness OS

简体中文、手机优先的个人健身记录 PWA。无需登录，不使用Notion API、云数据库、付费AI、广告或统计SDK。实际成绩保存在当前设备的IndexedDB，不随源码发布。

GitHub Pages目标地址：<https://a13532810-glitch.github.io/fitness-os/>。部署状态以仓库Actions/Pages为准。公开网页和源码不提供私人访问控制；导出的健康JSON请自行安全保管，切勿提交仓库。

## iPhone 使用

1. Safari打开上述HTTPS地址，无需局域网证书或保持Mac开机。
2. 可先选择独立虚构演示；正式空间只填写真实完成的训练。
3. 分享菜单 → 添加到主屏幕，如有「作为网页App打开」保持开启。
4. 从固定主屏幕入口联网打开一次，等候离线资源准备，再测试飞行模式冷启动。
5. 先配置默认器械和动作方式，再点开始记录；实际重量/次数默认留空，上次成绩只作参考。「记录」查看历史，「趋势」筛选同器械条件。

浏览器刷新、退出和设备重启后应核对数据；Safari与主屏幕入口是否共享以实际系统表现为准。不同origin不会自动同步或迁移。正式使用前完成一次备份恢复测试，建议每周导出。

## 本地开发

需要Node.js 24与pnpm 11.25.0：

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
pnpm build
pnpm preview
```

本地默认为根路径 `/`。GitHub Pages构建使用 `FITNESS_BASE_PATH=/fitness-os/`，脚本、图标、manifest的id/start_url/scope、SW注册范围及导航回退均使用该路径。当前五个导航页面由应用内状态管理，不依赖服务器的任意深层URL重写。

```sh
pnpm exec playwright install chromium webkit
pnpm build
pnpm test:e2e
```

测试使用临时隔离数据库与浏览器配置，不操作用户真实库。生命周期测试会临时替换并恢复dist，不与发布或其他测试实例同时运行。自动化不能代替真实iPhone Safari验收。

## 发布

仓库Settings → Pages → Source选择GitHub Actions。`.github/workflows/pages.yml`对main提交运行18项数据测试、锁定依赖构建、上传静态dist并发布。没有后端服务或健康数据上传接口。更新静态应用不清空IndexedDB；新版本提示后先保存草稿，再更新。

公开源码严格限定31个文件。不含证书、.local、原Notion文件、用户备份、浏览器profile、机器专用启动脚本、测试生成物、node_modules或本地路径/证书指纹。

[数据模型](docs/DATA_MODEL.md) · [备份恢复](docs/BACKUP.md) · [测试报告](docs/TEST_REPORT.md) · [iPhone清单](docs/IPHONE_CHECKLIST.md) · [已知限制](docs/KNOWN_ISSUES.md)
