const { ethers } = require("hardhat");
const { NonceManager } = require("@ethersproject/experimental");

async function main() {

  let hestyAccessControl;
  let tokenFactory;
  let eurc;
  let issuanceContract;
  let referralSystem;
  let hestyRouter;

  const [owner] = await ethers.getSigners();
  console.log("Deployer:", owner.address);

  const provider = ethers.provider;

  // Wrap signer with NonceManager
  const signer = new NonceManager(owner);

  // -------------------------------
  // CHECK & CANCEL PENDING TXs
  // -------------------------------
  const confirmedNonce = await provider.getTransactionCount(owner.address, "latest");
  const pendingNonce   = await provider.getTransactionCount(owner.address, "pending");

  console.log("Confirmed nonce:", confirmedNonce);
  console.log("Pending nonce:  ", pendingNonce);

  if (pendingNonce > confirmedNonce) {
    console.log("⚠️  Pending txs detected, cancelling all...");

    for (let nonce = confirmedNonce; nonce < pendingNonce; nonce++) {
      const cancelTx = await owner.sendTransaction({
        to: owner.address,
        value: 0,
        nonce: nonce,
        gasLimit: 21000,
        maxFeePerGas: ethers.utils.parseUnits("500", "gwei"),
        maxPriorityFeePerGas: ethers.utils.parseUnits("150", "gwei"),
      });

      console.log(`⏳ Cancelling nonce ${nonce}: ${cancelTx.hash}`);
      await cancelTx.wait();
    }

    console.log("✅ All pending txs cancelled");
  }

  // -------------------------------
  // DYNAMIC GAS CONFIG
  // -------------------------------
  const feeData = await provider.getFeeData();

  const txOptions = {
    maxFeePerGas: feeData.maxFeePerGas.mul(2),
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas.mul(2),
  };

  // -------------------------------
  // DEPLOY CONTRACTS
  // -------------------------------

  hestyAccessControl = await ethers.deployContract(
    "HestyAccessControl",
    [],
    signer
  );
  await hestyAccessControl.deployed();
  const vAddress0 = hestyAccessControl.address;
  console.log("HestyAccessControl:", vAddress0);

  tokenFactory = await ethers.deployContract(
    "TokenFactory",
    [300, 100, "0x168090283962c5129A2CBc91E099369297f32437", 1, vAddress0],
    signer
  );
  await tokenFactory.deployed();
  const vAddress = tokenFactory.address;
  console.log("TokenFactory:", vAddress);

  eurc = await ethers.deployContract(
    "MockERC20",
    ["Euro Circle", "EURC"],
    signer
  );
  await eurc.deployed();
  const vAddress2 = eurc.address;
  console.log("Euro Circle:", vAddress2);

  referralSystem = await ethers.deployContract(
    "ReferralSystem",
    ["0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42", vAddress0, vAddress],
    signer
  );
  await referralSystem.deployed();
  const vAddress3 = referralSystem.address;
  console.log("ReferralSystem:", vAddress3);

  issuanceContract = await ethers.deployContract(
    "HestyAssetIssuance",
    [vAddress],
    signer
  );
  await issuanceContract.deployed();
  const vAddress5 = issuanceContract.address;
  console.log("Issuance Contract:", vAddress5);

  hestyRouter = await ethers.deployContract(
    "HestyRouter",
    [vAddress, vAddress0],
    signer
  );
  await hestyRouter.deployed();
  const vAddress4 = hestyRouter.address;
  console.log("Hesty Router:", vAddress4);

  // -------------------------------
  // INITIALIZATION
  // -------------------------------
  const initTx = await tokenFactory.initialize(vAddress3, vAddress5, txOptions);
  await initTx.wait();

  console.log("\x1b[32m%s\x1b[0m", "🚀 HESTY DEPLOY COMPLETE 🚀");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ ERROR:", error);
    process.exit(1);
  });