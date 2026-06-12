// test/Suite/Integration.test.js
// End-to-end integration tests covering complete user flows across
// all Hesty contracts working together.

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const {
  deploySystem, kycApprove, createProperty, approveProperty,
  fundAndBuy, completeRaise, getPropertyToken,
  increaseTime, PROP, PLATFORM_FEE_BP, ONE_DAY,
} = require("./helpers");

// ─── Flow 1: Full On-chain Investment Lifecycle ───────────────────────────────
// Create → Approve → Buy → Complete → Get Tokens → Distribute → Claim Dividends

describe("Integration: Full On-chain Investment Lifecycle", function () {
  let ctx, propId, pt;

  before(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    propId = await createProperty(ctx);
    await approveProperty(ctx, propId);
    await fundAndBuy(ctx, ctx.investor1, propId, 5); // 5 tokens, meets threshold
    await fundAndBuy(ctx, ctx.investor2, propId, 5);
    await completeRaise(ctx, propId);
    pt = await getPropertyToken(ctx, propId);
  });

  it("treasury receives platform fee + listing fee after completeRaise", async function () {
    const cost      = 10 * PROP.tokenPrice; // both investors bought 5 each = 10 total
    const platFee   = Math.floor(cost * PLATFORM_FEE_BP / 10_000);
    const ownersFee = Math.floor(cost * PROP.listingFee / 10_000);
    const treasuryBal = await ctx.eurc.balanceOf(ctx.treasury.address);
    expect(treasuryBal).to.be.gte(platFee + ownersFee);
  });

  it("property owner receives propertyOwnerShare after completeRaise", async function () {
    const cost      = 10 * PROP.tokenPrice;
    const ownersFee = Math.floor(cost * PROP.listingFee / 10_000);
    const ownerShare = cost - ownersFee;
    expect(await ctx.eurc.balanceOf(ctx.propOwner.address)).to.equal(ownerShare);
  });

  it("investors claim property tokens after raise", async function () {
    await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, propId);
    await ctx.tokenFactory.getInvestmentTokens(ctx.investor2.address, propId);
    expect(await pt.balanceOf(ctx.investor1.address)).to.equal(ethers.utils.parseEther("5"));
    expect(await pt.balanceOf(ctx.investor2.address)).to.equal(ethers.utils.parseEther("5"));
  });

  it("revenue distributor pushes dividends to PropertyToken", async function () {
    const revenue = 100_000;
    await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, revenue);
    await ctx.eurc.connect(ctx.owner).approve(ctx.tokenFactory.address, revenue);
    await ctx.tokenFactory.connect(ctx.owner).distributeRevenue(propId, revenue);
    expect(await pt.dividendPerToken()).to.be.gt(0);
  });

  it("each investor can claim dividends proportional to their token holdings", async function () {
    // The previous test ("revenue distributor pushes dividends") already distributed
    // 100 000 units. Claim that accumulated revenue — do not distribute again.
    const b1Before = await ctx.eurc.balanceOf(ctx.investor1.address);
    await ctx.tokenFactory.connect(ctx.owner).claimInvestmentReturns(ctx.investor1.address, propId);
    const b1After  = await ctx.eurc.balanceOf(ctx.investor1.address);
    const earned1  = b1After.sub(b1Before).toNumber();

    const b2Before = await ctx.eurc.balanceOf(ctx.investor2.address);
    await ctx.tokenFactory.connect(ctx.owner).claimInvestmentReturns(ctx.investor2.address, propId);
    const b2After  = await ctx.eurc.balanceOf(ctx.investor2.address);
    const earned2  = b2After.sub(b2Before).toNumber();

    const distributed = 100_000; // from previous test
    // Both investors hold 5/1000 = 0.5 % — equal shares, equal dividends (±1 rounding)
    expect(earned1).to.be.closeTo(earned2, 1);
    expect(earned1).to.be.closeTo(Math.floor(distributed * 5 / 1000), 1);
  });
});

// ─── Flow 2: Failed Raise — Fund Recovery ─────────────────────────────────────
// Create → Approve → Buy below threshold → Deadline passes → Recover funds

describe("Integration: Failed Raise – Fund Recovery", function () {
  let ctx, propId;
  const SHORT_DEADLINE_SECS = 120; // 2 minutes from now

  before(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    propId = await createProperty(ctx);

    const deadline = (await ethers.provider.getBlock("latest")).timestamp + SHORT_DEADLINE_SECS;
    await ctx.tokenFactory.connect(ctx.owner).approveProperty(propId, deadline);

    // investor1 buys 2 tokens (200 units) — below threshold of 500
    await kycApprove(ctx, ctx.investor1);
    const cost = 2 * PROP.tokenPrice;
    const fee  = Math.floor(cost * PLATFORM_FEE_BP / 10_000);
    await ctx.eurc.connect(ctx.owner).mint(ctx.investor1.address, (cost + fee) * 2);
    await ctx.eurc.connect(ctx.investor1).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
    await ctx.tokenFactory.connect(ctx.investor1).buyTokens(
      ctx.investor1.address, propId, 2, ethers.constants.AddressZero
    );
  });

  it("cannot complete raise while threshold is not met", async function () {
    await expect(
      ctx.tokenFactory.connect(ctx.owner).completeRaise(propId)
    ).to.be.revertedWith("Threshold not met");
  });

  it("cannot recover funds before deadline passes", async function () {
    await expect(
      ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, propId)
    ).to.be.revertedWith("Time not valid");
  });

  it("investor recovers full investment (principal + fee) after deadline", async function () {
    // Advance time past the deadline
    await increaseTime(SHORT_DEADLINE_SECS + 10);

    const cost     = 2 * PROP.tokenPrice;
    const fee      = Math.floor(cost * PLATFORM_FEE_BP / 10_000);
    const expected = cost + fee;

    const before = await ctx.eurc.balanceOf(ctx.investor1.address);
    await ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, propId);
    const after  = await ctx.eurc.balanceOf(ctx.investor1.address);

    expect(after.sub(before)).to.equal(expected);
  });

  it("cannot recover twice (accounting zeroed after first recovery)", async function () {
    const before = await ctx.eurc.balanceOf(ctx.investor1.address);
    await ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, propId);
    const after = await ctx.eurc.balanceOf(ctx.investor1.address);
    expect(after).to.equal(before); // zero payout
  });
});

// ─── Flow 3: Cancel-and-Recover Flow ─────────────────────────────────────────
// Create → Approve → Buy → Admin Cancels → Investor Recovers

describe("Integration: Admin Cancel – Fund Recovery", function () {
  let ctx, propId;

  beforeEach(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    propId = await createProperty(ctx);
    await approveProperty(ctx, propId);
    await fundAndBuy(ctx, ctx.investor1, propId, 2);
  });

  it("investor recovers funds immediately after admin cancel", async function () {
    const invested = await ctx.tokenFactory.userInvested(ctx.investor1.address, propId);
    const fee      = await ctx.tokenFactory.feeChargedToUser(ctx.investor1.address, propId);

    await ctx.tokenFactory.connect(ctx.owner).cancelProperty(propId);

    const before = await ctx.eurc.balanceOf(ctx.investor1.address);
    await ctx.tokenFactory.recoverFundsInvested(ctx.investor1.address, propId);
    const after  = await ctx.eurc.balanceOf(ctx.investor1.address);

    expect(after.sub(before)).to.equal(invested.add(fee));
  });

  it("cannot approve a canceled property", async function () {
    await ctx.tokenFactory.connect(ctx.owner).cancelProperty(propId);
    await createProperty(ctx); // propId+1
    await ctx.tokenFactory.connect(ctx.owner).approveProperty(propId + 1, 9_999_999_999);
    // Try to approve the dead property
    await expect(
      ctx.tokenFactory.connect(ctx.owner).approveProperty(propId, 9_999_999_999)
    ).to.be.revertedWith("Already Canceled");
  });
});

// ─── Flow 4: Off-chain (Router) Investment Flow ───────────────────────────────
// Admin registers off-chain investment via HestyRouter → completeRaise → adminDistribution

describe("Integration: Off-chain Investment via HestyRouter", function () {
  let ctx, propId;

  before(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    propId = await createProperty(ctx);
    await approveProperty(ctx, propId);

    // Router must have FUNDS_MANAGER role to call TokenFactory.adminBuyTokens
    await ctx.hestyAC.grantRole(await ctx.hestyAC.FUNDS_MANAGER(), ctx.router.address);

    // KYC investor1 so adminBuyTokens doesn't revert
    await kycApprove(ctx, ctx.investor1);

    // Register 5 off-chain token purchases for investor1
    await ctx.router.connect(ctx.owner).offChainBuyTokens(propId, ctx.investor1.address, 5);
  });

  it("rightForTokens is assigned without EURC transfer", async function () {
    expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, propId)).to.equal(5);
  });

  it("admin can complete raise after off-chain investment meets threshold", async function () {
    // threshold = 5 * 100 = 500, raised * price = 5 * 100 = 500 ✓
    await ctx.tokenFactory.connect(ctx.owner).completeRaise(propId);
    const prop = await ctx.tokenFactory.property(propId);
    expect(prop.isCompleted).to.equal(true);
  });

  it("investor can claim property tokens after raise completes", async function () {
    const pt = await getPropertyToken(ctx, propId);
    await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, propId);
    expect(await pt.balanceOf(ctx.investor1.address)).to.equal(ethers.utils.parseEther("5"));
  });

  it("admin can distribute revenue via router (adminDistribution)", async function () {
    const amt = 50_000;
    // Fund the router to hold revenue tokens
    await ctx.eurc.connect(ctx.owner).mint(ctx.router.address, amt);
    await ctx.router.connect(ctx.owner).adminDistribution(propId, amt);
    const pt = await getPropertyToken(ctx, propId);
    expect(await pt.dividendPerToken()).to.be.gt(0);
  });
});

// ─── Flow 5: Global Pause → Buy Blocked → Unpause → Buy Succeeds ──────────────

describe("Integration: Global Pause Enforcement", function () {
  let ctx, propId;

  beforeEach(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    propId = await createProperty(ctx);
    await approveProperty(ctx, propId);
    await kycApprove(ctx, ctx.investor1);
    await ctx.eurc.connect(ctx.owner).mint(ctx.investor1.address, 100_000);
    await ctx.eurc.connect(ctx.investor1).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
  });

  it("buyTokens reverts when system is globally paused", async function () {
    await ctx.hestyAC.connect(ctx.pauserManager).pause();
    await expect(
      ctx.tokenFactory.connect(ctx.investor1).buyTokens(
        ctx.investor1.address, propId, 2, ethers.constants.AddressZero
      )
    ).to.be.revertedWith("All Hesty Paused");
  });

  it("buyTokens succeeds after unpausing", async function () {
    await ctx.hestyAC.connect(ctx.pauserManager).pause();
    await ctx.hestyAC.connect(ctx.pauserManager).unpause();
    await ctx.tokenFactory.connect(ctx.investor1).buyTokens(
      ctx.investor1.address, propId, 2, ethers.constants.AddressZero
    );
    expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, propId)).to.equal(2);
  });

  it("distributeRevenue reverts when system is paused (even after raise complete)", async function () {
    await fundAndBuy(ctx, ctx.investor1, propId, 5);
    await completeRaise(ctx, propId);
    await ctx.hestyAC.connect(ctx.pauserManager).pause();

    await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, 50_000);
    await ctx.eurc.connect(ctx.owner).approve(ctx.tokenFactory.address, 50_000);
    await expect(
      ctx.tokenFactory.connect(ctx.owner).distributeRevenue(propId, 50_000)
    ).to.be.revertedWith("All Hesty Paused");
  });
});

// ─── Flow 6: Blacklist Enforcement ───────────────────────────────────────────

describe("Integration: Blacklist Enforcement", function () {
  let ctx, propId;

  beforeEach(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    propId = await createProperty(ctx);
    await approveProperty(ctx, propId);
    await kycApprove(ctx, ctx.investor1);
    await ctx.eurc.connect(ctx.owner).mint(ctx.investor1.address, 100_000);
    await ctx.eurc.connect(ctx.investor1).approve(ctx.tokenFactory.address, ethers.constants.MaxUint256);
  });

  it("blacklisted investor cannot call buyTokens", async function () {
    await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.investor1.address);
    await expect(
      ctx.tokenFactory.connect(ctx.investor1).buyTokens(
        ctx.investor1.address, propId, 2, ethers.constants.AddressZero
      )
    ).to.be.revertedWith("Blacklisted");
  });

  it("investor can buy again after being un-blacklisted", async function () {
    await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.investor1.address);
    await ctx.hestyAC.connect(ctx.blacklistManager).unBlacklistUser(ctx.investor1.address);
    await ctx.tokenFactory.connect(ctx.investor1).buyTokens(
      ctx.investor1.address, propId, 2, ethers.constants.AddressZero
    );
    expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, propId)).to.equal(2);
  });

  it("PropertyToken transfer blocked when recipient is blacklisted", async function () {
    await fundAndBuy(ctx, ctx.investor1, propId, 5);
    await completeRaise(ctx, propId);
    await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, propId);

    await kycApprove(ctx, ctx.investor2);
    await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.investor2.address);

    const pt = await getPropertyToken(ctx, propId);
    await expect(
      pt.connect(ctx.investor1).transfer(ctx.investor2.address, ethers.utils.parseEther("1"))
    ).to.be.revertedWith("Blacklisted");
  });
});

// ─── Flow 7: Extend Raise then Invest ────────────────────────────────────────

describe("Integration: Extend Raise then complete it", function () {
  let ctx, propId;

  beforeEach(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    propId = await createProperty(ctx);

    const block      = await ethers.provider.getBlock("latest");
    const deadline   = block.timestamp + 30 * ONE_DAY;
    await ctx.tokenFactory.connect(ctx.owner).approveProperty(propId, deadline);
  });

  it("admin can extend deadline by up to 15 days", async function () {
    const prop       = await ctx.tokenFactory.property(propId);
    const extended   = prop.raiseDeadline.toNumber() + 10 * ONE_DAY;
    await ctx.tokenFactory.connect(ctx.owner).extendRaiseForProperty(propId, extended);
    const propAfter  = await ctx.tokenFactory.property(propId);
    expect(propAfter.raiseDeadline).to.equal(extended);
  });

  it("investment succeeds in the extended window", async function () {
    const prop     = await ctx.tokenFactory.property(propId);
    const extended = prop.raiseDeadline.toNumber() + 10 * ONE_DAY;
    await ctx.tokenFactory.connect(ctx.owner).extendRaiseForProperty(propId, extended);

    // Advance to just before the extended deadline
    await increaseTime(39 * ONE_DAY);

    await fundAndBuy(ctx, ctx.investor1, propId, 5);
    expect(await ctx.tokenFactory.rightForTokens(ctx.investor1.address, propId)).to.equal(5);
  });
});

// ─── Flow 8: Multi-investor Revenue Fairness ──────────────────────────────────

describe("Integration: Multi-investor Revenue Fairness", function () {
  let ctx, propId, pt;

  before(async function () {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    propId = await createProperty(ctx);
    await approveProperty(ctx, propId);

    // investor1 buys 10 tokens, investor2 buys 5 (ratio 2:1)
    await fundAndBuy(ctx, ctx.investor1, propId, 10);
    await fundAndBuy(ctx, ctx.investor2, propId, 5);
    await completeRaise(ctx, propId);

    await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, propId);
    await ctx.tokenFactory.getInvestmentTokens(ctx.investor2.address, propId);

    pt = await getPropertyToken(ctx, propId);

    // Distribute revenue
    const rev = 300_000;
    await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, rev);
    await ctx.eurc.connect(ctx.owner).approve(pt.address, rev);
    await pt.connect(ctx.owner).distributionRewards(rev);
  });

  it("investor1 earns twice as much as investor2 (10 vs 5 tokens)", async function () {
    const b1b = await ctx.eurc.balanceOf(ctx.investor1.address);
    const b2b = await ctx.eurc.balanceOf(ctx.investor2.address);

    await pt.connect(ctx.owner).claimDividensExternal(ctx.investor1.address);
    await pt.connect(ctx.owner).claimDividensExternal(ctx.investor2.address);

    const earned1 = (await ctx.eurc.balanceOf(ctx.investor1.address)).sub(b1b).toNumber();
    const earned2 = (await ctx.eurc.balanceOf(ctx.investor2.address)).sub(b2b).toNumber();

    // investor1 holds 10/1000 = 1%, investor2 holds 5/1000 = 0.5%
    expect(earned1).to.be.closeTo(earned2 * 2, 2); // ratio 2:1 within rounding
  });

  it("total dividends paid out match distributed amount (within rounding)", async function () {
    // Note: 985 remaining tokens are in TokenFactory (unclaimed by others)
    // Total supply = 1000, claimed = 15, so TokenFactory still holds 985
    // The portions we care about: investor1(10) + investor2(5) = 15/1000

    const rev = 300_000;
    // investor1 and investor2 already claimed above, check their total
    // Expected: 300_000 * 15 / 1000 = 4500
    const b1b = await ctx.eurc.balanceOf(ctx.investor1.address);
    const b2b = await ctx.eurc.balanceOf(ctx.investor2.address);

    // Make another distribution to test accumulation
    await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, rev);
    await ctx.eurc.connect(ctx.owner).approve(pt.address, rev);
    await pt.connect(ctx.owner).distributionRewards(rev);

    await pt.connect(ctx.owner).claimDividensExternal(ctx.investor1.address);
    await pt.connect(ctx.owner).claimDividensExternal(ctx.investor2.address);

    const earned1 = (await ctx.eurc.balanceOf(ctx.investor1.address)).sub(b1b).toNumber();
    const earned2 = (await ctx.eurc.balanceOf(ctx.investor2.address)).sub(b2b).toNumber();
    const total   = earned1 + earned2;
    const expected = Math.floor(rev * 15 / 1000); // 15 tokens of 1000
    expect(total).to.be.closeTo(expected, 5);
  });
});
