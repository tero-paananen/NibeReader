console.log('\n');
console.log('================================');
console.log('Nibe Modbus');
console.log('Tero Paananen 2022');
console.log('================================');
console.log('\n');

const readline = require('readline');

let deviceIP;

const readFromUser = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

/**
 * Asks user for Nibe device IP
 */
const askDeviceIP = async () => {
  const resp = await ask('What is your Nibe device IP? ');
  deviceIP = resp;
  console.log('Using IP: ' + deviceIP);
};

/**
 * Node main function
 */
const main = async () => {
  await askDeviceIP();

  readFromUser.close();
};

/**
 * Helper function to ask user for input
 */
const ask = question => {
  return new Promise(resolve => {
    readFromUser.question(question, input => resolve(input));
  });
};

main();
