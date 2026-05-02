const { ethers } = require("hardhat");

// Config — set via env vars or edit directly
const TOKEN_FACTORY_ADDRESS = "0x7A5a6Da928c0c9333BDc929903da90b8D0B73D0D";
const PROPERTY_ID           = "22";
const RAISE_DEADLINE        = "1777610290"; // Unix timestamp (seconds)

async function main() {
  if (!TOKEN_FACTORY_ADDRESS) throw new Error("TOKEN_FACTORY_ADDRESS env var is required");
  if (PROPERTY_ID === undefined) throw new Error("PROPERTY_ID env var is required");
  if (!RAISE_DEADLINE) throw new Error("RAISE_DEADLINE env var is required (Unix timestamp in seconds)");

  const [signer] = await ethers.getSigners();
  console.log("Signer:", signer.address);

  const tokenFactory = await ethers.getContractAt("TokenFactory", TOKEN_FACTORY_ADDRESS, signer);

  const id       = ethers.BigNumber.from(PROPERTY_ID);
  const deadline = ethers.BigNumber.from(RAISE_DEADLINE);

  console.log(`Approving property ${id.toString()} with deadline ${deadline.toString()} (${new Date(deadline.toNumber() * 1000).toISOString()})...`);

  const tx = await tokenFactory.approveProperty(id, deadline);
  console.log("Tx sent:", tx.hash);
  await tx.wait();
  console.log("Property approved.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });