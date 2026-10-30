# JLCEDA Agent

将 DeepSeek Harness 嵌入嘉立创 EDA 的原生 Agent 侧栏。使用独立客户端副本、独立 profile 和 DSH_HOME，直接复用嘉立创原生 MCP。会话绑定所属 EDA 窗口、工程和工程目录；主要支持 `.eprj3`，`.eprj2` 保留基本支持。

顶部使用单行布局，直接显示会话名称与 Agent 模式。工程、活动图页、MCP 实际连接状态、会话与工程的绑定关系集中在关联状态按钮的详情中；异常状态会在按钮上标记。工程工作区和会话历史通过文件夹按钮打开，齿轮打开原生设置。默认只展示对话，不显示轨迹切换和日志下载菜单；后台轨迹记录及原生日志导出能力保留。

自有插件包含原理图与 PCB 技能，可直接描述任务，或使用 `/jlceda-schematic`、`/jlceda-pcb` 显式调用。流程按“读取真实状态 → 执行操作 → 回读验证”组织，区分新设计、局部修改和只读检查，继续复用嘉立创原生 MCP；技能不替代实际连接、ERC/DRC 或保存验证。技能正文和参考资料位于 `plugins/jlc-context/skills/`，详见 [插件文档](plugins/jlc-context/README.md)。

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
# 原理图/PCB 技能：实际打包、原生发现与加载、PTC 呈现、卸载重载；不启动 EDA：
& $node --test .\scripts\verify-domain-skills.cjs
& $node --test .\scripts\verify-folder-project.cjs .\scripts\verify-project-binding.cjs .\scripts\verify-frame-bridge.cjs .\scripts\verify-dsh-network.cjs .\scripts\verify-mcp-transport.cjs .\scripts\verify-project-ready.cjs .\scripts\verify-startup-status.cjs .\scripts\verify-dsh-temp.cjs .\scripts\verify-native-request-lifecycle.cjs
# 在已完成 setup、没有其他客户端实例占用调试端口的目录内执行：
& $node .\scripts\verify-portable-runtime.cjs
# 独立测试安装完成原生激活后，验证顶部栏并截图；脚本自动启动和退出该副本：
& $node .\scripts\verify-topbar.cjs
# 仅回归 slot 迁移：真实工程/MCP、菜单、设置、右侧预览与退出：
& $node .\scripts\verify-topbar.cjs --slots-only
# 工作区入口清理：原生快捷键阻止、历史保留、跨工程调用拒绝及新会话绑定：
& $node .\scripts\verify-topbar.cjs --workspace-only
# 输入框：原始窗口尺寸、窄/宽栏、长历史与新会话；实际输入但不发送：
& $node .\scripts\verify-topbar.cjs --composer-only
# 包含原生模块热更新：验证输入框不会因会话服务尚未就绪而消失：
& $node .\scripts\verify-topbar.cjs --composer-only --composer-reload
# 独立无凭据 DSH profile，真实插件及模型引导；空工程父窗口使用测试夹具：
& $node .\scripts\verify-sidebar-onboarding.cjs
# 另建仅含源码的本地 Git 仓库，克隆到全新目录并执行 setup 和运行回归：
.\scripts\verify-clean-clone.ps1 -ClientPath '<你的客户端目录>' -Destination '<尚不存在的验证目录>'
```

运行回归使用本机脚本、原生 CLI/MCP、CDP 和无界面浏览器，不使用 Computer Use，不提交模型请求。浏览器首次配置回归使用本机 Edge，通过 Playwright 的浏览器通道发现路径。真实模型回复仍需使用者配置模型后自行验证。若尚未完成嘉立创原生激活，运行回归会明确报告 CLIENT_ACTIVATION_REQUIRED。仅用于本机全自动测试时，可以显式传入 `--activation-file <本机激活文件路径>`，通过原生激活页面导入；此文件不会复制进源码或提交到 Git。

Windows PTC 保留原生沙箱、受限令牌、能力 SID、完整性标签及审批机制。工程目录若缺少设置完整性标签所需的权限，通过 DSH 自带 `diagnose-windows-sandbox-acl` 按明确授权的工程目录诊断修复；安装器不自动扩大工程权限，不关闭沙箱。私有 DSH 临时根目录在创建时设置所需的可继承权限；已有异常权限或目录联接会被拒绝。

## DSH 扩展与剩余源码改动

自有插件统一为本地包 `@jlc-agent/dsh-context`，源码位于 `plugins/jlc-context/`，没有发布 npm。`setup.ps1` 按锁文件安装本地 `file:` 依赖，并通过 DSH 原生 `dsh.profile.bundles` / `dsh.bundle.patch` 注册；插件管理显示 **JLCEDA Agent** 和包名，不再显示源码文件绝对路径。提示词、工程绑定、工具代理和侧栏定制保持一个包，说明见 [插件文档](plugins/jlc-context/README.md)。宿主仍负责客户端隔离、DOM 内嵌和原生 MCP；单独安装该包不能代替宿主。更新到此包结构后需关闭副本并运行一次 `setup.ps1`，仅重建前端不能安装新增依赖。

`plugins/jlc-context/client.js` 通过原生 slot 的 `priority` 覆盖日志导出菜单、预览版引导、账户式设置入口和右栏展开按钮。官方注册、后台日志及 `/export` 命令保留；引导通过原生 `complete()` 继续到模型登录/API Key 配置。卸载项目插件时，slot 自动恢复官方 occupant，不修改官方组件方法或 DOM 点击行为。

顶部栏与设置弹窗的呈现由自有 `SessionHeader` / `SettingsPanel` 组件负责，布局使用自有 CSS 类。会话标题、原生模式、栏目顺序、栏目图标、响应式弹窗以及账户栏目的显示策略均集中在插件内。插件管理、内置插件、自动化、模型与 Agent 预设的页面内容和业务动作继续使用 DSH 原生组件。

上游目前没有这两个内部展示扩展点，因此构建保留两处小型 slot 接入：`conversation.session.header.presentation` 与 `settings.panel`。它们是本项目增加的 slot，**不是上游已有 API**。原生注册仍独占其 store、生命周期和子 slot，通过 `native` 参数委托已经绑定的 props 与 `renderSlot`；插件不重建 store、不重复声明子 slot、不替换运行中的方法。官方呈现作为默认注册保留，项目插件按原生优先级规则替换它；没有自建异常兜底或 DOM 拦截。

`scripts/build-dsh-sidebar.cjs` 当前修改 8 个前端产物，并核对/恢复 4 个原始产物：`session-log-export`、`ui-settings-models`、`ui-settings-account`、`ui-trajectory` 已完全恢复官方字节。未启用的轨迹不再维护改色补丁。重复构建只接受官方原件、本次输出或上一构建记录确认的输出，不覆盖未知改动。

工作区入口使用原生目录选择能力判断：部署禁用 `directory-picker` 后，原生按钮和菜单自动隐藏，`workspace.add` 快捷键保留注册但被原生逻辑阻止。已撤掉按钮/菜单删除、快捷键删除、`controls.add` 空实现和选择目录回调抑制。`uiWorkspace.startSession` 仍统一创建当前 EDA 工程的会话，即使调用方传入其他工作区；只读工程工作区及服务端窗口/工程绑定校验保持不变。

会话模块另保留一处生命周期修复：用原生 Cordis `ctx.inject(['conversation'], ...)` 仅将输入框组件的注册绑定到会话服务就绪。其他会话扩展点仍先于服务发布建立，确保原生 Agent 预设等组件能正常注册。上游热更新时曾先挂载输入框、再启动服务，触发 `conversation service unavailable` 并使输入框落入 slot 错误边界；此处只修正依赖顺序，不增加重试、替代输入框或禁用热更新。

仍保留的源码改动包括上述展示接入点、跨组件设置导航服务、插件管理和自动化页面的挂载/导航、工程会话创建路由、只读工作区按钮、右栏内部折叠控制和部分主题图形。工作区 slot 仅拥有选择弹窗，不拥有触发按钮。DOM 内嵌所需的认证 Cookie 与安全响应头为另外两处后端改动。
