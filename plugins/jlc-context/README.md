# JLCEDA Agent DSH 插件

包名：`@jlc-agent/dsh-context`。这是本仓库提供的本地包，尚未发布 npm；`private: true` 防止意外发布。

项目的 `setup.ps1` 通过 `runtime/package-lock.json` 安装 `file:../plugins/jlc-context`，并将包名加入独立 DSH web profile 的 `dsh.profile.bundles`。`host/dsh-profile.cjs` 将这个已安装包链接到独立 profile 的 `node_modules`，使用相对 `file:` 依赖记录来源，不使用全局 npm link 或修改 DSH 解析器。DSH 读取本包的 `dsh.bundle.patch`，按包名加载 Node 和浏览器入口。宿主的进程级 overlay 只提供当前 IPC 管道与调试参数，不再注册源码文件路径。

插件列表和组件标识显示名称与包名。详情页的“来源信息”仍保留 DSH 原生的本地文件路径，方便检查实际加载位置；它不是插件标识符。

本包集中提供：

- `prompt.cjs`：嘉立创专用提示词和实时上下文，要求读取状态、执行操作、独立回读验证。
- `skills/`：原理图与 PCB 技能及按需加载的流程参考，复用现有 MCP 工具。
- `index.cjs`：`jlceda_context/help/discover/call` 工具，转交宿主校验后调用嘉立创原生 MCP；不另造 EDA API。
- `client.js`：工程工作区与会话绑定、MCP 状态、顶部栏、设置、主题和菜单。
- `locale/`：DSH 原生插件列表读取的名称与说明。

需要本项目的 JLCEDA Agent 宿主及配套 DSH 构建。宿主负责客户端副本、独立 profile、DOM 内嵌、工程/窗口校验及原生 MCP 生命周期。仅将此包安装到普通 DSH 中不能独立控制 EDA；缺少宿主管道时会明确报错。

目前这些功能共享工程和会话生命周期，保持一个包。将来可独立使用的器件搜索、封装生成或报价功能再单独成包。

本地包源码由版本控制管理；运行数据、模型凭据、客户端和宿主管道地址不属于包内容。

## 原理图与 PCB 技能

- `jlceda-schematic`：原理图设计、局部修改、连接检查、器件与封装核对、验证和交付。
- `jlceda-pcb`：原理图到 PCB 的交接、布局、布线、铺铜、规则检查与阶段交付。

两者通过 DSH 原生 `dsh-skill-filesystem` 的独立 `jlc-agent` provider 注册；只加载本包的 `skills/`，不重复扫描预设负责的工程或用户目录。名称和描述来自 `SKILL.md`，正文通过原生 `skill` 工具按需加载，`references/` 由模型按任务读取。资源路径相对包位置计算，不依赖开发机路径或 `vendor/`。插件卸载时原生生命周期移除技能目录，重启后读取更新的内容。

标准与 PTC 预设均保留原生技能加载能力。用户可以直接描述任务，由模型依据技能目录加载；也可以输入 `/jlceda-schematic` 或 `/jlceda-pcb` 显式调用。它们可以在同一工程会话中组合使用，不更改 Agent 预设，不因切换图页自动启动任务。其他自定义预设若未挂载原生 `dsh-tool-skill`，不会自动获得这两种调用入口。

新设计使用完整流程，局部修改只执行相关步骤，只读审查不自动修复。跨图页阶段重新核实目标，每个读取→修改→回读操作保留同一 `documentTabId`。原生方法与参数仍由当前客户端的 help/discover/doc.api 确认；本次没有新增 EDA 工具、生成器或 API 桥接，也没有改动权限和沙箱。技能是模型指导，不是代码强制的检查器；实际 ERC/DRC、连接和保存结果必须来自工具证据。

修改技能或 Node 入口后需要重新启动项目副本的 DSH；不需要为这次技能变更重新构建前端。自动化回归命令：

```powershell
.\.tools\node_modules\node-win-x64\bin\node.exe --test .\scripts\verify-domain-skills.cjs
```

回归使用真实 npm 包与锁定 DSH 服务，覆盖迁移路径、目录发现、工具/斜杠加载、PTC 工具呈现和卸载重载。PTC 项只检查目录与 SDK 呈现，不执行沙箱程序；这项测试不启动 EDA、不请求模型，也不声称已验证模型实际绘图质量。
