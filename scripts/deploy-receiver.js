const { ethers, upgrades } = require("hardhat");
const inits = require("../state.json");

async function main() {
    const accounts = await ethers.getSigners();
  
    console.log(
        "Deploying contracts with the account:",
        accounts[0].address
    );
    console.log("Account balance:", (await accounts[0].getBalance()).toString());

    console.log("Validators:", inits.VALIDATORS);
    console.log("Validator Consensus Ratio:", inits.NUMERATOR / inits.DENOMINATOR);
    console.log(`Fraction: ${inits.NUMERATOR} / ${inits.DENOMINATOR}`)

    const Receiver = await ethers.getContractFactory("Receiver");
    const receiver = await upgrades.deployProxy(Receiver, [inits.VALIDATORS, inits.NUMERATOR, inits.DENOMINATOR], { initializer: 'initialize', kind: 'uups' });
    await receiver.deployed();
    
    console.log("Receiver contract deployed to:", receiver.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });