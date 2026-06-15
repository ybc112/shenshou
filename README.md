# 如意神兽发射台

如意神兽发射台是一套链上发射、交易税池、进化销毁和持币分红系统。项目支持两种创建方式：直接创建神兽 Token，或开启公开认购发射。

## 合约模块

- `RuyiBeastLaunchpad`：发射台入口，收取创建费，部署神兽 Token，登记项目，创建认购金库。
- `RuyiBeastToken`：神兽 ERC20，负责买卖税、灵气累计、进化、销毁、分红、平台税收和交易权限锁定。
- `RuyiBeastSaleVault`：公开认购金库，负责认购、募集资金、到期结算、取消发射和退款。
- `RuyiBeastVault`：税池金库，记录进化池、幸运池、风险池、奖励池、平台金库、销毁和分红储备。
- `RuyiBeastDeployers`：拆分部署器，降低发射台主合约体积，方便正式链部署。

## 主要机制

- 创建神兽时可选择不开启认购，Token 直接归创建者管理。
- 开启认购时，认购额度进入 `RuyiBeastSaleVault`，用户支付 ETH/BNB 认购，Token 直接发到用户钱包。
- 认购售完，或到截止时间后，项目方可填写 DEX 交易对地址并确认开盘。
- 开盘后合约会设置交易对、开启交易，并锁定关键交易参数，避免上线后随意改税、改限额、改分红排除名单。
- 如果认购超时且未售完，项目方可取消发射，用户退回认购 Token 后领取退款。
- 买入税默认 `3%`，卖出税默认 `5%`。平台税收为已收交易税的 `20%`，不会额外增加用户看到的买卖税率。
- 灵气达到阈值后可触发进化，默认销毁进化池 `50%`，奖励池 `50%` 释放为持币分红。
- 分红采用主动领取模式，用户通过前端或合约调用 `claimDividends()` 领取。
- 前端创建神兽时支持本地图片，浏览器会生成 `data:application/json;base64,...` 元数据 URI，不依赖 IPFS。

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

`deploy:local` 会部署 Token 部署器、认购金库部署器、发射台和税池，并写入 `web/config.js`。`seed:local` 会创建真实链上神兽项目，并模拟交易税、灵气、销毁和分红数据。
