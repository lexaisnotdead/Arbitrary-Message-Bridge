require("dotenv").config();
require("@openzeppelin/hardhat-upgrades");
require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.18",

  networks: {
    localhost: {
      allowUnlimitedContractSize: true,
      timeout: 1800000,      
    },
    hardhat: {
      allowUnlimitedContractSize: true,
      timeout: 1800000,      
    },
    goerli: {
      url: `https://goerli.infura.io/v3/${process.env.INFURA_API_KEY}`,
      accounts: [process.env.PRIVATE_KEY],
    }
  }
};
