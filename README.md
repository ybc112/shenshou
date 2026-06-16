# 神兽发射台

神兽发射台是一套链上 Mint 发射、自动加池、交易税池、进化销毁和持币分红系统。项目支持两种创建方式：直接创建神兽 Token，或开启 Mint 发射。

## 合约模块

- `RuyiBeastLaunchpad`：发射台入口，收取创建费，部署神兽 Token，登记项目，创建 Mint 金库。
- `RuyiBeastToken`：神兽 ERC20，负责买卖税、灵气累计、进化、销毁、分红、平台分成和交易权限锁定。
- `RuyiBeastSaleVault`：Mint 发射金库。用户支付 BNB Mint，Token 发到用户钱包，同时把预留 Token 和本笔 BNB 自动加入 Pancake 流动池，LP 默认进入黑洞。
- `RuyiBeastVault`：税池金库，记录进化池、幸运池、风险池、奖励池、平台金库、销毁和分红储备。
- `RuyiBeastDeployers`：拆分部署器，降低发射台主合约体积，方便正式链部署。

## 主要机制

- 创建神兽时可选择不开启 Mint 发射，Token 直接归创建者管理。
- 开启 Mint 发射时，`saleSupply` 作为 Mint 池总额度，同时包含用户 Mint 得到的 Token 和自动加池用的 Token。
- Mint 发射可开启白名单阶段。创建者设置白名单额度并批量维护地址，额度用完后自动进入公开 Mint。
- 默认加池比例为 100%。用户 Mint 1 个 Token 时，另 1 个 Token 会配合本笔 BNB 自动加到 Pancake 池子里。
- Mint 支付的 BNB 不转给 dev 地址，不做传统募集款；BNB 会在 Mint 当笔进入流动池。
- LP 接收地址留空时默认为黑洞地址 `0x000000000000000000000000000000000000dEaD`。
- BSC 主网部署时默认使用 Pancake V2 Router；其他网络或特殊项目可配置 Router 后再开放 Mint。
- Mint 池售完，或到截止时间后，项目方填写 DEX 交易对地址并确认开盘。
- Mint 已开始后没有退款入口，因为 BNB 已经进入流动池；只有未发生任何 Mint 且到期的发射可以取消并取回剩余 Token。
- 买入税默认 `3%`，卖出税默认 `5%`。平台分成为已收交易税的 `20%`，不会额外增加用户看到的买卖税率。
- 灵气达到阈值后可触发进化，默认销毁进化池 `50%`，奖励池 `50%` 释放为持币分红；大户或普通持币者按链上持仓份额主动领取。
- 每次进化会开启一轮链上奖励：灵符奖励从幸运池发放，本命号码奖励从风险池发放。
- 项目方可配置 DEX 路由、交易对、回购接收地址、LP 接收地址，并开启自动回购和自动加池。
- 自动 DEX 处理达到阈值后会在卖出交易中尝试触发；如果 DEX 临时失败，不会卡死用户交易，税池余额保留后续再处理。
- 分红采用主动领取模式，用户通过前端或合约调用 `claimDividends()` 领取。
- 前端创建神兽时支持选择图片作为展示图，未选择图片也可以正常创建。

## 本地运行

```bash
npm install
npm run compile
npm test
npm run web
```

打开前端：

```text
http://127.0.0.1:5173/
```

## 本地链联调

按顺序打开多个终端运行：

```bash
npm run node
npm run deploy:local
npm run seed:local
npm run web
```

`deploy:local` 会部署 Token 部署器、Mint 金库部署器、发射台和税池，并写入 `web/config.js`。`seed:local` 会创建真实链上神兽项目，并生成联调用的交易税、灵气、销毁和分红数据。
