const modbus = require('jsmodbus');
const net = require('net');

type NibeData = {tempOutside: string};
type NibeError = {error?: string; message?: string};

export const readData = async (
  host: string,
  port: string = '502'
): Promise<NibeData> => {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    const option = {
      host,
      port,
      unitID: 1,
      timeout: 5000,
      autoReconnect: true,
      logLabel: 'Nibe S-series',
      logLevel: 'error',
      logEnabled: true,
    };

    const client = new modbus.client.TCP(socket);

    socket.on('connect', async () => {
      try {
        console.log('Socket connected');
        const results = await Promise.all([
          client.readInputRegisters(1, 1), // BT1 - outside temperature
        ]);
        let tempOutside = results[0].response._body._valuesAsBuffer;

        // Convert HEX to Decimal and divide by the scalefactor
        tempOutside = tempOutside.readInt16BE().toString() / 10; // scale factor is 10

        resolve({tempOutside});
      } catch (e: any) {
        console.log('socked read error', e.message);
        reject(e.message);
      } finally {
        socket.end();
      }
    });

    socket.on('error', (e: NibeError) => {
      console.log('Socket closed', getError(e));
      socket.end();
      reject(getError(e));
    });

    socket.on('close', () => {
      console.log('Socket closed');
    });

    socket.connect(option);
  });
};

const getError = (e: NibeError) => {
  return e.error || e.message || 'Unknown error';
};
