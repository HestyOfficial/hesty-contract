const { ethers } = require("hardhat");

// Config — set via env vars or edit directly
const TOKEN_FACTORY_ADDRESS ="0x7A5a6Da928c0c9333BDc929903da90b8D0B73D0D";
const PROPERTY_ID           = "22";

async function main() {
  if (!TOKEN_FACTORY_ADDRESS) throw new Error("TOKEN_FACTORY_ADDRESS env var is required");
  if (PROPERTY_ID === undefined) throw new Error("PROPERTY_ID env var is required");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const tokenFactory = await ethers.getContractAt("TokenFactory", TOKEN_FACTORY_ADDRESS, signer);

  const id = ethers.BigNumber.from(PROPERTY_ID);

  const p = await tokenFactory.property(id);
  console.log(`Property ${id.toString()} — raised: ${p.raised.toString()}, threshold: ${p.threshold.toString()}, approved: ${p.approved}, completed: ${p.isCompleted}`);

  console.log(`Completing raise for property ${id.toString()}...`);

  const tx = await tokenFactory.completeRaise(id);
  console.log("Tx sent:", tx.hash);
  await tx.wait();
  console.log("Raise completed.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });