# 狗头军师 · 微信 ClawBot

在微信里把一段对话或一张聊天截图发给 ClawBot，军师会在同一会话给你回复建议。运行在自己的云服务上，电脑关机后也可继续使用。微信插件接收发给机器人的消息，能分析的历史限于你主动提供的内容。

[![部署到 Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/dongzhaohe321418-lab/goutoujunshi-clawbot)

模板使用一台 2 GB 的付费 Render 实例和 1 GB 持久盘。按 2026 年 11 月公开价格，持续运行约 **25.25 美元/月**，模型调用另计。创建前请核对 Render 显示的费用。[Render 价格](https://render.com/pricing)

## 部署和扫码

1. 点击上方部署按钮，在 Render 连接有仓库访问权的 GitHub 账号，选择此仓库的 `main` 分支。如果部署自己的 fork，先更新按钮链接，见下文。
2. 填写下面三个值并确认创建服务。首次启动会自动安装固定版本的腾讯插件。
3. 服务显示 **Live** 后，在电脑上打开 Render 给出的 **onrender.com 服务网址**。浏览器弹出登录框时，用户名填 **admin**，密码填你设置的 `ADMIN_PASSWORD`。页面会自动显示本次绑定的二维码。
4. 在手机微信点「扫一扫」，扫描页面上的码并确认。如果手机显示数字，就在网页输入。看到「已连接微信」后，打开手机上的 **微信 ClawBot** 会话，发一句「对方问我周末要不要喝咖啡，我想去，怎么回？」。

| 部署时填写 | 填什么 |
| --- | --- |
| `MODEL_API_KEY` | 模型服务商给你的 API 密钥。使用有模型调用权限和额度的密钥。 |
| `MODEL_ID` | 该密钥可用、支持 Chat Completions 和工具调用的模型 ID。分析截图需要模型支持图片输入。 |
| `ADMIN_PASSWORD` | 自己设定的至少 16 个字符的管理员密码，用于打开绑定页。 |

默认模型接口为 `https://api.openai.com/v1`。其他兼容服务需要在 Render 的环境设置中填写自己的 `MODEL_BASE_URL`（例如供应商提供的、以 `/v1` 结尾的基础地址），并使用同一供应商的密钥和模型 ID。纯文本模型请设置 `MODEL_VISION=false`。

## 后续自动部署

Render 的 GitHub 集成需要有权读取仓库。配置为 `After CI Checks Pass` 后，推送到已绑定分支会先运行 GitHub Actions，在 Linux 上测试扫码、验证码、消息收发和重启，然后由 Render 自动发布。持久盘保存微信绑定、会话和同步位置。重新部署期间服务会短暂停止，启动后继续接收消息。一个微信绑定使用一个运行实例。[Render 自动部署文档](https://render.com/docs/deploys) · [持久盘文档](https://render.com/docs/disks)

使用 fork 时，可运行 `npm run prepare:github -- 你的GitHub用户名/仓库名` 并提交 README，部署按钮就会指向你的版本。若 Render 当作普通公开 URL 接入，请改为通过 GitHub App 连接仓库，才能接收后续推送事件。

## 运行与排查

- **二维码过期**：保持绑定页打开。腾讯插件会尝试刷新，页面提示绑定未完成时点「重新获取二维码」。
- **需要重新登录微信**：在绑定页点「重新绑定微信」，用原微信账号完成确认。每个服务供一个管理员使用。
- **已连接但没有收到建议**：先确认消息发在微信 ClawBot 会话，再检查 Render 日志及模型密钥、模型 ID 和余额。「已连接」表示后台网关就绪，首次真实回复同时验证微信和模型服务。
- **隐私**：文字和图片会经腾讯、你部署的服务器和你选择的模型服务商处理。OpenClaw 可在持久盘保留会话和附件。管理员密码、API 密钥和短时二维码都请保存在自己的部署环境；绑定页使用 HTTPS 和浏览器身份验证。此版本仅提供会话内建议，由你决定是否把草稿发给好友。
- **本地验证**：使用 `.node-version` 指定的 Node 版本，执行 `npm ci`、`npm test` 和 `python3 test/smoke.py`。端到端测试使用合成账号、测试图片和本地模拟接口。要手动运行，设置表中的环境变量后运行 `BIND_ADDRESS=127.0.0.1 npm start`，打开 `http://127.0.0.1:10000`。本地状态默认保存在已由 Git 忽略的 `.data/`。

## 实现与来源

网页负责显示短时二维码和提交微信要求的验证码。腾讯插件负责扫码认证及微信消息收发。OpenClaw 在服务器内部运行，根据随仓库发布的中文军师规则和知识库生成建议。管理页面和接口使用管理员身份验证，公开健康检查只返回服务状态。

关系分析规则与资料改编自 [shengjidaguai-china/goutoujunshi](https://github.com/shengjidaguai-china/goutoujunshi/tree/6db7354a4002dc7c448a9c87ffdad8132570c9d3)，保留原作者的 [MIT 许可证](LICENSE)。接入采用 [腾讯 OpenClaw 微信插件](https://github.com/Tencent/openclaw-weixin) 和 [OpenClaw](https://github.com/openclaw/openclaw)。
