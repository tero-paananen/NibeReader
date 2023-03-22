const readline = require('readline');
const net = require('net');
const modbus = require('jsmodbus');

console.log('\n');
console.log('================================');
console.log('Nibe Modbus');
console.log('Tero Paananen 2023');
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
    await readingLoop();
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
      console.log('Socket error', e.message);
      reject(e.message);
    });
    socket.on('close', () => {
      console.log('Socket closed');
    });
  });

  socket.connect(option);

  return connectionPromise;
};

/**
 * Reads registers loop until user aborts
 */
const readingLoop = async () => {
  return new Promise(async (resolve, reject) => {
    let reading = true;
    try {
      while (reading) {
        const readingQuestion = await ask('Read registers? (y/n): ');
        if (readingQuestion.length === 0 || readingQuestion === 'y') {
          await readingRegisters();
        } else {
          throw new Error('User aborted');
        }
      }
    } catch (error) {
      reading = false;
      reject(error.message);
    }
  });
};

/**
 * Reads registers from Nibe device
 */
const readingRegisters = async () => {
  console.log('\n');
  console.log('Reading registers...');
  const results = await Promise.all([
    client.readInputRegisters(1, 1), // BT1 - outside temperature
    client.readInputRegisters(140, 1), // kompressor Hz
  ]);
  let tempOutside = results[0].response._body._valuesAsBuffer;
  let kompressorHz = results[1].response._body._valuesAsBuffer;

  // Convert HEX to Decimal and divide by the scalefactor
  tempOutside = tempOutside.readInt16BE().toString() / 10; // scale factor is 10
  kompressorHz = kompressorHz.readInt16BE().toString() / 1; // scale factor is 1

  console.log('> Outside temperature: ' + tempOutside);
  console.log('> Kompressor Hz: ' + kompressorHz);
  console.log('\n');
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
