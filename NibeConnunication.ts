//import modbus from 'jsmodbus';
//import net from 'net';

export type NibeData = {tempOutside: string};
type NibeError = {error?: string};

export const authorize = async (): Promise<string> => {
  throw Error('Not implemented');
};

export const readMyUplinkData = async (): Promise<any> => {
  throw Error('Not implemented');
};

export const readModBusData = async (
  host: string,
  port: string
): Promise<NibeData> => {
  throw Error('Not supported. Supported in Node.js only.');
  /*
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
      console.log('Socket closed', e.error);
      socket.end();
      reject( e.error);
    });

    socket.on('close', () => {
      console.log('Socket closed');
    });

    socket.connect(option);
  });*/
};
