const ethers = window.ethers;

const LAUNCHPAD_ABI = [
  "function owner() view returns (address)",
  "function vault() view returns (address)",
  "function creationFee() view returns (uint256)",
  "function projectCount() view returns (uint256)",
  "function projectSaleVault(uint256 projectId) view returns (address)",
  "function getProjects(uint256 offset,uint256 limit) view returns (tuple(uint256 id,address token,address creator,string beastName,string tokenName,string tokenSymbol,string metadataURI,uint256 initialSupply,uint256 auraThreshold,uint8 beastType,uint256 createdAt)[] projects)",
  "function getProject(uint256 projectId) view returns (tuple(uint256 id,address token,address creator,string beastName,string tokenName,string tokenSymbol,string metadataURI,uint256 initialSupply,uint256 auraThreshold,uint8 beastType,uint256 createdAt) project)",
  "function setEvolutionPayoutConfig(address token,uint16 burnBps,uint16 rewardDividendBps)",
  "function setRewardConfig(address token,uint16 talismanChanceBps,uint16 talismanPrizeBps,uint16 luckyPrizeBps,uint16 luckyModulo,uint256 minHoldAmount,bool enabled)",
  "function openRewardRound(address token) returns (uint256 round)",
  "function assignLuckyNumber(address token) returns (uint16 number)",
  "function claimTalismanReward(address token) returns (bool won,uint256 amount,uint16 roll)",
  "function claimLuckyNumberReward(address token,uint256 round) returns (uint256 amount)",
  "function setDexConfig(address token,address router,address pairedToken,address pair,address liquidityReceiver,address buybackRecipient,bool nativePair,bool burnBuyback,bool enabled)",
  "function setDexAutomationConfig(address token,uint16 autoBuybackBps,uint16 autoLiquidityBps,uint256 autoProcessThreshold,uint256 autoProcessLimit)",
  "function processAutoDex(address token) returns (uint256 processedAmount,uint256 buybackOut,uint256 liquidity)",
  "function createBeast((string beastName,string tokenName,string tokenSymbol,string metadataURI,uint256 initialSupply,uint256 auraThreshold,uint8 beastType,uint256 saleSupply,uint256 mintPrice,uint256 maxMintPerWallet,uint256 saleDeadline,address fundsReceiver) params) payable returns (address token)"
];

const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function stage() view returns (uint8)",
  "function aura() view returns (uint256)",
  "function auraThreshold() view returns (uint256)",
  "function tradingEnabled() view returns (bool)",
  "function totalFeeBps(bool sell) view returns (uint256)",
  "function PLATFORM_TAX_SHARE_BPS() view returns (uint16)",
  "function withdrawableDividendOf(address account) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function claimDividends() returns (uint256 amount)",
  "function setAutomatedMarketMakerPair(address pair,bool enabled)",
  "function enableTrading()",
  "function triggerEvolution()"
];

const VAULT_ABI = [
  "function poolBalances(address token) view returns (uint256 evolution,uint256 fortune,uint256 risk,uint256 reward,uint256 treasury,uint256 burned,uint256 dividendReserve,uint256 dividendsDistributed,uint256 dividendsPaid)",
  "function evolutionPayoutConfigs(address token) view returns (uint16 burnBps,uint16 rewardDividendBps)",
  "function rewardConfigs(address token) view returns (uint16 talismanChanceBps,uint16 talismanPrizeBps,uint16 luckyPrizeBps,uint16 luckyModulo,uint256 minHoldAmount,bool enabled)",
  "function dexConfigs(address token) view returns (address router,address pairedToken,address pair,address liquidityReceiver,address buybackRecipient,bool nativePair,bool burnBuyback,bool enabled,uint16 autoBuybackBps,uint16 autoLiquidityBps,uint256 autoProcessThreshold,uint256 autoProcessLimit)",
  "function talismanRound(address token) view returns (uint256)",
  "function luckyRound(address token) view returns (uint256)",
  "function hasLuckyNumber(address token,address account) view returns (bool)",
  "function luckyNumbers(address token,address account) view returns (uint16)"
];

const SALE_VAULT_ABI = [
  "function creator() view returns (address)",
  "function fundsReceiver() view returns (address)",
  "function saleSupply() view returns (uint256)",
  "function remainingSaleSupply() view returns (uint256)",
  "function mintPrice() view returns (uint256)",
  "function maxMintPerWallet() view returns (uint256)",
  "function saleDeadline() view returns (uint256)",
  "function nativeRaised() view returns (uint256)",
  "function finalized() view returns (bool)",
  "function cancelled() view returns (bool)",
  "function purchased(address account) view returns (uint256)",
  "function buy(uint256 tokenAmount) payable",
  "function finalize(address pair)",
  "function cancel()",
  "function claimRefund()",
  "function withdrawCancelledTokens(address to)"
];

const BEAST_RUNES = ["麟", "凰", "财", "狐", "龙", "虎", "玄", "兽"];
const BEAST_TYPE_NAMES = ["麒麟", "凤凰", "貔貅", "九尾狐", "青龙", "白虎", "玄龟", "自定义"];
const STAGE_NAMES = ["神兽蛋", "幼兽", "成长期", "觉醒", "神兽降临"];
const PAGE_NAMES = ["home", "beasts", "create", "rank", "reward", "platform", "data", "help"];
const ZERO = 0n;
const TOKEN_UNIT = 1_000_000_000_000_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const NATIVE_SYMBOL = "BNB";
const DEFAULT_PLATFORM_TAX_SHARE_BPS = 2000n;
const AVATAR_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/gif", "image/webp"];
const AVATAR_MAX_SOURCE_BYTES = 1024 * 1024;
const AVATAR_MAX_METADATA_BYTES = 220 * 1024;
const AVATAR_CANVAS_SIZE = 256;
const MAX_ONCHAIN_METADATA_BYTES = 260_000;
const MAX_METADATA_TEXT_LENGTH = 480;
const avatarByForm = new WeakMap();

const state = {
  account: "",
  launchpadAddress: "",
  provider: null,
  signer: null,
  launchpad: null,
  vault: null,
  vaultAddress: "",
  launchpadOwner: "",
  projects: [],
  selectedProjectId: null,
  stageFilter: "all",
  creationFee: ZERO,
  activePage: "home",
  platformTaxShareBps: DEFAULT_PLATFORM_TAX_SHARE_BPS
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function shortAddress(address) {
  if (!address || address === "--") return "--";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatToken(value, symbol = "") {
  if (value === null || value === undefined) return "--";
  const formatted = ethers.formatEther(value);
  const [whole, decimal = ""] = formatted.split(".");
  const trimmed = decimal.replace(/0+$/, "").slice(0, 4);
  const compact = trimmed ? `${whole}.${trimmed}` : whole;
  return symbol ? `${compact} ${symbol}` : compact;
}

function formatCount(value) {
  if (value === null || value === undefined || value === "--") return "--";
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function formatBps(value) {
  const bps = BigInt(value ?? 0);
  const whole = bps / 100n;
  const decimal = bps % 100n;
  return decimal === 0n ? `${whole}%` : `${whole}.${decimal.toString().padStart(2, "0").replace(/0+$/, "")}%`;
}

function formatBpsInput(value) {
  const bps = BigInt(value ?? 0);
  const whole = bps / 100n;
  const decimal = bps % 100n;
  return decimal === 0n ? whole.toString() : `${whole}.${decimal.toString().padStart(2, "0").replace(/0+$/, "")}`;
}

function parsePercentBps(value, label) {
  const raw = String(value || "").trim();
  const next = raw ? Number(raw) : 0;
  if (!Number.isFinite(next) || next < 0 || next > 100) {
    throw new Error(`${label}需要在 0 到 100 之间`);
  }
  return Math.round(next * 100);
}

function formatDateTime(timestamp) {
  const seconds = Number(timestamp || 0n);
  if (!seconds) return "无截止";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(seconds * 1000));
}

function parseTokenAmount(value) {
  const raw = String(value || "").trim();
  return raw ? ethers.parseEther(raw) : ZERO;
}

function normalizeAddressInput(value, fallback = ZERO_ADDRESS) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  if (!ethers.isAddress(raw)) {
    throw new Error("地址格式不正确");
  }
  return raw;
}

function parseDeadline(value) {
  const raw = String(value || "").trim();
  if (!raw) return ZERO;
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) {
    throw new Error("请选择有效的认购截止时间");
  }
  const seconds = BigInt(Math.floor(ms / 1000));
  if (seconds <= BigInt(Math.floor(Date.now() / 1000))) {
    throw new Error("认购截止时间必须晚于当前时间");
  }
  return seconds;
}

function saleStatusLabel(project) {
  const sale = project?.sale;
  if (!sale) return "未开启认购";
  if (sale.cancelled) return "已取消";
  if (sale.finalized || project.tradingEnabled) return "已开盘";
  if (sale.remainingSaleSupply === ZERO) return "可开盘";
  if (sale.saleDeadline > ZERO && BigInt(Math.floor(Date.now() / 1000)) > sale.saleDeadline) return "可开盘";
  return "认购中";
}

function saleDeadlineExpired(sale) {
  return Boolean(sale?.saleDeadline > ZERO && BigInt(Math.floor(Date.now() / 1000)) > sale.saleDeadline);
}

function setDisabled(selector, disabled) {
  $$(selector).forEach((el) => {
    el.disabled = disabled;
  });
}

function percentOf(value, threshold) {
  if (!threshold || threshold === ZERO) return 0;
  const pct = Number((value * 10_000n) / threshold) / 100;
  return Math.min(100, Math.max(0, pct));
}

function compareBigIntDesc(left, right) {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function sameAddress(left, right) {
  return String(left || "").toLowerCase() === String(right || "").toLowerCase();
}

function isLaunchpadOwner() {
  return Boolean(state.account && state.launchpadOwner && sameAddress(state.account, state.launchpadOwner));
}

function requireSelectedProject(message = "请先选择一只神兽。") {
  const project = selectedProject();
  if (!project) {
    showToast(message, "error");
    return null;
  }
  return project;
}

function requireOwnerWallet() {
  if (!isLaunchpadOwner()) {
    showToast("请连接发射台管理员钱包后再操作。", "error");
    return false;
  }
  return true;
}

function updateRewardActionState(project, rewardEnabled = false) {
  const canUseRewards = Boolean(state.account && project && rewardEnabled);
  setDisabled("[data-action='claim-dividends']", !(state.account && project));
  setDisabled("[data-action='claim-talisman']", !canUseRewards);
  setDisabled("[data-action='lucky-number-action']", !canUseRewards);
}

function updateSelectedActionState(project) {
  setDisabled("[data-action='copy-token']", !project);
  setDisabled("[data-action='trigger-evolution']", !(project && project.canEvolve));
}

function setText(selector, value) {
  $$(selector).forEach((el) => {
    el.textContent = value;
  });
}

function showToast(message, type = "info") {
  const toast = $(".toast");
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

function setLoading(isLoading, message = "读取链上数据中...") {
  document.body.classList.toggle("is-loading", isLoading);
  if (!isLoading) return;

  $$("[data-project-grid]").forEach((grid) => {
    grid.innerHTML = emptyMarkup("loader-circle", message, "正在读取项目、税池和分红数据。");
  });
  refreshIcons();
}

function emptyMarkup(icon, title, text) {
  return `
    <article class="empty-state">
      <i data-lucide="${icon}"></i>
      <strong>${title}</strong>
      <p>${text}</p>
    </article>
  `;
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }
}

function normalizeProject(project) {
  const metadataURI = project.metadataURI ?? project[6];
  const metadata = parseProjectMetadata(metadataURI);
  return {
    id: Number(project.id ?? project[0]),
    token: project.token ?? project[1],
    creator: project.creator ?? project[2],
    beastName: project.beastName ?? project[3],
    tokenName: project.tokenName ?? project[4],
    tokenSymbol: project.tokenSymbol ?? project[5],
    metadataURI,
    metadata,
    avatar: metadata.avatar || metadata.image || "",
    initialSupply: project.initialSupply ?? project[7],
    auraThreshold: project.auraThreshold ?? project[8],
    beastType: Number(project.beastType ?? project[9]),
    createdAt: Number(project.createdAt ?? project[10])
  };
}

function beastRune(project) {
  return BEAST_RUNES[Number(project?.beastType || 0)] || "兽";
}

function beastTone(project) {
  return `tone-${Number(project?.beastType || 0) % BEAST_RUNES.length}`;
}

function beastSigilMarkup(project, size = "") {
  const avatar = projectAvatar(project);
  if (avatar) {
    return `<span class="beast-sigil avatar ${size}" data-beast-type="${project.beastType}" aria-hidden="true"><img src="${escapeHtml(avatar)}" alt="" loading="lazy" /></span>`;
  }
  return `<span class="beast-sigil ${size} ${beastTone(project)}" data-beast-type="${project.beastType}" aria-hidden="true">${beastRune(project)}</span>`;
}

function beastArtMarkup(project) {
  const avatar = projectAvatar(project);
  if (avatar) {
    return `
      <div class="beast-art has-avatar">
        <img src="${escapeHtml(avatar)}" alt="" loading="lazy" />
      </div>
    `;
  }

  return `
    <div class="beast-art ${beastTone(project)}">
      <span>${beastRune(project)}</span>
    </div>
  `;
}

function projectAvatar(project) {
  return String(project?.avatar || project?.metadata?.avatar || project?.metadata?.image || "").trim();
}

function parseProjectMetadata(metadataURI) {
  const raw = String(metadataURI || "").trim();
  if (!raw) return {};

  try {
    if (raw.startsWith("data:")) {
      const base64 = raw.match(/^data:application\/json[^,]*;base64,(.*)$/i)?.[1];
      if (base64) {
        return JSON.parse(decodeURIComponent(escape(window.atob(base64))));
      }

      const encoded = raw.split(",").slice(1).join(",");
      return encoded ? JSON.parse(decodeURIComponent(encoded)) : {};
    }

    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function trimMetadataText(value, maxLength = MAX_METADATA_TEXT_LENGTH) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function readTextBytes(value) {
  return new Blob([String(value ?? "")]).size;
}

function getStoredLaunchpadAddress() {
  const fromStorage = localStorage.getItem("ruyi.launchpadAddress") || "";
  const fromCurrentStorage = localStorage.getItem("beast.launchpadAddress") || "";
  const fromConfig = window.RUYI_CONFIG?.launchpadAddress || "";
  return fromConfig || fromCurrentStorage || fromStorage;
}

async function makeProvider() {
  if (!ethers) {
    throw new Error("ethers 加载失败，请检查 web/vendor/ethers.umd.min.js");
  }

  if (window.RUYI_CONFIG?.rpcUrl) {
    return new ethers.JsonRpcProvider(window.RUYI_CONFIG.rpcUrl);
  }

  if (window.ethereum) {
    return new ethers.BrowserProvider(window.ethereum);
  }

  throw new Error("未检测到钱包或 RPC，请安装钱包插件，或在 config.js 配置 rpcUrl。");
}

async function connectContracts() {
  state.launchpadAddress = getStoredLaunchpadAddress().trim();
  const input = $("[data-address-form] input[name='launchpad']");
  if (input) input.value = state.launchpadAddress;

  if (!state.launchpadAddress || !ethers.isAddress(state.launchpadAddress)) {
    updateConnectionStatus("请填写有效的 Launchpad 合约地址。", false);
    clearChainData();
    return false;
  }

  state.provider = await makeProvider();
  state.launchpad = new ethers.Contract(state.launchpadAddress, LAUNCHPAD_ABI, state.provider);
  state.vaultAddress = await state.launchpad.vault();
  state.vault = new ethers.Contract(state.vaultAddress, VAULT_ABI, state.provider);
  state.creationFee = await state.launchpad.creationFee();
  state.launchpadOwner = await state.launchpad.owner().catch(() => ZERO_ADDRESS);

  const network = await state.provider.getNetwork();
  setText("[data-stat='networkName']", network.name === "unknown" ? `Chain ${network.chainId}` : network.name);
  setText("[data-creation-fee]", `${formatToken(state.creationFee)} ${NATIVE_SYMBOL}`);
  updateConnectionStatus(`已连接 Launchpad ${shortAddress(state.launchpadAddress)}，Vault ${shortAddress(state.vaultAddress)}。`, true);
  return true;
}

function updateConnectionStatus(message, ok) {
  const el = $("[data-connection-status]");
  const banner = $("[data-config-banner]");
  if (el) el.textContent = message;
  if (banner) banner.dataset.connected = ok ? "true" : "false";
}

function clearChainData() {
  state.projects = [];
  state.selectedProjectId = null;
  state.launchpadOwner = "";
  updateStats();
  renderAllViews();
  updateRewardActionState(null);
}

async function loadProjects() {
  if (!state.launchpad || !state.vault) return;

  setLoading(true);
  try {
    const count = Number(await state.launchpad.projectCount());
    const rawProjects = count > 0 ? await state.launchpad.getProjects(0, Math.min(count, 96)) : [];
    const normalized = rawProjects.map(normalizeProject);
    state.projects = await Promise.all(normalized.map(enrichProject));
    state.projects.sort((a, b) => b.progress - a.progress || b.id - a.id);

    if (state.projects[0]) {
      state.platformTaxShareBps = state.projects[0].platformTaxShareBps;
    }

    if (state.selectedProjectId === null && state.projects.length > 0) {
      state.selectedProjectId = state.projects[0].id;
    }

    updateStats();
    renderAllViews();
    await renderIdentity();
  } catch (error) {
    console.warn(error);
    showToast(`读取失败：${shortError(error)}`, "error");
    updateConnectionStatus(`读取失败：${shortError(error)}`, false);
  } finally {
    setLoading(false);
  }
}

async function enrichProject(project) {
  const token = new ethers.Contract(project.token, TOKEN_ABI, state.provider);
  const [
    stage,
    aura,
    threshold,
    totalSupply,
    symbol,
    tradingEnabled,
    pools,
    buyTaxBps,
    sellTaxBps,
    platformTaxShareBps,
    evolutionConfig,
    rewardConfig,
    dexConfig,
    saleVault
  ] = await Promise.all([
    token.stage().catch(() => 0n),
    token.aura().catch(() => ZERO),
    token.auraThreshold().catch(() => project.auraThreshold || ZERO),
    token.totalSupply().catch(() => project.initialSupply || ZERO),
    token.symbol().catch(() => project.tokenSymbol),
    token.tradingEnabled().catch(() => false),
    state.vault.poolBalances(project.token).catch(() => null),
    token.totalFeeBps(false).catch(() => 300n),
    token.totalFeeBps(true).catch(() => 500n),
    token.PLATFORM_TAX_SHARE_BPS().catch(() => DEFAULT_PLATFORM_TAX_SHARE_BPS),
    state.vault.evolutionPayoutConfigs(project.token).catch(() => null),
    state.vault.rewardConfigs(project.token).catch(() => null),
    state.vault.dexConfigs(project.token).catch(() => null),
    state.launchpad.projectSaleVault(project.id).catch(() => ZERO_ADDRESS)
  ]);

  const stageNumber = Number(stage);
  const auraValue = BigInt(aura);
  const thresholdValue = BigInt(threshold);
  const progress = percentOf(auraValue, thresholdValue);
  const sale = await fetchSaleInfo(saleVault);

  return {
    ...project,
    stage: stageNumber,
    aura: auraValue,
    auraThreshold: thresholdValue,
    totalSupply: BigInt(totalSupply),
    symbol,
    tradingEnabled,
    pools,
    buyTaxBps: BigInt(buyTaxBps),
    sellTaxBps: BigInt(sellTaxBps),
    platformTaxShareBps: BigInt(platformTaxShareBps),
    evolutionConfig: normalizeEvolutionConfig(evolutionConfig),
    rewardConfig: normalizeRewardConfig(rewardConfig),
    dexConfig: normalizeDexConfig(dexConfig),
    saleVault,
    sale,
    progress,
    canEvolve: progress >= 100 && stageNumber < 4
  };
}

async function fetchSaleInfo(saleVault) {
  if (!saleVault || saleVault === ZERO_ADDRESS) return null;

  const sale = new ethers.Contract(saleVault, SALE_VAULT_ABI, state.provider);
  const [
    creator,
    fundsReceiver,
    saleSupply,
    remainingSaleSupply,
    mintPrice,
    maxMintPerWallet,
    saleDeadline,
    nativeRaised,
    finalized,
    cancelled
  ] = await Promise.all([
    sale.creator().catch(() => ZERO_ADDRESS),
    sale.fundsReceiver().catch(() => ZERO_ADDRESS),
    sale.saleSupply().catch(() => ZERO),
    sale.remainingSaleSupply().catch(() => ZERO),
    sale.mintPrice().catch(() => ZERO),
    sale.maxMintPerWallet().catch(() => ZERO),
    sale.saleDeadline().catch(() => ZERO),
    sale.nativeRaised().catch(() => ZERO),
    sale.finalized().catch(() => false),
    sale.cancelled().catch(() => false)
  ]);

  return {
    creator,
    fundsReceiver,
    saleSupply: BigInt(saleSupply),
    remainingSaleSupply: BigInt(remainingSaleSupply),
    mintPrice: BigInt(mintPrice),
    maxMintPerWallet: BigInt(maxMintPerWallet),
    saleDeadline: BigInt(saleDeadline),
    nativeRaised: BigInt(nativeRaised),
    finalized,
    cancelled
  };
}

function updateStats() {
  const projectCount = state.projects.length;
  const evolvedCount = state.projects.filter((project) => project.stage > 0).length;
  const readyCount = state.projects.filter((project) => project.canEvolve).length;
  const byStage = [0, 1, 2].map((stage) => state.projects.filter((project) => project.stage === stage).length);
  const totalBurned = sumPools("burned");
  const dividendReserve = sumPools("dividendReserve");
  const dividendsDistributed = sumPools("dividendsDistributed");
  const platformTaxShare = formatBps(state.platformTaxShareBps);

  setText("[data-stat='projectCount']", formatCount(projectCount));
  setText("[data-stat='projectCountHero']", formatCount(projectCount));
  setText("[data-stat='evolvedCount']", formatCount(evolvedCount));
  setText("[data-stat='evolvedCountHero']", formatCount(evolvedCount));
  setText("[data-stat='totalBurned']", formatToken(totalBurned));
  setText("[data-stat='totalBurnedHero']", formatToken(totalBurned));
  setText("[data-stat='dividendReserve']", formatToken(dividendReserve));
  setText("[data-stat='dividendsDistributed']", formatToken(dividendsDistributed));
  setText("[data-stat='platformTaxShare']", platformTaxShare);
  setText("[data-tax-platform]", platformTaxShare);

  setText("[data-stage-count='all']", formatCount(projectCount));
  setText("[data-stage-count='0']", formatCount(byStage[0]));
  setText("[data-stage-count='1']", formatCount(byStage[1]));
  setText("[data-stage-count='2']", formatCount(byStage[2]));
  setText("[data-stage-count='ready']", formatCount(readyCount));
}

function sumPools(key) {
  return state.projects.reduce((sum, project) => {
    const pools = normalizePools(project.pools);
    return sum + (pools[key] || ZERO);
  }, ZERO);
}

function normalizePools(pools) {
  if (!pools) {
    return {
      evolution: ZERO,
      fortune: ZERO,
      risk: ZERO,
      reward: ZERO,
      treasury: ZERO,
      burned: ZERO,
      dividendReserve: ZERO,
      dividendsDistributed: ZERO,
      dividendsPaid: ZERO
    };
  }

  return {
    evolution: BigInt(pools.evolution ?? pools[0]),
    fortune: BigInt(pools.fortune ?? pools[1]),
    risk: BigInt(pools.risk ?? pools[2]),
    reward: BigInt(pools.reward ?? pools[3]),
    treasury: BigInt(pools.treasury ?? pools[4]),
    burned: BigInt(pools.burned ?? pools[5]),
    dividendReserve: BigInt(pools.dividendReserve ?? pools[6]),
    dividendsDistributed: BigInt(pools.dividendsDistributed ?? pools[7]),
    dividendsPaid: BigInt(pools.dividendsPaid ?? pools[8])
  };
}

function normalizeRewardConfig(config) {
  if (!config) {
    return {
      talismanChanceBps: 0n,
      talismanPrizeBps: 0n,
      luckyPrizeBps: 0n,
      luckyModulo: 0n,
      minHoldAmount: ZERO,
      enabled: false
    };
  }

  return {
    talismanChanceBps: BigInt(config.talismanChanceBps ?? config[0]),
    talismanPrizeBps: BigInt(config.talismanPrizeBps ?? config[1]),
    luckyPrizeBps: BigInt(config.luckyPrizeBps ?? config[2]),
    luckyModulo: BigInt(config.luckyModulo ?? config[3]),
    minHoldAmount: BigInt(config.minHoldAmount ?? config[4]),
    enabled: Boolean(config.enabled ?? config[5])
  };
}

function normalizeEvolutionConfig(config) {
  if (!config) {
    return {
      burnBps: 5000n,
      rewardDividendBps: 5000n
    };
  }

  return {
    burnBps: BigInt(config.burnBps ?? config[0]),
    rewardDividendBps: BigInt(config.rewardDividendBps ?? config[1])
  };
}

function normalizeDexConfig(config) {
  if (!config) {
    return {
      router: ZERO_ADDRESS,
      pairedToken: ZERO_ADDRESS,
      pair: ZERO_ADDRESS,
      liquidityReceiver: ZERO_ADDRESS,
      buybackRecipient: ZERO_ADDRESS,
      nativePair: true,
      burnBuyback: true,
      enabled: false,
      autoBuybackBps: 0n,
      autoLiquidityBps: 0n,
      autoProcessThreshold: ZERO,
      autoProcessLimit: ZERO
    };
  }

  return {
    router: config.router ?? config[0],
    pairedToken: config.pairedToken ?? config[1],
    pair: config.pair ?? config[2],
    liquidityReceiver: config.liquidityReceiver ?? config[3],
    buybackRecipient: config.buybackRecipient ?? config[4],
    nativePair: Boolean(config.nativePair ?? config[5]),
    burnBuyback: Boolean(config.burnBuyback ?? config[6]),
    enabled: Boolean(config.enabled ?? config[7]),
    autoBuybackBps: BigInt(config.autoBuybackBps ?? config[8]),
    autoLiquidityBps: BigInt(config.autoLiquidityBps ?? config[9]),
    autoProcessThreshold: BigInt(config.autoProcessThreshold ?? config[10]),
    autoProcessLimit: BigInt(config.autoProcessLimit ?? config[11])
  };
}

function filteredProjects() {
  if (state.stageFilter === "all") return state.projects;
  if (state.stageFilter === "ready") return state.projects.filter((project) => project.canEvolve);
  return state.projects.filter((project) => String(project.stage) === state.stageFilter);
}

function renderProjects() {
  const grids = $$("[data-project-grid]");
  if (grids.length === 0) return;

  const projects = filteredProjects();
  if (!state.launchpadAddress || !ethers.isAddress(state.launchpadAddress)) {
    grids.forEach((grid) => {
      grid.innerHTML = emptyMarkup("plug-zap", "等待合约地址", "填写并保存 Launchpad 地址后，神兽大厅会展示真实链上项目。");
    });
    refreshIcons();
    return;
  }

  if (projects.length === 0) {
    grids.forEach((grid) => {
      grid.innerHTML = emptyMarkup("egg", "暂无链上神兽", "可以使用创建表单上链创建第一只神兽。");
    });
    refreshIcons();
    return;
  }

  grids.forEach((grid) => {
    const pageProjects = grid.dataset.projectGrid === "hall" ? projectSearchAndSort(projects) : projects.slice(0, 4);
    if (pageProjects.length === 0) {
      grid.innerHTML = emptyMarkup("search", "没有匹配的神兽", "换个关键词或切换筛选条件后再查看。");
      return;
    }
    grid.innerHTML = pageProjects.map(projectCardMarkup).join("");
  });
  refreshIcons();
}

function projectSearchAndSort(projects) {
  const keyword = ($("[data-project-search]")?.value || "").trim().toLowerCase();
  const sort = $("[data-project-sort]")?.value || "progress";

  const searched = !keyword
    ? [...projects]
    : projects.filter((project) => {
        return [project.beastName, project.tokenName, project.symbol, project.token, project.creator]
          .some((value) => String(value || "").toLowerCase().includes(keyword));
      });

  return searched.sort((a, b) => {
    const poolsA = normalizePools(a.pools);
    const poolsB = normalizePools(b.pools);
    if (sort === "burned") return compareBigIntDesc(poolsA.burned, poolsB.burned);
    if (sort === "reward") return compareBigIntDesc(poolsA.reward + poolsA.dividendReserve, poolsB.reward + poolsB.dividendReserve);
    if (sort === "created") return b.createdAt - a.createdAt;
    return b.progress - a.progress || b.id - a.id;
  });
}

function projectCardMarkup(project, index) {
  const rank = index + 1;
  const pools = normalizePools(project.pools);
  const stageClass = project.canEvolve ? "warning" : "";
  const rankClass = rank === 2 ? "silver" : rank === 3 ? "bronze" : rank > 3 ? "dark" : "";
  const selectedClass = project.id === state.selectedProjectId ? "selected" : "";
  const saleLabel = saleStatusLabel(project);

  return `
    <article class="beast-card ${selectedClass}">
      <div class="rank-badge ${rankClass}">${rank}</div>
      <span class="stage-badge ${stageClass}">${project.canEvolve ? "可进化" : STAGE_NAMES[project.stage] || "未知"}</span>
      ${beastArtMarkup(project)}
      <div class="beast-body">
        <div class="beast-heading">
          <h3>${escapeHtml(project.beastName || project.tokenName)}</h3>
          <span>${escapeHtml(project.symbol || project.tokenSymbol)}</span>
        </div>
        <div class="progress-line">
          <label>灵气值 <strong>${project.progress.toFixed(0)}%</strong></label>
          <div><span style="width: ${project.progress}%"></span></div>
        </div>
        <dl class="beast-meta">
          <div><dt>奖励池</dt><dd>${formatToken(pools.reward + pools.dividendReserve, project.symbol)}</dd></div>
          <div><dt>平台金库</dt><dd>${formatToken(pools.treasury, project.symbol)}</dd></div>
          <div><dt>买入税</dt><dd>${formatBps(project.buyTaxBps)}</dd></div>
          <div><dt>卖出税</dt><dd>${formatBps(project.sellTaxBps)}</dd></div>
          <div><dt>发射状态</dt><dd>${saleLabel}</dd></div>
        </dl>
        <button class="gold-button full" type="button" data-enter-project="${project.id}">进入兽巢</button>
      </div>
    </article>
  `;
}

function selectedProject() {
  return state.projects.find((project) => project.id === state.selectedProjectId) || null;
}

function renderSelectedProject(project) {
  if (!project) {
    setText("[data-selected-name]", "请选择一只神兽");
    setText("[data-selected-token]", "Token: --");
    setText("[data-selected-stage]", "--");
    setText("[data-selected-progress]", "--");
    setText("[data-selected-reward]", "--");
    setText("[data-selected-burned]", "--");
    setText("[data-selected-treasury]", "--");
    setText("[data-selected-aura-label]", "--");
    setText("[data-tax-buy]", "--");
    setText("[data-tax-sell]", "--");
    renderSalePanel(null);
    renderAdminTools(null);
    updateSelectedActionState(null);
    $$("[data-selected-aura-bar]").forEach((bar) => {
      bar.style.width = "0%";
    });
    return;
  }

  const pools = normalizePools(project.pools);
  state.platformTaxShareBps = project.platformTaxShareBps;
  setText("[data-selected-name]", `${project.beastName} (${project.symbol})`);
  setText("[data-selected-token]", `Token: ${shortAddress(project.token)}`);
  setText("[data-selected-stage]", STAGE_NAMES[project.stage] || "未知");
  setText("[data-selected-progress]", `${project.progress.toFixed(2)}%`);
  setText("[data-selected-reward]", formatToken(pools.reward + pools.dividendReserve, project.symbol));
  setText("[data-selected-burned]", formatToken(pools.burned, project.symbol));
  setText("[data-selected-treasury]", formatToken(pools.treasury, project.symbol));
  setText("[data-selected-aura-label]", `${formatToken(project.aura, project.symbol)} / ${formatToken(project.auraThreshold, project.symbol)}`);
  setText("[data-tax-buy]", formatBps(project.buyTaxBps));
  setText("[data-tax-sell]", formatBps(project.sellTaxBps));
  setText("[data-tax-platform]", formatBps(project.platformTaxShareBps));
  setText("[data-stat='platformTaxShare']", formatBps(project.platformTaxShareBps));
  renderSalePanel(project);
  renderAdminTools(project);
  updateSelectedActionState(project);
  $$("[data-selected-aura-bar]").forEach((bar) => {
    bar.style.width = `${project.progress}%`;
  });
}

function renderSalePanel(project) {
  const sale = project?.sale || null;
  const status = saleStatusLabel(project);
  const hasSale = Boolean(sale);
  const canBuy = hasSale && status === "认购中";
  const canRefund = hasSale && sale.cancelled;
  const canFinalize = hasSale && status === "可开盘";
  const canCancel = hasSale && saleDeadlineExpired(sale) && sale.remainingSaleSupply > ZERO;
  const canWithdraw = hasSale && sale.cancelled && sale.nativeRaised === ZERO;
  const isSaleCreator = hasSale && state.account && sameAddress(state.account, sale.creator);
  const isProjectCreator = Boolean(project && state.account && sameAddress(state.account, project.creator));
  const canDirectOpen = Boolean(project && !hasSale && !project.tradingEnabled && isProjectCreator);
  const canOpenTrading = (canFinalize && isSaleCreator) || canDirectOpen;
  const saleHint = salePanelHint({ project, hasSale, status, canBuy, canFinalize, canDirectOpen, isSaleCreator, isProjectCreator });

  $$("[data-sale-panel]").forEach((panel) => {
    panel.dataset.saleState = hasSale ? status : "未开启认购";
  });

  setText("[data-sale-status]", status);
  setText("[data-sale-vault]", hasSale ? shortAddress(project.saleVault) : "--");
  setText("[data-sale-price]", hasSale ? `${formatToken(sale.mintPrice)} ${NATIVE_SYMBOL} / 枚` : "--");
  setText("[data-sale-sold]", hasSale ? `${formatToken(sale.saleSupply - sale.remainingSaleSupply, project.symbol)} / ${formatToken(sale.saleSupply, project.symbol)}` : "--");
  setText("[data-sale-remaining]", hasSale ? `${formatToken(sale.remainingSaleSupply, project.symbol)} / ${formatToken(sale.saleSupply, project.symbol)}` : "--");
  setText("[data-sale-limit]", hasSale && sale.maxMintPerWallet > ZERO ? formatToken(sale.maxMintPerWallet, project.symbol) : hasSale ? "不限" : "--");
  setText("[data-sale-deadline]", hasSale ? formatDateTime(sale.saleDeadline) : "--");
  setText("[data-sale-raised]", hasSale ? `${formatToken(sale.nativeRaised)} ${NATIVE_SYMBOL}` : "--");
  setText("[data-sale-receiver]", hasSale ? shortAddress(sale.fundsReceiver) : "--");

  $$("[data-sale-buy-form]").forEach((form) => {
    form.dataset.enabled = canBuy ? "true" : "false";
    const input = form.querySelector("input");
    const button = form.querySelector("button");
    if (input) {
      input.disabled = !canBuy;
      input.placeholder = canBuy ? "输入认购数量" : hasSale ? "当前状态不能认购" : "未开启认购，不能认购";
    }
    if (button) button.disabled = !canBuy;
  });

  $$("[data-sale-owner-form]").forEach((form) => {
    form.dataset.enabled = canOpenTrading ? "true" : "false";
    const input = form.querySelector("input");
    const button = form.querySelector("button");
    const buttonLabel = button?.querySelector("span");
    if (input) input.disabled = !canOpenTrading;
    if (button) button.disabled = !canOpenTrading;
    if (buttonLabel) buttonLabel.textContent = project?.tradingEnabled ? "已开盘" : "确认开盘";
  });

  setText("[data-sale-hint]", saleHint);
  setDisabled("[data-action='claim-refund']", !canRefund);
  setDisabled("[data-action='cancel-sale']", !(canCancel && isSaleCreator));
  setDisabled("[data-action='withdraw-cancelled-tokens']", !(canWithdraw && isSaleCreator));
}

function salePanelHint({ project, hasSale, status, canBuy, canFinalize, canDirectOpen, isSaleCreator, isProjectCreator }) {
  if (!project) return "请选择一个神兽后查看认购和开盘状态。";
  if (project.tradingEnabled) return "该神兽已开盘，交易权限已经开启。";
  if (!hasSale) {
    if (canDirectOpen) return "该神兽未开启认购，创建者可直接填写 Pancake 交易对地址并确认开盘。";
    return isProjectCreator ? "请连接创建者钱包后填写交易对地址开盘。" : "该神兽未开启认购，只有创建者钱包可以填写交易对地址开盘。";
  }
  if (canBuy) return "当前可认购，输入数量后确认钱包支付 BNB。";
  if (canFinalize && isSaleCreator) return "认购已结束，创建者可填写交易对地址并确认开盘。";
  if (status === "可开盘") return "认购已结束，等待项目创建者填写交易对地址开盘。";
  if (status === "已取消") return "该认购已取消，参与钱包可按规则申请退款。";
  return "当前状态暂不能操作，请等待认购结束或刷新链上数据。";
}

function renderAdminTools(project) {
  $$("[data-admin-tools]").forEach((container) => {
    if (!project) {
      container.innerHTML = "";
      return;
    }

    const evolution = project.evolutionConfig || normalizeEvolutionConfig(null);
    const reward = project.rewardConfig || normalizeRewardConfig(null);
    const dex = project.dexConfig || normalizeDexConfig(null);
    const ownerReady = isLaunchpadOwner();
    const disabled = ownerReady ? "" : "disabled";
    const ownerBadge = ownerReady ? "管理员已连接" : "仅管理员";
    const dexStatus = dex.enabled ? "已启用" : "未启用";

    container.innerHTML = `
      <section class="admin-panel">
        <div class="admin-head">
          <div>
            <span>进化机制</span>
            <strong>${ownerBadge}</strong>
          </div>
          <small>灵气值达到进化阈值后，触发进化会按这里的比例销毁进化池，并释放奖励池给持币分红。</small>
        </div>
        <form class="admin-form" data-evolution-config-form>
          <label><span>进化池销毁 %</span><input name="burnBps" type="number" min="0" max="100" step="0.01" value="${formatBpsInput(evolution.burnBps)}" ${disabled} /></label>
          <label><span>奖励池分红释放 %</span><input name="rewardDividendBps" type="number" min="0" max="100" step="0.01" value="${formatBpsInput(evolution.rewardDividendBps)}" ${disabled} /></label>
          <button class="outline-button" type="submit" ${disabled}><i data-lucide="flame"></i><span>保存进化机制</span></button>
        </form>
      </section>
      <section class="admin-panel">
        <div class="admin-head">
          <div>
            <span>奖励设置</span>
            <strong>${ownerBadge}</strong>
          </div>
          <small>灵符奖励来自幸运池，本命号码奖励来自风险池。</small>
        </div>
        <form class="admin-form" data-reward-config-form>
          <label><span>灵符中奖率 %</span><input name="talismanChance" type="number" min="0" max="100" step="0.01" value="${formatBpsInput(reward.talismanChanceBps)}" ${disabled} /></label>
          <label><span>灵符单次奖励 %</span><input name="talismanPrize" type="number" min="0" max="100" step="0.01" value="${formatBpsInput(reward.talismanPrizeBps)}" ${disabled} /></label>
          <label><span>号码单次奖励 %</span><input name="luckyPrize" type="number" min="0" max="100" step="0.01" value="${formatBpsInput(reward.luckyPrizeBps)}" ${disabled} /></label>
          <label><span>号码范围</span><input name="luckyModulo" type="number" min="1" step="1" value="${reward.luckyModulo || 10000n}" ${disabled} /></label>
          <label><span>最低持仓</span><input name="minHoldAmount" type="number" min="0" step="1" value="${ethers.formatEther(reward.minHoldAmount)}" ${disabled} /></label>
          <label class="check-field"><input name="enabled" type="checkbox" ${reward.enabled ? "checked" : ""} ${disabled} /><span>开启奖励</span></label>
          <button class="outline-button" type="submit" ${disabled}><i data-lucide="settings-2"></i><span>保存奖励设置</span></button>
          <button class="gold-button" type="button" data-action="open-reward-round" ${disabled}><i data-lucide="party-popper"></i><span>手动开奖</span></button>
        </form>
      </section>
      <section class="admin-panel">
        <div class="admin-head">
          <div>
            <span>DEX 自动机制</span>
            <strong>${dexStatus}</strong>
          </div>
          <small>配置后，卖出交易会按阈值尝试自动回购和自动加池。</small>
        </div>
        <div class="dex-summary">
          <div><span>路由</span><strong>${shortAddress(dex.router)}</strong></div>
          <div><span>交易对</span><strong>${shortAddress(dex.pair)}</strong></div>
          <div><span>自动回购</span><strong>${formatBps(dex.autoBuybackBps)}</strong></div>
          <div><span>自动加池</span><strong>${formatBps(dex.autoLiquidityBps)}</strong></div>
        </div>
        <form class="admin-form dex-form" data-dex-config-form>
          <label><span>Router 地址</span><input name="router" type="text" value="${addressInputValue(dex.router)}" placeholder="DEX Router" ${disabled} /></label>
          <label><span>交易对地址</span><input name="pair" type="text" value="${addressInputValue(dex.pair)}" placeholder="Pair 地址" ${disabled} /></label>
          <label><span>配对 Token</span><input name="pairedToken" type="text" value="${addressInputValue(dex.pairedToken)}" placeholder="原生币交易对可留空" ${disabled} /></label>
          <label><span>LP 接收地址</span><input name="liquidityReceiver" type="text" value="${addressInputValue(dex.liquidityReceiver)}" placeholder="LP 接收钱包" ${disabled} /></label>
          <label><span>回购接收地址</span><input name="buybackRecipient" type="text" value="${addressInputValue(dex.buybackRecipient)}" placeholder="销毁回购可留空" ${disabled} /></label>
          <label class="check-field"><input name="nativePair" type="checkbox" ${dex.nativePair ? "checked" : ""} ${disabled} /><span>原生币交易对</span></label>
          <label class="check-field"><input name="burnBuyback" type="checkbox" ${dex.burnBuyback ? "checked" : ""} ${disabled} /><span>回购后销毁</span></label>
          <label class="check-field"><input name="enabled" type="checkbox" ${dex.enabled ? "checked" : ""} ${disabled} /><span>启用 DEX</span></label>
          <button class="outline-button" type="submit" ${disabled}><i data-lucide="save"></i><span>保存 DEX 配置</span></button>
        </form>
        <form class="admin-form" data-dex-auto-form>
          <label><span>自动回购 %</span><input name="autoBuyback" type="number" min="0" max="100" step="0.01" value="${formatBpsInput(dex.autoBuybackBps)}" ${disabled} /></label>
          <label><span>自动加池 %</span><input name="autoLiquidity" type="number" min="0" max="100" step="0.01" value="${formatBpsInput(dex.autoLiquidityBps)}" ${disabled} /></label>
          <label><span>触发阈值</span><input name="autoThreshold" type="number" min="0" step="1" value="${ethers.formatEther(dex.autoProcessThreshold)}" ${disabled} /></label>
          <label><span>单次上限</span><input name="autoLimit" type="number" min="0" step="1" value="${ethers.formatEther(dex.autoProcessLimit)}" ${disabled} /></label>
          <button class="outline-button" type="submit" ${disabled}><i data-lucide="sliders-horizontal"></i><span>保存自动参数</span></button>
          <button class="gold-button" type="button" data-action="process-auto-dex" ${disabled}><i data-lucide="refresh-cw"></i><span>立即处理税池</span></button>
        </form>
      </section>
    `;
  });

  refreshIcons();
}

function addressInputValue(address) {
  return address && !sameAddress(address, ZERO_ADDRESS) ? escapeHtml(address) : "";
}

function renderNextProject() {
  const next = [...state.projects]
    .filter((project) => project.stage < 4)
    .sort((a, b) => b.progress - a.progress)[0];

  if (!next) {
    const sigil = $("[data-next-sigil]");
    if (sigil) {
      sigil.textContent = "兽";
      sigil.dataset.beastType = "0";
      sigil.className = "beast-sigil mini tone-0";
    }
    setText("[data-next-name]", "暂无神兽");
    setText("[data-next-symbol]", "--");
    setText("[data-next-progress]", "--");
    setText("[data-next-desc]", "创建或读取项目后自动更新。");
    const bar = $("[data-next-bar]");
    if (bar) bar.style.width = "0%";
    return;
  }

  const sigil = $("[data-next-sigil]");
  if (sigil) {
    const avatar = projectAvatar(next);
    sigil.innerHTML = avatar ? `<img src="${escapeHtml(avatar)}" alt="" loading="lazy" />` : beastRune(next);
    sigil.dataset.beastType = String(next.beastType);
    sigil.className = avatar ? "beast-sigil mini avatar" : `beast-sigil mini ${beastTone(next)}`;
  }
  setText("[data-next-name]", next.beastName);
  setText("[data-next-symbol]", next.symbol);
  setText("[data-next-progress]", `${next.progress.toFixed(0)}%`);
  setText("[data-next-desc]", next.canEvolve ? "灵气已满，可触发进化。" : `距离进化还差 ${(100 - next.progress).toFixed(0)}%。`);
  const bar = $("[data-next-bar]");
  if (bar) bar.style.width = `${next.progress}%`;
}

function renderAllViews() {
  renderProjects();
  renderSelectedProject(selectedProject());
  renderNextProject();
  renderRankTable();
  renderDataCenter();
  renderRewardProjects();
}

function renderRankTable() {
  const tbody = $("[data-rank-table]");
  if (!tbody) return;

  if (state.projects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7">暂无链上神兽数据</td></tr>`;
    return;
  }

  tbody.innerHTML = [...state.projects]
    .sort((a, b) => b.progress - a.progress || b.stage - a.stage)
    .map((project, index) => {
      const pools = normalizePools(project.pools);
      return `
        <tr>
          <td><strong class="table-rank">${index + 1}</strong></td>
          <td>
            <div class="table-beast">
              ${beastSigilMarkup(project, "table")}
              <span>${escapeHtml(project.beastName)}<small>${escapeHtml(project.symbol)}</small></span>
            </div>
          </td>
          <td>${STAGE_NAMES[project.stage] || "未知"}</td>
          <td>${project.progress.toFixed(2)}%</td>
          <td>${formatToken(pools.reward + pools.dividendReserve, project.symbol)}</td>
          <td>${formatToken(pools.treasury, project.symbol)}</td>
          <td><button class="outline-button table-action" type="button" data-enter-project="${project.id}">查看</button></td>
        </tr>
      `;
    })
    .join("");
}

function renderDataCenter() {
  setText("[data-contract-launchpad]", `Launchpad: ${shortAddress(state.launchpadAddress)}`);
  const tbody = $("[data-pool-table]");
  if (!tbody) return;

  if (state.projects.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13">暂无税池数据</td></tr>`;
    return;
  }

  tbody.innerHTML = state.projects.map((project) => {
    const pools = normalizePools(project.pools);
    const dex = project.dexConfig || normalizeDexConfig(null);
    return `
      <tr>
        <td>${escapeHtml(project.beastName)} <small>${escapeHtml(project.symbol)}</small></td>
        <td>${formatBps(project.buyTaxBps)}</td>
        <td>${formatBps(project.sellTaxBps)}</td>
        <td>${formatToken(pools.evolution, project.symbol)}</td>
        <td>${formatToken(pools.fortune, project.symbol)}</td>
        <td>${formatToken(pools.risk, project.symbol)}</td>
        <td>${formatToken(pools.reward, project.symbol)}</td>
        <td>${formatToken(pools.treasury, project.symbol)}</td>
        <td>${dex.enabled ? "已启用" : "未启用"} <small>${shortAddress(dex.router)}</small></td>
        <td>${formatBps(dex.autoBuybackBps)} / ${formatBps(dex.autoLiquidityBps)} <small>回购 / 加池</small></td>
        <td>${saleStatusLabel(project)}</td>
        <td>${formatToken(pools.burned, project.symbol)}</td>
        <td>${formatToken(pools.dividendReserve, project.symbol)}</td>
      </tr>
    `;
  }).join("");
}

function renderRewardProjects() {
  const container = $("[data-reward-projects]");
  if (!container) return;

  if (state.projects.length === 0) {
    container.innerHTML = emptyMarkup("gift", "暂无奖励数据", "读取神兽项目后，可在这里选择兽巢查看可领取分红。");
    refreshIcons();
    return;
  }

  container.innerHTML = state.projects.map((project) => {
    const pools = normalizePools(project.pools);
    const active = project.id === state.selectedProjectId ? "active" : "";
    return `
      <button class="mini-card ${active}" type="button" data-enter-project="${project.id}">
        ${beastSigilMarkup(project, "mini")}
        <span>${escapeHtml(project.beastName)}<small>${formatToken(pools.dividendReserve, project.symbol)} 可分红储备</small></span>
      </button>
    `;
  }).join("");
  refreshIcons();
}

async function renderIdentity() {
  if (!state.account) {
    setText("[data-holder-title]", "未连接钱包");
    setText("[data-holder-balance]", "持仓：--");
    setText("[data-ticket-count]", "连接后查看");
    setText("[data-lucky-number]", "连接后查看");
    setText("[data-withdrawable-dividend]", "--");
    setText("[data-talisman-status]", "连接后查看");
    setText("[data-lucky-status]", "连接后查看");
    updateRewardActionState(null);
    return;
  }

  const project = selectedProject();
  if (!project) {
    setText("[data-holder-title]", "已连接钱包");
    setText("[data-holder-balance]", `钱包：${shortAddress(state.account)}`);
    setText("[data-ticket-count]", "选择兽巢查看");
    setText("[data-lucky-number]", "选择兽巢查看");
    setText("[data-withdrawable-dividend]", "--");
    setText("[data-talisman-status]", "选择兽巢查看");
    setText("[data-lucky-status]", "选择兽巢查看");
    updateRewardActionState(null);
    return;
  }

  const token = new ethers.Contract(project.token, TOKEN_ABI, state.provider);
  const [balance, withdrawable, talismanRound, hasLuckyNumber] = await Promise.all([
    token.balanceOf(state.account).catch(() => ZERO),
    token.withdrawableDividendOf(state.account).catch(() => ZERO),
    state.vault.talismanRound(project.token).catch(() => ZERO),
    state.vault.hasLuckyNumber(project.token, state.account).catch(() => false)
  ]);
  const luckyNumber = hasLuckyNumber
    ? await state.vault.luckyNumbers(project.token, state.account).catch(() => null)
    : null;

  const formalThreshold = ethers.parseEther("1000000");
  const rewardEnabled = Boolean(project.rewardConfig?.enabled);
  const talismanStatus = rewardEnabled
    ? talismanRound > ZERO ? `第 ${talismanRound.toString()} 轮` : "等待首轮"
    : "等待项目方设置";
  const luckyStatus = rewardEnabled
    ? hasLuckyNumber ? `已绑定 #${String(luckyNumber).padStart(4, "0")}` : balance > ZERO ? "可绑定" : "持有后可绑定"
    : "等待项目方设置";

  setText("[data-holder-title]", balance >= formalThreshold ? "正式兽主" : balance > ZERO ? "普通兽主" : "观察者");
  setText("[data-holder-balance]", `持仓：${formatToken(balance, project.symbol)}`);
  setText("[data-ticket-count]", talismanStatus);
  setText("[data-lucky-number]", luckyStatus);
  setText("[data-withdrawable-dividend]", formatToken(withdrawable, project.symbol));
  setText("[data-talisman-status]", talismanStatus);
  setText("[data-lucky-status]", luckyStatus);
  updateRewardActionState(project, rewardEnabled);
}

async function connectWallet() {
  if (!window.ethereum) {
    showToast("未检测到钱包插件，请安装 MetaMask 或 OKX Wallet。", "error");
    return;
  }

  const provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  state.provider = provider;
  state.signer = await provider.getSigner();
  state.account = await state.signer.getAddress();
  setText("[data-wallet-label]", shortAddress(state.account));
  showToast("钱包已连接");

  if (state.launchpadAddress && ethers.isAddress(state.launchpadAddress)) {
    state.launchpad = new ethers.Contract(state.launchpadAddress, LAUNCHPAD_ABI, state.provider);
    state.vaultAddress = await state.launchpad.vault();
    state.vault = new ethers.Contract(state.vaultAddress, VAULT_ABI, state.provider);
    state.launchpadOwner = await state.launchpad.owner().catch(() => ZERO_ADDRESS);
    await loadProjects();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("avatar-invalid"));
      }
    };
    reader.onerror = () => reject(reader.error || new Error("avatar-invalid"));
    reader.readAsDataURL(file);
  });
}

function loadDataUrlImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("avatar-invalid"));
    image.src = dataUrl;
  });
}

async function normalizeAvatarFile(file) {
  if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
    throw new Error("avatar-invalid");
  }

  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    throw new Error("avatar-source-large");
  }

  const avatar = file.type === "image/png" || file.type === "image/jpeg" || file.type === "image/webp"
    ? await compressRasterAvatar(file)
    : await readFileAsDataUrl(file);

  if (readTextBytes(avatar) > AVATAR_MAX_METADATA_BYTES) {
    throw new Error("avatar-metadata-large");
  }

  return avatar;
}

async function compressRasterAvatar(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadDataUrlImage(dataUrl);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const side = Math.min(width, height);
  const outputSize = Math.max(1, Math.min(AVATAR_CANVAS_SIZE, side));
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;

  const context = canvas.getContext("2d");
  if (!context) {
    return dataUrl;
  }

  const sourceX = (width - side) / 2;
  const sourceY = (height - side) / 2;
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, outputSize, outputSize);

  return canvas.toDataURL("image/webp", 0.82);
}

function buildProjectMetadataURI(form, params) {
  const metadata = {
    name: trimMetadataText(params.beastName),
    tokenName: trimMetadataText(params.tokenName),
    symbol: trimMetadataText(params.tokenSymbol, 32),
    beastType: params.beastType,
    avatar: avatarByForm.get(form) || "",
    attributes: [
      { trait_type: "神兽类型", value: BEAST_TYPE_NAMES[params.beastType] || "自定义" }
    ]
  };

  const output = JSON.stringify(metadata);
  if (readTextBytes(output) > MAX_ONCHAIN_METADATA_BYTES) {
    throw new Error("avatar-metadata-large");
  }

  return output;
}

async function updateUploadPreview(input) {
  const form = input.closest("form");
  const upload = input.closest("[data-avatar-upload]");
  const file = input.files?.[0];
  if (!form || !upload || !file) return;

  setAvatarError(upload, "");

  try {
    const avatar = await normalizeAvatarFile(file);
    avatarByForm.set(form, avatar);
    renderAvatarUpload(upload, avatar);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "avatar-invalid") {
      setAvatarError(upload, "请选择 PNG、JPEG、SVG、GIF 或 WebP 图片。");
    } else if (message === "avatar-source-large") {
      setAvatarError(upload, "图片不能超过 1MB。");
    } else {
      setAvatarError(upload, "头像压缩后仍然偏大，请换一张更小的图。");
    }
  } finally {
    input.value = "";
  }
}

function resetUploadPreview(form) {
  avatarByForm.delete(form);
  $$("[data-avatar-upload]", form).forEach((upload) => {
    renderAvatarUpload(upload, "");
    setAvatarError(upload, "");
    $$("input[type='file']", upload).forEach((input) => {
      input.value = "";
    });
  });
}

function removeAvatarUpload(button) {
  const form = button.closest("form");
  const upload = button.closest("[data-avatar-upload]");
  if (!form || !upload) return;

  avatarByForm.delete(form);
  renderAvatarUpload(upload, "");
  setAvatarError(upload, "");
  $$("input[type='file']", upload).forEach((input) => {
    input.value = "";
  });
}

function renderAvatarUpload(upload, avatar) {
  const drop = upload.querySelector("[data-avatar-drop]");
  const preview = upload.querySelector("[data-avatar-preview]");
  const title = upload.querySelector("[data-avatar-title]");
  const actions = upload.querySelector("[data-avatar-actions]");

  upload.dataset.hasAvatar = avatar ? "true" : "false";
  drop?.classList.toggle("has-avatar", Boolean(avatar));
  if (preview) {
    preview.innerHTML = avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : `<i data-lucide="plus"></i>`;
  }
  if (title) {
    title.textContent = avatar ? "头像已加入创建资料" : "上传神兽头像";
  }
  if (actions) {
    actions.hidden = !avatar;
  }
  refreshIcons();
}

function setAvatarError(upload, message) {
  const error = upload.querySelector("[data-avatar-error]");
  if (!error) return;

  error.textContent = message;
  error.hidden = !message;
}

async function createBeast(event) {
  event.preventDefault();
  if (!(await ensureWritable())) return;

  const form = event.currentTarget;
  const data = new FormData(form);
  const initialSupply = parseTokenAmount(data.get("initialSupply"));
  const auraThreshold = parseTokenAmount(data.get("auraThreshold"));
  const saleSupply = parseTokenAmount(data.get("saleSupply"));
  const saleEnabled = saleSupply > ZERO;
  const fundsReceiverInput = String(data.get("fundsReceiver") || "").trim();
  let mintPrice = ZERO;
  let maxMintPerWallet = ZERO;
  let saleDeadline = ZERO;
  let fundsReceiver = ZERO_ADDRESS;

  const params = {
    beastName: data.get("beastName").trim(),
    tokenName: data.get("tokenName").trim(),
    tokenSymbol: data.get("tokenSymbol").trim(),
    metadataURI: "",
    initialSupply,
    auraThreshold,
    beastType: Number(data.get("beastType")),
    saleSupply,
    mintPrice,
    maxMintPerWallet,
    saleDeadline,
    fundsReceiver
  };

  try {
    if (saleEnabled) {
      mintPrice = parseTokenAmount(data.get("mintPrice"));
      maxMintPerWallet = parseTokenAmount(data.get("maxMintPerWallet"));
      saleDeadline = parseDeadline(data.get("saleDeadline"));
      if (mintPrice === ZERO) {
        throw new Error("开启认购时需要填写认购单价");
      }
      if (fundsReceiverInput) {
        if (!ethers.isAddress(fundsReceiverInput)) {
          throw new Error("收款地址格式不正确");
        }
        fundsReceiver = fundsReceiverInput;
      }
      params.mintPrice = mintPrice;
      params.maxMintPerWallet = maxMintPerWallet;
      params.saleDeadline = saleDeadline;
      params.fundsReceiver = fundsReceiver;
    }

    params.metadataURI = buildProjectMetadataURI(form, params);
    showToast("创建交易已发起，请在钱包确认。");
    const launchpadWithSigner = state.launchpad.connect(state.signer);
    const tx = await launchpadWithSigner.createBeast(
      [
        params.beastName,
        params.tokenName,
        params.tokenSymbol,
        params.metadataURI,
        params.initialSupply,
        params.auraThreshold,
        params.beastType,
        params.saleSupply,
        params.mintPrice,
        params.maxMintPerWallet,
        params.saleDeadline,
        params.fundsReceiver
      ],
      { value: state.creationFee }
    );
    showToast("交易已提交，等待上链...");
    await tx.wait();
    showToast("神兽创建成功");
    form.reset();
    resetUploadPreview(form);
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`创建失败：${shortError(error)}`, "error");
  }
}

async function claimDividends() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable())) return;

  try {
    const token = new ethers.Contract(project.token, TOKEN_ABI, state.signer);
    const withdrawable = await token.withdrawableDividendOf(state.account);
    if (withdrawable === ZERO) {
      showToast("当前没有可领取分红。");
      return;
    }

    showToast("领取交易已发起，请在钱包确认。");
    const tx = await token.claimDividends();
    await tx.wait();
    showToast("分红领取成功");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`领取失败：${shortError(error)}`, "error");
  }
}

async function claimTalismanReward() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable())) return;

  try {
    const round = await state.vault.talismanRound(project.token).catch(() => ZERO);
    if (round === ZERO) {
      showToast("当前兽巢还没有灵符奖励轮次。", "error");
      return;
    }

    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("灵符领取交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.claimTalismanReward(project.token);
    await tx.wait();
    showToast("灵符奖励已结算");
    await loadProjects();
    await renderIdentity();
  } catch (error) {
    console.error(error);
    showToast(`灵符领取失败：${shortError(error)}`, "error");
  }
}

async function assignLuckyNumber() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable())) return;

  try {
    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("本命号码绑定交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.assignLuckyNumber(project.token);
    await tx.wait();
    showToast("本命号码绑定成功");
    await loadProjects();
    await renderIdentity();
  } catch (error) {
    console.error(error);
    showToast(`号码绑定失败：${shortError(error)}`, "error");
  }
}

async function claimLuckyNumberReward() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable())) return;

  try {
    const [hasNumber, round] = await Promise.all([
      state.vault.hasLuckyNumber(project.token, state.account).catch(() => false),
      state.vault.luckyRound(project.token).catch(() => ZERO)
    ]);

    if (!hasNumber) {
      await assignLuckyNumber();
      return;
    }
    if (round === ZERO) {
      showToast("号码已绑定，等待下一轮开奖。");
      return;
    }

    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("号码奖励领取交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.claimLuckyNumberReward(project.token, round);
    await tx.wait();
    showToast("号码奖励已结算");
    await loadProjects();
    await renderIdentity();
  } catch (error) {
    console.error(error);
    showToast(`号码奖励失败：${shortError(error)}`, "error");
  }
}

async function triggerEvolution() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable())) return;

  try {
    const token = new ethers.Contract(project.token, TOKEN_ABI, state.signer);
    showToast("进化交易已发起，请在钱包确认。");
    const tx = await token.triggerEvolution();
    await tx.wait();
    showToast("神兽进化成功");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`进化失败：${shortError(error)}`, "error");
  }
}

function selectedSaleVault(signerOrProvider = state.provider) {
  const project = selectedProject();
  if (!project?.sale || !project.saleVault || project.saleVault === ZERO_ADDRESS) {
    throw new Error("当前神兽未开启认购发射");
  }
  return new ethers.Contract(project.saleVault, SALE_VAULT_ABI, signerOrProvider);
}

async function buySale(event) {
  event.preventDefault();
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable())) return;
  if (!project.sale) {
    showToast("当前神兽未开启认购。", "error");
    return;
  }
  const status = saleStatusLabel(project);
  if (status !== "认购中") {
    const message = status === "可开盘" ? "认购已结束，等待项目方开盘。" : `当前状态为“${status}”，不能继续认购。`;
    showToast(message, "error");
    return;
  }

  const data = new FormData(event.currentTarget);
  const tokenAmount = parseTokenAmount(data.get("tokenAmount"));
  if (tokenAmount === ZERO) {
    showToast("请输入认购数量。", "error");
    return;
  }
  if (tokenAmount > project.sale.remainingSaleSupply) {
    showToast("认购数量超过剩余数量，请减少数量后再试。", "error");
    return;
  }

  try {
    const cost = (tokenAmount * project.sale.mintPrice) / TOKEN_UNIT;
    if (cost === ZERO) {
      showToast("认购金额太小，请增加认购数量。", "error");
      return;
    }
    const saleVault = selectedSaleVault(state.signer);
    if (project.sale.maxMintPerWallet > ZERO) {
      const purchased = await saleVault.purchased(state.account).catch(() => ZERO);
      if (purchased + tokenAmount > project.sale.maxMintPerWallet) {
        showToast("认购数量超过当前钱包上限，请减少数量后再试。", "error");
        return;
      }
    }
    const balance = await state.provider.getBalance(state.account).catch(() => ZERO);
    if (balance < cost) {
      showToast(`钱包 ${NATIVE_SYMBOL} 余额不足，无法支付本次认购。`, "error");
      return;
    }
    showToast("认购交易已发起，请在钱包确认。");
    const tx = await saleVault.buy(tokenAmount, { value: cost });
    await tx.wait();
    showToast("认购成功");
    event.currentTarget.reset();
    await loadProjects();
    await renderIdentity();
  } catch (error) {
    console.error(error);
    showToast(`认购失败：${shortError(error)}`, "error");
  }
}

async function finalizeSale(event) {
  event.preventDefault();
  const project = requireSelectedProject();
  if (!project) return;
  if (!(await ensureWritable())) return;

  const pair = String(new FormData(event.currentTarget).get("pair") || "").trim();
  if (!ethers.isAddress(pair)) {
    showToast("请输入有效的交易对地址。", "error");
    return;
  }

  try {
    showToast("开盘交易已发起，请在钱包确认。");
    if (project.sale) {
      const saleVault = selectedSaleVault(state.signer);
      const tx = await saleVault.finalize(pair);
      await tx.wait();
    } else {
      if (!sameAddress(state.account, project.creator)) {
        showToast("只有神兽创建者钱包可以直接开盘。", "error");
        return;
      }
      const token = new ethers.Contract(project.token, TOKEN_ABI, state.signer);
      const pairTx = await token.setAutomatedMarketMakerPair(pair, true);
      await pairTx.wait();
      const openTx = await token.enableTrading();
      await openTx.wait();
    }
    showToast("发射已开盘，交易权限已锁定");
    event.currentTarget.reset();
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`开盘失败：${shortError(error)}`, "error");
  }
}

async function cancelSale() {
  const project = requireSelectedProject();
  if (!project) return;
  if (!(await ensureWritable())) return;

  try {
    const saleVault = selectedSaleVault(state.signer);
    showToast("取消发射交易已发起，请在钱包确认。");
    const tx = await saleVault.cancel();
    await tx.wait();
    showToast("发射已取消，用户可申请退款");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`取消失败：${shortError(error)}`, "error");
  }
}

async function claimRefund() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable())) return;
  if (!project.sale) {
    showToast("当前神兽未开启认购。", "error");
    return;
  }

  try {
    const saleVault = selectedSaleVault(state.signer);
    const purchased = await saleVault.purchased(state.account);
    if (purchased === ZERO) {
      showToast("当前钱包没有可退款的认购记录。");
      return;
    }

    const token = new ethers.Contract(project.token, TOKEN_ABI, state.signer);
    const allowance = await token.allowance(state.account, project.saleVault);
    if (allowance < purchased) {
      showToast("先授权退回认购 Token，请在钱包确认。");
      const approveTx = await token.approve(project.saleVault, purchased);
      await approveTx.wait();
    }

    showToast("退款交易已发起，请在钱包确认。");
    const tx = await saleVault.claimRefund();
    await tx.wait();
    showToast("退款成功");
    await loadProjects();
    await renderIdentity();
  } catch (error) {
    console.error(error);
    showToast(`退款失败：${shortError(error)}`, "error");
  }
}

async function withdrawCancelledTokens() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable())) return;
  if (!project.sale) {
    showToast("当前神兽未开启认购。", "error");
    return;
  }

  try {
    const saleVault = selectedSaleVault(state.signer);
    showToast("取回剩余 Token 交易已发起，请在钱包确认。");
    const tx = await saleVault.withdrawCancelledTokens(state.account);
    await tx.wait();
    showToast("剩余 Token 已取回");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`取回失败：${shortError(error)}`, "error");
  }
}

async function saveEvolutionConfig(event) {
  event.preventDefault();
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable()) || !requireOwnerWallet()) return;

  const data = new FormData(event.currentTarget);
  try {
    const burnBps = parsePercentBps(data.get("burnBps"), "进化池销毁比例");
    const rewardDividendBps = parsePercentBps(data.get("rewardDividendBps"), "奖励池分红释放比例");

    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("进化机制设置交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.setEvolutionPayoutConfig(project.token, burnBps, rewardDividendBps);
    await tx.wait();
    showToast("进化机制已更新");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`进化机制设置失败：${shortError(error)}`, "error");
  }
}

async function saveRewardConfig(event) {
  event.preventDefault();
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable()) || !requireOwnerWallet()) return;

  const data = new FormData(event.currentTarget);
  try {
    const talismanChanceBps = parsePercentBps(data.get("talismanChance"), "灵符中奖率");
    const talismanPrizeBps = parsePercentBps(data.get("talismanPrize"), "灵符奖励比例");
    const luckyPrizeBps = parsePercentBps(data.get("luckyPrize"), "号码奖励比例");
    const luckyModulo = Number(data.get("luckyModulo") || 0);
    if (!Number.isInteger(luckyModulo) || luckyModulo <= 0 || luckyModulo > 65535) {
      throw new Error("号码范围需要在 1 到 65535 之间");
    }
    const minHoldAmount = parseTokenAmount(data.get("minHoldAmount"));
    const enabled = data.get("enabled") === "on";

    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("奖励设置交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.setRewardConfig(
      project.token,
      talismanChanceBps,
      talismanPrizeBps,
      luckyPrizeBps,
      luckyModulo,
      minHoldAmount,
      enabled
    );
    await tx.wait();
    showToast("奖励设置已更新");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`奖励设置失败：${shortError(error)}`, "error");
  }
}

async function openRewardRound() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable()) || !requireOwnerWallet()) return;

  try {
    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("开奖交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.openRewardRound(project.token);
    await tx.wait();
    showToast("新一轮奖励已开启");
    await loadProjects();
    await renderIdentity();
  } catch (error) {
    console.error(error);
    showToast(`开奖失败：${shortError(error)}`, "error");
  }
}

async function saveDexConfig(event) {
  event.preventDefault();
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable()) || !requireOwnerWallet()) return;

  const data = new FormData(event.currentTarget);
  try {
    const nativePair = data.get("nativePair") === "on";
    const burnBuyback = data.get("burnBuyback") === "on";
    const enabled = data.get("enabled") === "on";
    const router = normalizeAddressInput(data.get("router"), ZERO_ADDRESS);
    const pairedToken = normalizeAddressInput(data.get("pairedToken"), ZERO_ADDRESS);
    const pair = normalizeAddressInput(data.get("pair"), ZERO_ADDRESS);
    const liquidityReceiver = normalizeAddressInput(data.get("liquidityReceiver"), ZERO_ADDRESS);
    const buybackRecipient = normalizeAddressInput(data.get("buybackRecipient"), ZERO_ADDRESS);

    if (enabled) {
      if (sameAddress(router, ZERO_ADDRESS)) throw new Error("启用 DEX 时需要填写 Router 地址");
      if (sameAddress(liquidityReceiver, ZERO_ADDRESS)) throw new Error("启用 DEX 时需要填写 LP 接收地址");
      if (!nativePair && sameAddress(pairedToken, ZERO_ADDRESS)) throw new Error("非原生币交易对需要填写配对 Token");
      if (!burnBuyback && sameAddress(buybackRecipient, ZERO_ADDRESS)) throw new Error("非销毁回购需要填写回购接收地址");
    }

    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("DEX 配置交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.setDexConfig(
      project.token,
      router,
      pairedToken,
      pair,
      liquidityReceiver,
      buybackRecipient,
      nativePair,
      burnBuyback,
      enabled
    );
    await tx.wait();
    showToast("DEX 配置已更新");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`DEX 配置失败：${shortError(error)}`, "error");
  }
}

async function saveDexAutomationConfig(event) {
  event.preventDefault();
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable()) || !requireOwnerWallet()) return;

  const data = new FormData(event.currentTarget);
  try {
    const autoBuybackBps = parsePercentBps(data.get("autoBuyback"), "自动回购比例");
    const autoLiquidityBps = parsePercentBps(data.get("autoLiquidity"), "自动加池比例");
    if (autoBuybackBps + autoLiquidityBps > 10000) {
      throw new Error("自动回购和自动加池合计不能超过 100%");
    }
    const autoProcessThreshold = parseTokenAmount(data.get("autoThreshold"));
    const autoProcessLimit = parseTokenAmount(data.get("autoLimit"));

    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("自动机制交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.setDexAutomationConfig(
      project.token,
      autoBuybackBps,
      autoLiquidityBps,
      autoProcessThreshold,
      autoProcessLimit
    );
    await tx.wait();
    showToast("自动机制已更新");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`自动机制失败：${shortError(error)}`, "error");
  }
}

async function processAutoDex() {
  const project = requireSelectedProject();
  if (!project || !(await ensureWritable()) || !requireOwnerWallet()) return;

  try {
    const launchpadWithSigner = state.launchpad.connect(state.signer);
    showToast("自动处理交易已发起，请在钱包确认。");
    const tx = await launchpadWithSigner.processAutoDex(project.token);
    await tx.wait();
    showToast("税池自动处理已完成");
    await loadProjects();
  } catch (error) {
    console.error(error);
    showToast(`自动处理失败：${shortError(error)}`, "error");
  }
}

async function ensureWritable() {
  if (!state.launchpad || !state.launchpadAddress) {
    showToast("请先配置 Launchpad 合约地址。", "error");
    return false;
  }

  if (!state.account || !state.signer) {
    await connectWallet();
  }

  return Boolean(state.signer);
}

function shortError(error) {
  const message = error?.shortMessage || error?.reason || error?.message?.split("\n")[0] || "";
  if (message.includes("missing revert data") || message.includes("execution reverted")) {
    return "交易条件不满足，请检查数量、剩余份额、钱包上限和钱包余额";
  }
  if (error?.code === "BAD_DATA" || message.includes("could not decode result data")) {
    return "当前地址不是神兽发射台合约，请重新部署或填写正确地址";
  }
  if (message.includes("ECONNREFUSED") || message.includes("failed to detect network")) {
    return "RPC 未连接，请先启动本地链或检查网络配置";
  }
  return error?.shortMessage || error?.reason || error?.message?.split("\n")[0] || "未知错误";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function copyTokenAddress() {
  const project = requireSelectedProject();
  if (!project) return;
  navigator.clipboard?.writeText(project.token);
  showToast("Token 地址已复制");
}

function showOfficialMintPlaceholder() {
  showToast("官方 Mint 板块已预留，等 Mint 合约地址和 ABI 接入后即可开放。");
}

function showPlatformTokenPlaceholder() {
  showToast("平台币入口已预留，等平台币合约部署后接入余额和操作。");
}

function pageFromHash(hash = window.location.hash) {
  const page = String(hash || "#home").replace("#", "");
  return PAGE_NAMES.includes(page) ? page : "home";
}

function updateNavigationActive(page) {
  $$("[data-nav]").forEach((item) => {
    item.classList.toggle("active", pageFromHash(item.dataset.nav) === page);
  });

  $$(".top-tabs a[href^='#']").forEach((link) => {
    link.classList.toggle("active", pageFromHash(link.getAttribute("href")) === page);
  });
}

function showPage(pageName, options = {}) {
  const page = PAGE_NAMES.includes(pageName) ? pageName : "home";
  const { updateHash = true, scroll = true } = options;

  state.activePage = page;
  $$("[data-page]").forEach((view) => {
    view.classList.toggle("active", view.dataset.page === page);
  });
  updateNavigationActive(page);

  if (updateHash && window.location.hash !== `#${page}`) {
    window.history.pushState({ page }, "", `#${page}`);
  }

  if (scroll) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function setActiveButton(button) {
  const group = button.closest(".side-nav, .status-strip, .mobile-dock");
  if (!group) return;
  $$("button", group).forEach((item) => item.classList.remove("active"));
  button.classList.add("active");
}

function bindEvents() {
  $("[data-address-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const address = new FormData(event.currentTarget).get("launchpad").trim();
    if (!ethers.isAddress(address)) {
      showToast("请输入有效的合约地址。", "error");
      return;
    }
    localStorage.setItem("beast.launchpadAddress", address);
    await bootstrap();
  });

  $$("[data-create-form]").forEach((form) => {
    form.addEventListener("submit", createBeast);
  });

  $$("[data-sale-buy-form]").forEach((form) => {
    form.addEventListener("submit", buySale);
  });

  $$("[data-official-mint-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      showOfficialMintPlaceholder();
    });
  });

  $$("[data-sale-owner-form]").forEach((form) => {
    form.addEventListener("submit", finalizeSale);
  });

  $$("[data-image-upload]").forEach((input) => {
    input.addEventListener("change", () => {
      updateUploadPreview(input).catch((error) => showToast(shortError(error), "error"));
    });
  });

  $$('a[href^="#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPage(pageFromHash(link.getAttribute("href")));
    });
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.matches("[data-evolution-config-form]")) {
      await saveEvolutionConfig(event);
    }
    if (form.matches("[data-reward-config-form]")) {
      await saveRewardConfig(event);
    }
    if (form.matches("[data-dex-config-form]")) {
      await saveDexConfig(event);
    }
    if (form.matches("[data-dex-auto-form]")) {
      await saveDexAutomationConfig(event);
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    setActiveButton(button);

    if (button.matches("[data-avatar-remove]")) {
      removeAvatarUpload(button);
      return;
    }

    const nav = button.dataset.nav;
    if (nav) {
      showPage(pageFromHash(nav));
      return;
    }

    const projectId = button.dataset.enterProject;
    if (projectId !== undefined) {
      state.selectedProjectId = Number(projectId);
      renderAllViews();
      await renderIdentity();
      if (!button.closest("[data-reward-projects]")) {
        showPage("rank");
      }
      return;
    }

    const action = button.dataset.action;
    if (action === "connect-wallet") await connectWallet();
    if (action === "refresh") await bootstrap();
    if (action === "claim-dividends") await claimDividends();
    if (action === "claim-talisman") await claimTalismanReward();
    if (action === "lucky-number-action") await claimLuckyNumberReward();
    if (action === "open-reward-round") await openRewardRound();
    if (action === "process-auto-dex") await processAutoDex();
    if (action === "trigger-evolution") await triggerEvolution();
    if (action === "copy-token") copyTokenAddress();
    if (action === "claim-refund") await claimRefund();
    if (action === "cancel-sale") await cancelSale();
    if (action === "withdraw-cancelled-tokens") await withdrawCancelledTokens();
    if (action === "platform-token-placeholder") showPlatformTokenPlaceholder();
    if (action === "select-first" && state.projects[0]) {
      state.selectedProjectId = state.projects[0].id;
      renderAllViews();
      await renderIdentity();
      showPage("rank");
    }
    if (action === "select-first" && !state.projects[0]) {
      showToast("暂无可进入的神兽，请先创建或读取项目。", "error");
    }
    if (action === "select-next") {
      const next = [...state.projects].filter((project) => project.stage < 4).sort((a, b) => b.progress - a.progress)[0];
      if (next) {
        state.selectedProjectId = next.id;
        renderAllViews();
        await renderIdentity();
        showPage("rank");
      } else {
        showToast("暂无可进化候选神兽。", "error");
      }
    }
  });

  $$(".status-card").forEach((button) => {
    button.addEventListener("click", () => {
      state.stageFilter = button.dataset.stageFilter;
      renderProjects();
    });
  });

  ["input", "change"].forEach((eventName) => {
    $("[data-project-search]")?.addEventListener(eventName, renderProjects);
    $("[data-project-sort]")?.addEventListener(eventName, renderProjects);
  });

  window.addEventListener("hashchange", () => showPage(pageFromHash(), { updateHash: false }));
  window.addEventListener("popstate", () => showPage(pageFromHash(), { updateHash: false }));
  window.ethereum?.on?.("accountsChanged", () => window.location.reload());
  window.ethereum?.on?.("chainChanged", () => window.location.reload());
}

async function bootstrap() {
  try {
    if (await connectContracts()) {
      await loadProjects();
    }
  } catch (error) {
    console.warn(error);
    updateConnectionStatus(shortError(error), false);
    clearChainData();
  }
}

bindEvents();
showPage(pageFromHash(), { updateHash: false, scroll: false });
window.scrollTo({ top: 0, behavior: "auto" });
refreshIcons();
bootstrap();
