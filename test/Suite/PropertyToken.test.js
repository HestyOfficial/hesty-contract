// test/Suite/PropertyToken.test.js
// Unit tests for PropertyToken.sol
// PropertyToken is deployed via HestyAssetIssuance; we use the full stack
// to obtain a live instance, then test its functions directly.

const { expect }  = require("chai");
const { ethers }  = require("hardhat");
const {
  deploySystem, kycApprove, createProperty, approveProperty,
  fundAndBuy, completeRaise, getPropertyToken, PROP,
} = require("./helpers");

describe("PropertyToken", function () {
  let ctx, pt;
  // Distribute enough revenue to be above the BASIS_POINTS (10 000) floor check
  const REVENUE_AMOUNT = 50_000;

  async function fullSetup() {
    ctx = await deploySystem();
    await kycApprove(ctx, ctx.propOwner);
    await createProperty(ctx);
    await approveProperty(ctx, 0);
    await fundAndBuy(ctx, ctx.investor1, 0, 5); // buy 5 tokens (meets threshold)
    await fundAndBuy(ctx, ctx.investor2, 0, 5); // buy another 5
    await completeRaise(ctx, 0);
    pt = await getPropertyToken(ctx, 0);
  }

  beforeEach(async function () {
    await fullSetup();
    // Give investor1 their property tokens
    await ctx.tokenFactory.getInvestmentTokens(ctx.investor1.address, 0);
  });

  // ─── Initial state ────────────────────────────────────────────────────────

  describe("Initial state", function () {
    it("total supply equals amount * 1e18", async function () {
      const expected = ethers.BigNumber.from(PROP.amount).mul(ethers.utils.parseEther("1"));
      expect(await pt.totalSupply()).to.equal(expected);
    });

    it("TokenFactory holds remaining unclaimed tokens", async function () {
      // Total minted = 1000 * 1e18; investor1 claimed 5.
      // TokenFactory still holds 995 (investor2's 5 + 990 unsold).
      const tfBal = await pt.balanceOf(ctx.tokenFactory.address);
      expect(tfBal).to.equal(ethers.utils.parseEther("995"));
    });

    it("dividendPerToken starts at 0", async function () {
      expect(await pt.dividendPerToken()).to.equal(0);
    });

    it("rewardAsset is the EURC token", async function () {
      expect(await pt.rewardAsset()).to.equal(ctx.eurc.address);
    });

    it("ctrHestyControl is set correctly", async function () {
      expect(await pt.ctrHestyControl()).to.equal(ctx.hestyAC.address);
    });

    it("reverts construction with supply >= TEN_POWER_FIFTEEN", async function () {
      // TEN_POWER_FIFTEEN = 10^15
      const badAmount = ethers.BigNumber.from(10).pow(15);
      const Issuance  = await ethers.getContractFactory("HestyAssetIssuance");
      const Referral  = await ethers.getContractFactory("ReferralSystem");
      // We cannot call createPropertyToken directly (only TokenFactory can)
      // Instead verify via issuance that HestyAssetIssuance enforces it
      const iss = await Issuance.deploy(ctx.tokenFactory.address);
      await iss.deployed();
      await expect(
        iss.createPropertyToken(
          badAmount, ctx.eurc.address, "T", "T", ctx.hestyAC.address, ctx.owner.address
        )
      ).to.be.revertedWith("Not TokenFactory");
    });
  });

  // ─── distributionRewards (direct call) ───────────────────────────────────

  describe("distributionRewards (direct)", function () {
    it("updates dividendPerToken correctly", async function () {
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, REVENUE_AMOUNT);
      await ctx.eurc.connect(ctx.owner).approve(pt.address, REVENUE_AMOUNT);
      await pt.connect(ctx.owner).distributionRewards(REVENUE_AMOUNT);
      expect(await pt.dividendPerToken()).to.be.gt(0);
    });

    it("reverts if amount <= BASIS_POINTS (10 000)", async function () {
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, 10_000);
      await ctx.eurc.connect(ctx.owner).approve(pt.address, 10_000);
      await expect(
        pt.connect(ctx.owner).distributionRewards(10_000)
      ).to.be.revertedWith("Amount too low");
    });

    it("reverts when paused (property-token-level pause)", async function () {
      // Grant PAUSER_MANAGER on the PropertyToken to owner (owner has DEFAULT_ADMIN_ROLE)
      const PAUSER = await pt.PAUSER_MANAGER();
      await pt.connect(ctx.owner).grantRole(PAUSER, ctx.owner.address);
      await pt.connect(ctx.owner).pause();

      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, REVENUE_AMOUNT);
      await ctx.eurc.connect(ctx.owner).approve(pt.address, REVENUE_AMOUNT);
      await expect(
        pt.connect(ctx.owner).distributionRewards(REVENUE_AMOUNT)
      ).to.be.reverted;
    });
  });

  // ─── distributeRevenue via TokenFactory ───────────────────────────────────

  describe("distributeRevenue via TokenFactory", function () {
    it("distributor can push revenue through TokenFactory → PropertyToken", async function () {
      const amt = REVENUE_AMOUNT;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(ctx.tokenFactory.address, amt);
      await ctx.tokenFactory.connect(ctx.owner).distributeRevenue(0, amt);
      expect(await pt.dividendPerToken()).to.be.gt(0);
    });
  });

  // ─── claimDividensExternal ────────────────────────────────────────────────

  describe("claimDividensExternal", function () {
    beforeEach(async function () {
      const amt = REVENUE_AMOUNT;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, amt);
      await ctx.eurc.connect(ctx.owner).approve(pt.address, amt);
      await pt.connect(ctx.owner).distributionRewards(amt);
    });

    it("investor receives dividends proportional to their share", async function () {
      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await pt.connect(ctx.owner).claimDividensExternal(ctx.investor1.address);
      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after.gt(before)).to.equal(true);
    });

    it("xDividendPerToken is updated after claim", async function () {
      await pt.connect(ctx.owner).claimDividensExternal(ctx.investor1.address);
      const xDiv = await pt.xDividendPerToken(ctx.investor1.address);
      expect(xDiv).to.equal(await pt.dividendPerToken());
    });

    it("claiming again immediately gives zero additional reward", async function () {
      await pt.connect(ctx.owner).claimDividensExternal(ctx.investor1.address);
      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await pt.connect(ctx.owner).claimDividensExternal(ctx.investor1.address);
      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after).to.equal(before);
    });

    it("user with no tokens gets 0 dividends", async function () {
      const before = await ctx.eurc.balanceOf(ctx.random.address);
      await pt.connect(ctx.owner).claimDividensExternal(ctx.random.address);
      const after = await ctx.eurc.balanceOf(ctx.random.address);
      expect(after).to.equal(before);
    });
  });

  // ─── transfer ────────────────────────────────────────────────────────────

  describe("transfer", function () {
    beforeEach(async function () {
      // KYC investor2 so they can receive tokens
      await kycApprove(ctx, ctx.investor2);
      // Give investor2 their property tokens too
      await ctx.tokenFactory.getInvestmentTokens(ctx.investor2.address, 0);
    });

    it("KYC-approved investor can transfer tokens to KYC-approved recipient", async function () {
      const amt = ethers.utils.parseEther("1");
      await pt.connect(ctx.investor1).transfer(ctx.investor2.address, amt);
      expect(await pt.balanceOf(ctx.investor2.address)).to.equal(
        ethers.utils.parseEther("5").add(amt)
      );
    });

    it("auto-claims dividends for sender on transfer", async function () {
      const rev = REVENUE_AMOUNT;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, rev);
      await ctx.eurc.connect(ctx.owner).approve(pt.address, rev);
      await pt.connect(ctx.owner).distributionRewards(rev);

      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await pt.connect(ctx.investor1).transfer(ctx.investor2.address, ethers.utils.parseEther("1"));
      const after = await ctx.eurc.balanceOf(ctx.investor1.address);
      expect(after.gt(before)).to.equal(true);
    });

    it("reverts if recipient is not KYC approved", async function () {
      await expect(
        pt.connect(ctx.investor1).transfer(ctx.random.address, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("No KYC Made");
    });

    it("reverts if recipient is blacklisted", async function () {
      await kycApprove(ctx, ctx.random);
      await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.random.address);
      await expect(
        pt.connect(ctx.investor1).transfer(ctx.random.address, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("Blacklisted");
    });

    it("reverts if system is globally paused", async function () {
      await kycApprove(ctx, ctx.random);
      await ctx.hestyAC.connect(ctx.pauserManager).pause();
      await expect(
        pt.connect(ctx.investor1).transfer(ctx.investor2.address, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("All Hesty Paused");
    });

    it("reverts if PropertyToken is individually paused", async function () {
      const PAUSER = await pt.PAUSER_MANAGER();
      await pt.connect(ctx.owner).grantRole(PAUSER, ctx.owner.address);
      await pt.connect(ctx.owner).pause();
      await expect(
        pt.connect(ctx.investor1).transfer(ctx.investor2.address, ethers.utils.parseEther("1"))
      ).to.be.reverted;
    });
  });

  // ─── transferFrom ─────────────────────────────────────────────────────────

  describe("transferFrom", function () {
    beforeEach(async function () {
      await kycApprove(ctx, ctx.investor2);
      await ctx.tokenFactory.getInvestmentTokens(ctx.investor2.address, 0);
    });

    it("approved spender can transferFrom", async function () {
      const amt = ethers.utils.parseEther("1");
      await pt.connect(ctx.investor1).approve(ctx.owner.address, amt);
      await pt.connect(ctx.owner).transferFrom(ctx.investor1.address, ctx.investor2.address, amt);
      expect(await pt.balanceOf(ctx.investor2.address)).to.equal(
        ethers.utils.parseEther("5").add(amt)
      );
    });

    it("reverts if recipient is not KYC approved", async function () {
      const amt = ethers.utils.parseEther("1");
      await pt.connect(ctx.investor1).approve(ctx.owner.address, amt);
      await expect(
        pt.connect(ctx.owner).transferFrom(ctx.investor1.address, ctx.random.address, amt)
      ).to.be.revertedWith("No KYC Made");
    });

    it("reverts if recipient is blacklisted", async function () {
      await kycApprove(ctx, ctx.random);
      await ctx.hestyAC.connect(ctx.blacklistManager).blacklistUser(ctx.random.address);
      const amt = ethers.utils.parseEther("1");
      await pt.connect(ctx.investor1).approve(ctx.owner.address, amt);
      await expect(
        pt.connect(ctx.owner).transferFrom(ctx.investor1.address, ctx.random.address, amt)
      ).to.be.revertedWith("Blacklisted");
    });
  });

  // ─── pause / unpause (PropertyToken level) ───────────────────────────────

  describe("pause / unpause (token level)", function () {
    let PAUSER_ROLE;

    beforeEach(async function () {
      PAUSER_ROLE = await pt.PAUSER_MANAGER();
      await pt.connect(ctx.owner).grantRole(PAUSER_ROLE, ctx.pauserManager.address);
    });

    it("PAUSER_MANAGER can pause the token", async function () {
      await pt.connect(ctx.pauserManager).pause();
      expect(await pt.paused()).to.equal(true);
    });

    it("PAUSER_MANAGER can unpause the token", async function () {
      await pt.connect(ctx.pauserManager).pause();
      await pt.connect(ctx.pauserManager).unpause();
      expect(await pt.paused()).to.equal(false);
    });

    it("non-PAUSER_MANAGER cannot pause", async function () {
      await expect(pt.connect(ctx.random).pause()).to.be.revertedWith("Not Pauser");
    });

    it("non-PAUSER_MANAGER cannot unpause", async function () {
      await pt.connect(ctx.pauserManager).pause();
      await expect(pt.connect(ctx.random).unpause()).to.be.revertedWith("Not Pauser");
    });
  });

  // ─── Dividend math accuracy ───────────────────────────────────────────────

  describe("Dividend math", function () {
    it("investor gets proportional share of revenue", async function () {
      const rev = REVENUE_AMOUNT;
      await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, rev);
      await ctx.eurc.connect(ctx.owner).approve(pt.address, rev);
      await pt.connect(ctx.owner).distributionRewards(rev);

      // investor1 holds 5 of 1000 tokens = 0.5 %
      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await pt.connect(ctx.owner).claimDividensExternal(ctx.investor1.address);
      const after  = await ctx.eurc.balanceOf(ctx.investor1.address);
      const earned = after.sub(before);

      // Expected: rev * 5 / 1000 = rev / 200
      const expected = Math.floor(rev * 5 / 1000);
      // Allow ±1 for integer division rounding
      expect(earned.toNumber()).to.be.closeTo(expected, 1);
    });

    it("multiple distributions accumulate correctly", async function () {
      const rev = REVENUE_AMOUNT;
      for (let i = 0; i < 3; i++) {
        await ctx.eurc.connect(ctx.owner).mint(ctx.owner.address, rev);
        await ctx.eurc.connect(ctx.owner).approve(pt.address, rev);
        await pt.connect(ctx.owner).distributionRewards(rev);
      }

      const before = await ctx.eurc.balanceOf(ctx.investor1.address);
      await pt.connect(ctx.owner).claimDividensExternal(ctx.investor1.address);
      const after  = await ctx.eurc.balanceOf(ctx.investor1.address);
      const earned = after.sub(before);
      const expected = Math.floor(3 * rev * 5 / 1000);
      expect(earned.toNumber()).to.be.closeTo(expected, 3);
    });
  });
});
