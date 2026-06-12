// test/Suite/HestyAccessControl.test.js
// Full unit test suite for HestyAccessControl.sol

const { expect }  = require("chai");
const { ethers }  = require("hardhat");

describe("HestyAccessControl", function () {
  let hestyAC;
  let owner, kycManager, fundsManager, pauserManager, blacklistManager, user, random;

  beforeEach(async function () {
    [owner, kycManager, fundsManager, pauserManager, blacklistManager, user, random] =
      await ethers.getSigners();

    const HestyAccessControl = await ethers.getContractFactory("HestyAccessControl");
    hestyAC = await HestyAccessControl.connect(owner).deploy();
    await hestyAC.deployed();

    await hestyAC.grantRole(await hestyAC.KYC_MANAGER(),       kycManager.address);
    await hestyAC.grantRole(await hestyAC.FUNDS_MANAGER(),     fundsManager.address);
    await hestyAC.grantRole(await hestyAC.PAUSER_MANAGER(),    pauserManager.address);
    await hestyAC.grantRole(await hestyAC.BLACKLIST_MANAGER(), blacklistManager.address);
  });

  // ─── Constants ────────────────────────────────────────────────────────────

  describe("Role constants", function () {
    it("BLACKLIST_MANAGER matches expected hash", async function () {
      expect(await hestyAC.BLACKLIST_MANAGER()).to.equal(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("BLACKLIST_MANAGER"))
      );
    });

    it("FUNDS_MANAGER matches expected hash", async function () {
      expect(await hestyAC.FUNDS_MANAGER()).to.equal(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("FUNDS_MANAGER"))
      );
    });

    it("KYC_MANAGER matches expected hash", async function () {
      expect(await hestyAC.KYC_MANAGER()).to.equal(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("KYC_MANAGER"))
      );
    });

    it("PAUSER_MANAGER matches expected hash", async function () {
      expect(await hestyAC.PAUSER_MANAGER()).to.equal(
        ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSER_MANAGER"))
      );
    });
  });

  // ─── Constructor / initial state ─────────────────────────────────────────

  describe("Initial state", function () {
    it("deployer is DEFAULT_ADMIN_ROLE holder", async function () {
      const ADMIN = await hestyAC.DEFAULT_ADMIN_ROLE();
      expect(await hestyAC.hasRole(ADMIN, owner.address)).to.equal(true);
    });

    it("initialSponsorAmount is 0.00025 ether", async function () {
      expect(await hestyAC.initialSponsorAmount()).to.equal(
        ethers.utils.parseEther("0.00025")
      );
    });

    it("new user has no KYC", async function () {
      expect(await hestyAC.kycCompleted(user.address)).to.equal(false);
    });

    it("new user is not blacklisted", async function () {
      expect(await hestyAC.blackList(user.address)).to.equal(false);
    });

    it("contract is not paused initially", async function () {
      expect(await hestyAC.paused()).to.equal(false);
    });

    it("owner() returns the deployer", async function () {
      expect(await hestyAC.owner()).to.equal(owner.address);
    });
  });

  // ─── onlyAdmin / onlyFundsManager guards ─────────────────────────────────

  describe("onlyAdmin guard", function () {
    it("passes for DEFAULT_ADMIN_ROLE holder", async function () {
      await hestyAC.onlyAdmin(owner.address); // must not revert
    });

    it("reverts for non-admin", async function () {
      await expect(
        hestyAC.connect(random).onlyAdmin(random.address)
      ).to.be.revertedWith("Not Admin Manager");
    });
  });

  describe("onlyFundsManager guard", function () {
    it("passes for FUNDS_MANAGER holder", async function () {
      await hestyAC.onlyFundsManager(fundsManager.address); // must not revert
    });

    it("reverts for non-funds-manager", async function () {
      await expect(
        hestyAC.onlyFundsManager(random.address)
      ).to.be.revertedWith("Not Funds Manager");
    });
  });

  // ─── KYC ──────────────────────────────────────────────────────────────────

  describe("approveKYCOnly", function () {
    it("KYC_MANAGER can approve a user", async function () {
      await hestyAC.connect(kycManager).approveKYCOnly(user.address);
      expect(await hestyAC.kycCompleted(user.address)).to.equal(true);
    });

    it("non-KYC_MANAGER cannot approve", async function () {
      await expect(
        hestyAC.connect(random).approveKYCOnly(user.address)
      ).to.be.revertedWith("Not KYC Manager");
    });

    it("reverts if user is already KYC approved", async function () {
      await hestyAC.connect(kycManager).approveKYCOnly(user.address);
      await expect(
        hestyAC.connect(kycManager).approveKYCOnly(user.address)
      ).to.be.revertedWith("Already Approved");
    });
  });

  describe("approveUserKYC (with potential sponsoring)", function () {
    it("KYC_MANAGER can call approveUserKYC", async function () {
      // user already has ETH (hardhat signer), so no sponsoring needed
      await hestyAC.connect(kycManager).approveUserKYC(user.address);
      expect(await hestyAC.kycCompleted(user.address)).to.equal(true);
    });

    it("non-KYC_MANAGER cannot call approveUserKYC", async function () {
      await expect(
        hestyAC.connect(random).approveUserKYC(user.address)
      ).to.be.revertedWith("Not KYC Manager");
    });

    it("reverts if already KYC approved", async function () {
      await hestyAC.connect(kycManager).approveUserKYC(user.address);
      await expect(
        hestyAC.connect(kycManager).approveUserKYC(user.address)
      ).to.be.revertedWith("Already Approved");
    });

    it("sponsors user with 0 ETH on first approval", async function () {
      // Zero out user's ETH balance
      await ethers.provider.send("hardhat_setBalance", [user.address, "0x0"]);
      // Fund the HestyAccessControl contract so it can pay
      const sponsorAmount = ethers.utils.parseEther("0.00025");
      await owner.sendTransaction({ to: hestyAC.address, value: sponsorAmount.mul(2) });

      await hestyAC.connect(kycManager).approveUserKYC(user.address);

      expect(await hestyAC.kycCompleted(user.address)).to.equal(true);
      expect(await ethers.provider.getBalance(user.address)).to.equal(sponsorAmount);

      // Restore default balance so signer is usable in subsequent test files
      await ethers.provider.send("hardhat_setBalance", [
        user.address,
        ethers.utils.parseEther("10000").toHexString(),
      ]);
    });

    it("no sponsoring on re-approval after KYC revoked", async function () {
      // First approval — sets firstApproval flag
      await hestyAC.connect(kycManager).approveUserKYC(user.address);
      // Revoke
      await hestyAC.connect(kycManager).revertUserKYC(user.address);
      // Second approval should NOT sponsor (firstApproval already true)
      await ethers.provider.send("hardhat_setBalance", [user.address, "0x0"]);
      await hestyAC.connect(kycManager).approveUserKYC(user.address);
      // User receives no ETH because firstApproval was already true
      expect(await ethers.provider.getBalance(user.address)).to.equal(0);

      // Restore default balance so signer is usable in subsequent test files
      await ethers.provider.send("hardhat_setBalance", [
        user.address,
        ethers.utils.parseEther("10000").toHexString(),
      ]);
    });
  });

  describe("revertUserKYC", function () {
    it("KYC_MANAGER can revoke an approved user", async function () {
      await hestyAC.connect(kycManager).approveKYCOnly(user.address);
      await hestyAC.connect(kycManager).revertUserKYC(user.address);
      expect(await hestyAC.kycCompleted(user.address)).to.equal(false);
    });

    it("reverts if user is not KYC approved", async function () {
      await expect(
        hestyAC.connect(kycManager).revertUserKYC(user.address)
      ).to.be.revertedWith("Not KYC Approved");
    });

    it("non-KYC_MANAGER cannot revoke", async function () {
      await hestyAC.connect(kycManager).approveKYCOnly(user.address);
      await expect(
        hestyAC.connect(random).revertUserKYC(user.address)
      ).to.be.revertedWith("Not KYC Manager");
    });
  });

  // ─── Blacklist ────────────────────────────────────────────────────────────

  describe("blacklistUser / unBlacklistUser", function () {
    it("BLACKLIST_MANAGER can blacklist a user", async function () {
      await hestyAC.connect(blacklistManager).blacklistUser(user.address);
      expect(await hestyAC.blackList(user.address)).to.equal(true);
    });

    it("reverts if user already blacklisted", async function () {
      await hestyAC.connect(blacklistManager).blacklistUser(user.address);
      await expect(
        hestyAC.connect(blacklistManager).blacklistUser(user.address)
      ).to.be.revertedWith("Already blacklisted");
    });

    it("non-BLACKLIST_MANAGER cannot blacklist", async function () {
      await expect(
        hestyAC.connect(random).blacklistUser(user.address)
      ).to.be.revertedWith("Not Blacklist Manager");
    });

    it("BLACKLIST_MANAGER can unblacklist a user", async function () {
      await hestyAC.connect(blacklistManager).blacklistUser(user.address);
      await hestyAC.connect(blacklistManager).unBlacklistUser(user.address);
      expect(await hestyAC.blackList(user.address)).to.equal(false);
    });

    it("reverts unblacklist if user is not blacklisted", async function () {
      await expect(
        hestyAC.connect(blacklistManager).unBlacklistUser(user.address)
      ).to.be.revertedWith("Not blacklisted");
    });

    it("non-BLACKLIST_MANAGER cannot unblacklist", async function () {
      await hestyAC.connect(blacklistManager).blacklistUser(user.address);
      await expect(
        hestyAC.connect(random).unBlacklistUser(user.address)
      ).to.be.revertedWith("Not Blacklist Manager");
    });
  });

  // ─── Pause / Unpause ──────────────────────────────────────────────────────

  describe("pause / unpause", function () {
    it("PAUSER_MANAGER can pause", async function () {
      await hestyAC.connect(pauserManager).pause();
      expect(await hestyAC.paused()).to.equal(true);
    });

    it("non-PAUSER_MANAGER cannot pause", async function () {
      await expect(
        hestyAC.connect(random).pause()
      ).to.be.revertedWith("Not Pauser Manager");
    });

    it("PAUSER_MANAGER can unpause", async function () {
      await hestyAC.connect(pauserManager).pause();
      await hestyAC.connect(pauserManager).unpause();
      expect(await hestyAC.paused()).to.equal(false);
    });

    it("non-PAUSER_MANAGER cannot unpause", async function () {
      await hestyAC.connect(pauserManager).pause();
      await expect(
        hestyAC.connect(random).unpause()
      ).to.be.revertedWith("Not Pauser Manager");
    });
  });

  // ─── setSponsorAmount ─────────────────────────────────────────────────────

  describe("setSponsorAmount", function () {
    it("admin can update the sponsor amount", async function () {
      await hestyAC.connect(owner).setSponsorAmount(ethers.utils.parseEther("0.001"));
      expect(await hestyAC.initialSponsorAmount()).to.equal(
        ethers.utils.parseEther("0.001")
      );
    });

    it("non-admin cannot update sponsor amount", async function () {
      await expect(
        hestyAC.connect(random).setSponsorAmount(0)
      ).to.be.revertedWith("Not Admin Manager");
    });

    it("admin can set sponsor amount to zero (disables sponsoring)", async function () {
      await hestyAC.connect(owner).setSponsorAmount(0);
      expect(await hestyAC.initialSponsorAmount()).to.equal(0);
    });
  });

  // ─── receive() ───────────────────────────────────────────────────────────

  describe("ETH receive", function () {
    it("accepts ETH deposits for sponsoring pool", async function () {
      const amount = ethers.utils.parseEther("1");
      await owner.sendTransaction({ to: hestyAC.address, value: amount });
      expect(await ethers.provider.getBalance(hestyAC.address)).to.equal(amount);
    });
  });
});
