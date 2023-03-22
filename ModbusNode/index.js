const readline = require('readline');
const net = require('net');
const modbus = require('jsmodbus');

console.log('\n');
console.log('================================');
console.log('Nibe Modbus');
console.log('Tero Paananen 2022');
console.log('================================');
console.log('\n');

let deviceIP;
let devicePort = 502;
let userInterface;
let client;
let socket;

/**
 * Asks user for Nibe device IP
 */
const askDeviceIP = async () => {
  const resp = await ask('Give Nibe device IP address: ');
  deviceIP = resp;
  console.log('Using IP: ' + deviceIP);
  console.log('Using port: ' + devicePort);
};

/**
 * Node main function
 */
const main = async () => {
  userInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    await askDeviceIP();
    await connect();
  } catch (error) {
    console.log(error);
  } finally {
    userInterface.close();
    socket && socket.end();
  }
};

/**
 * Connects to Nibe device using Modbus
 */
const connect = async () => {
  socket = new net.Socket();

  const option = {
    host: deviceIP,
    port: devicePort,
    unitID: 1,
    timeout: 5000,
    autoReconnect: true,
    logLabel: 'Nibe S-series',
    logLevel: 'error',
    logEnabled: true,
  };

  client = new modbus.client.TCP(socket);

  const connectionPromise = new Promise((resolve, reject) => {
    socket.on('connect', async () => {
      console.log('Socket connected');
      resolve(true);
    });
    socket.on('error', e => {
      console.log('Socket error', e.error);
      reject(e.error);
    });
    socket.on('close', () => {
      console.log('Socket closed');
    });
  });

  socket.connect(option);

  return connectionPromise;
};

/**
 * Helper function to ask user for input
 */
const ask = question => {
  return new Promise(resolve => {
    userInterface.question(question, input => resolve(input));
  });
};

main();
