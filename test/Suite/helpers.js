// test/Suite/helpers.js
// Shared deployment helpers and constants for the Hesty test suite.
// All tests target the CURRENT contract API (as of this writing):
//   TokenFactory constructor: (fee, treasury_, minInvAmount_, ctrHestyControl_)  — 4 params
//   TokenFactory.initialize:  (ctrHestyIssuance_)                                — 1 param

const { ethers } = require("hardhat");

// ─── Constants ───────────────────────────────────────────────────────────────

// Default property parameters used across tests
const PROP = {
  amount: 1000,     // total property tokens to sell
  listingFee: 1000, // 10 % listing-fee in basis-points
  tokenPrice: 100,  // 100 payment-token units per property-token
  threshold: 500,   // minimum raise in payment-token units (= 5 tokens)
  name: "Test Property",
  symbol: "PROP",
};

const PLATFORM_FEE_BP = 300;          // 3 % platform fee
const FAR_FUTURE      = 9_999_999_999; // timestamp ~year 2286, always in future
const ONE_DAY         = 86_400;        // seconds

// ─── Full system deployment ───────────────────────────────────────────────────

async function deploySystem() {
  const [
    owner, treasury, propOwner, investor1, investor2,
    kycManager, fundsManager, pauserManager, blacklistManager, random,
  ] = await ethers.getSigners();

  // HestyAccessControl
  const HestyAccessControl = await ethers.getContractFactory("HestyAccessControl");
  const hestyAC = await HestyAccessControl.connect(owner).deploy();
  await hestyAC.deployed();

  // Payment / reward token (mock EURC)
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const eurc = await MockERC20.connect(owner).deploy("Euro Circle", "EURC");
  await eurc.deployed();

  // TokenFactory
  const TokenFactory = await ethers.getContractFactory("TokenFactory");
  const tokenFactory = await TokenFactory.connect(owner).deploy(
    PLATFORM_FEE_BP,   // fee (3 %)
    treasury.address,  // treasury
    1,                 // minInvAmount
    hestyAC.address    // ctrHestyControl
  );
  await tokenFactory.deployed();

  // HestyAssetIssuance
  const Issuance = await ethers.getContractFactory("HestyAssetIssuance");
  const issuance = await Issuance.connect(owner).deploy(tokenFactory.address);
  await issuance.deployed();

  // ReferralSystem
  const Referral = await ethers.getContractFactory("ReferralSystem");
  const referral = await Referral.connect(owner).deploy(
    eurc.address, hestyAC.address, tokenFactory.address
  );
  await referral.deployed();

  // HestyRouter
  const Router = await ethers.getContractFactory("HestyRouter");
  const router = await Router.connect(owner).deploy(tokenFactory.address, hestyAC.address);
  await router.deployed();

  // ── Role grants ──────────────────────────────────────────────────────────
  const KYC_MANAGER      = await hestyAC.KYC_MANAGER();
  const FUNDS_MANAGER    = await hestyAC.FUNDS_MANAGER();
  const PAUSER_MANAGER   = await hestyAC.PAUSER_MANAGER();
  const BLACKLIST_MANAGER= await hestyAC.BLACKLIST_MANAGER();

  await hestyAC.grantRole(KYC_MANAGER,       kycManager.address);
  await hestyAC.grantRole(FUNDS_MANAGER,     fundsManager.address);
  await hestyAC.grantRole(PAUSER_MANAGER,    pauserManager.address);
  await hestyAC.grantRole(BLACKLIST_MANAGER, blacklistManager.address);

  // ── Initialize TokenFactory & whitelist token ─────────────────────────────
  await tokenFactory.connect(owner).initialize(issuance.address);
  await tokenFactory.connect(owner).addWhitelistedToken(eurc.address);

  return {
    owner, treasury, propOwner, investor1, investor2,
    kycManager, fundsManager, pauserManager, blacklistManager, random,
    hestyAC, eurc, tokenFactory, issuance, referral, router,
  };
}

// ─── Property helpers ─────────────────────────────────────────────────────────

async function kycApprove(ctx, user) {
  try { await ctx.hestyAC.connect(ctx.kycManager).approveKYCOnly(user.address); } catch (_) {}
}

async function createProperty(ctx, overrides = {}) {
  const { tokenFactory, eurc, hestyAC, propOwner } = ctx;
  const p = { ...PROP, ...overrides };
  await tokenFactory.connect(propOwner).createProperty(
    p.amount, p.listingFee, p.tokenPrice, p.threshold,
    eurc.address, eurc.address, p.name, p.symbol, hestyAC.address
  );
  const propId = (await tokenFactory.propertyCounter()).toNumber() - 1;
  return propId;
}

async function approveProperty(ctx, propId, deadline = FAR_FUTURE) {
  await ctx.tokenFactory.connect(ctx.owner).approveProperty(propId, deadline);
}

async function fundAndBuy(ctx, investor, propId, tokenAmt) {
  const { eurc, owner, tokenFactory } = ctx;
  await kycApprove(ctx, investor);
  const cost      = tokenAmt * PROP.tokenPrice;
  const fee       = Math.floor(cost * PLATFORM_FEE_BP / 10_000);
  const total     = cost + fee;
  await eurc.connect(owner).mint(investor.address, total * 2); // 2× buffer
  await eurc.connect(investor).approve(tokenFactory.address, ethers.constants.MaxUint256);
  await tokenFactory.connect(investor).buyTokens(
    investor.address, propId, tokenAmt, ethers.constants.AddressZero
  );
}

async function completeRaise(ctx, propId) {
  await ctx.tokenFactory.connect(ctx.owner).completeRaise(propId);
}

async function getPropertyToken(ctx, propId) {
  const prop = await ctx.tokenFactory.property(propId);
  const PT = await ethers.getContractFactory("PropertyToken");
  return PT.attach(prop.asset);
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

async function increaseTime(seconds) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine", []);
}

async function mineAt(timestamp) {
  await ethers.provider.send("evm_mine", [timestamp]);
}

module.exports = {
  deploySystem,
  kycApprove,
  createProperty,
  approveProperty,
  fundAndBuy,
  completeRaise,
  getPropertyToken,
  increaseTime,
  mineAt,
  PROP,
  PLATFORM_FEE_BP,
  FAR_FUTURE,
  ONE_DAY,
};
