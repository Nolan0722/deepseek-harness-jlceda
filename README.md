# JLCEDA Agent

将 DeepSeek Harness 嵌入嘉立创 EDA 的原生 Agent 侧栏。使用独立客户端副本、独立 profile 和 DSH_HOME，直接复用嘉立创原生 MCP。会话绑定所属 EDA 窗口、工程和工程目录；主要支持 `.eprj3`，`.eprj2` 保留基本支持。

顶部使用单行布局，直接显示会话名称与 Agent 模式。工程、活动图页、MCP 实际连接状态、会话与工程的绑定关系集中在关联状态按钮的详情中；异常状态会在按钮上标记。工程工作区和会话历史通过文件夹按钮打开，齿轮打开原生设置。默认只展示对话，不显示轨迹切换和日志下载菜单；后台轨迹记录及原生日志导出能力保留。

## 安装

准备 Windows x64、带 npm 的 Node.js，以及 Git for Windows（提供 OpenSSL）。也可以单独提供 OpenSSL。Windows 的 .NET Framework C# 编译器用于生成无控制台启动器，不需要安装 Visual Studio。

```powershell
git clone https://github.com/Nolan0722/deepseek-harness-jlceda.git
cd deepseek-harness-jlceda
.\setup.ps1 -ClientPath 'D:\你自己的嘉立创安装目录'
# 若未安装 Git for Windows：
# .\setup.ps1 -ClientPath '<客户端目录>' -OpenSslPath '<openssl.exe 路径>'
.\JLCEDA-DSH.exe
```

客户端由使用者自行提供。安装器不会下载或修改原安装，也不会导入原安装或其他 DSH 的凭据、会话和 profile。模型账号/API Key 在独立侧栏内自行配置。首次安装需要联网恢复 npm 锁文件中的依赖。全新 profile 可能先显示嘉立创自己的“激活客户端”页面，需要使用者在原生页面导入自己的激活文件；这与 DSH 的模型账号配置是两件事，安装器不绕过激活，也不复制其他 profile 的授权资料。

安装器不限定嘉立创版本号：它发现本机客户端的 UI 资源目录，从用户提供的源码 bundle 动态分析所需结构、定位符号、生成补丁，并验证唯一匹配与 JavaScript 语法。版本信息仅用于报告。由于侧栏仍依赖私有接口，**不保证任意版本都兼容**；若客户端缺少原生 MCP、目标结构变化、资源打包方式不支持或匹配不唯一，安装器会停止并记录 `lab/setup/failure.json`，不会尝试猜测或更改原安装。目前完整实机回归只覆盖开发时提供的客户端；其他版本需要各自验证。

无需安装 DSH 桌面客户端，也无需安装或运行 REA。DSH、项目内 Node 及构建工具按锁文件恢复；构建不读取 `vendor/`、旧快照或本机历史分析结果。DSH 依赖版本锁定是为了重现本项目的定制，与嘉立创版本选择无关。

## 本地文件与重新安装

- `host/`、`plugins/`、`scripts/`、`setup.ps1`、依赖清单和锁文件：可提交的项目源码。
- `lab/client/`：从使用者提供的安装生成的独立客户端副本。
- `lab/profile/`、`lab/dsh-home/`：本机 profile、凭据、工程及会话数据。
- `lab/profile/dsh-temp/`：供原生 Windows 沙箱使用的应用私有临时根目录。
- `lab/tls/`：本机生成的证书和私钥，不导入系统证书信任库。
- `lab/setup/`：本机源客户端哈希、适配结果和安装记录。
- `.cache/`、`evidence/`、`node_modules`、生成的 EXE：可重建的本地文件，不提交。

`.gitignore` 排除了客户端、运行数据、凭据文件、证书和本机历史记录。不要将这些目录作为源码包手动上传。上游声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

关闭本项目的客户端后，可以重新运行 `setup.ps1` 更新副本；profile 和 DSH_HOME 保留在副本之外。宿主引导使用相对路径，不写入开发电脑的绝对路径。移动已安装目录时，工程和历史会话中的绝对路径不自动迁移，建议在新目录从源码重新安装并重新打开工程。不要直接搬运旧的已补丁客户端、凭据或证书。新建目录进行源码安装时会创建全新的本地数据。

只更新顶部栏等 DSH 前端代码时，可在关闭副本后运行 `.\.tools\node_modules\node-win-x64\bin\node.exe .\scripts\build-dsh-sidebar.cjs`，再重新启动副本。构建器从锁定的原始包重建，并核对上次生成文件的哈希；可直接更新本项目旧的生成产物，遇到未记录的手工修改会停止。它不修改 profile、模型凭据或会话。仅改源码或刷新旧页面不会自动更新已经加载的组件。

```powershell
# 按本次安装记录复核使用者提供的原安装未变动
.\scripts\verify-original.ps1
# 调试模式：仅用于本机自动化回归，开放回环 CDP 9431
.\JLCEDA-DSH.exe --debug
```

调试模式的原生进程输出保存在 `lab/logs/native-debug.log`，普通启动不记录这份调试输出。退出时会等待原生请求及其数据库关闭完成，再释放 Electron 环境。

## 自动化验证

无需模型凭据的检查：

```powershell
$node = '.\.tools\node_modules\node-win-x64\bin\node.exe'
& $node --test .\scripts\verify-folder-project.cjs .\scripts\verify-project-binding.cjs .\scripts\verify-frame-bridge.cjs .\scripts\verify-dsh-network.cjs .\scripts\verify-mcp-transport.cjs .\scripts\verify-project-ready.cjs .\scripts\verify-startup-status.cjs .\scripts\verify-dsh-temp.cjs .\scripts\verify-native-request-lifecycle.cjs
# 在已完成 setup、没有其他客户端实例占用调试端口的目录内执行：
& $node .\scripts\verify-portable-runtime.cjs
# 独立测试安装完成原生激活后，验证顶部栏并截图；脚本自动启动和退出该副本：
& $node .\scripts\verify-topbar.cjs
# 另建仅含源码的本地 Git 仓库，克隆到全新目录并执行 setup 和运行回归：
.\scripts\verify-clean-clone.ps1 -ClientPath '<你的客户端目录>' -Destination '<尚不存在的验证目录>'
```

运行回归使用本机脚本、原生 CLI/MCP、CDP 和无界面浏览器，不使用 Computer Use，不提交模型请求。浏览器首次配置回归使用本机 Edge，通过 Playwright 的浏览器通道发现路径。真实模型回复仍需使用者配置模型后自行验证。若尚未完成嘉立创原生激活，运行回归会明确报告 CLIENT_ACTIVATION_REQUIRED。仅用于本机全自动测试时，可以显式传入 `--activation-file <本机激活文件路径>`，通过原生激活页面导入；此文件不会复制进源码或提交到 Git。

Windows PTC 保留原生沙箱、受限令牌、能力 SID、完整性标签及审批机制。工程目录若缺少设置完整性标签所需的权限，通过 DSH 自带 `diagnose-windows-sandbox-acl` 按明确授权的工程目录诊断修复；安装器不自动扩大工程权限，不关闭沙箱。私有 DSH 临时根目录在创建时设置所需的可继承权限；已有异常权限或目录联接会被拒绝。
