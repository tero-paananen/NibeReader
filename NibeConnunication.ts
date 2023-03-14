//import modbus from 'jsmodbus';
//import net from 'net';

import base64 from 'base-64';

export type NibeData = {tempOutside: string};

let _deviceId = null;
let _systemId = null;
let _accessToken = null;

export const getToken = async (
  clientId: string,
  clientSecred: string
): Promise<string> => {
  // https://auth0.com/docs/api/authentication?javascript#get-token

  const headers = new Headers();
  headers.append('Content-Type', 'application/x-www-form-urlencoded');

  headers.append(
    'Authorization',
    'Basic ' + base64.encode(clientId + ':' + clientSecred)
  );

  const response = await fetch('https://api.myuplink.com/oauth/token', {
    headers,
    body: 'grant_type=client_credentials&scope=READSYSTEM',
    method: 'POST',
  });

  if (response.ok) {
    const data = await response.json();
    if (data.access_token) {
      _accessToken = data.access_token;
      return data.access_token;
    } else {
      throw Error('Failed to get token: Access token missing');
    }
  } else {
    throw Error('Failed to get token:' + response.statusText);
  }
};

export const getSystemInfo = async (token: string): Promise<string> => {
  const headers = new Headers();
  headers.append('Authorization', 'Bearer ' + token);

  const response = await fetch(
    'https://api.myuplink.com/v2/systems/me?page=1&itemsPerPage=10',
    {
      method: 'GET',
      headers,
    }
  );

  if (response.ok) {
    const data = await response.json();

    if (data) {
      if (data.systems && data.systems.length) {
        const system = data.systems[0];
        //const name = system.name;
        _systemId = system.systemId;
        if (system.devices && system.devices.length) {
          const device = system.devices[0];
          _deviceId = device.id;
          return device.id;
        }
      }
    }
    throw Error('Failed to get system info: Data missing');
  } else {
    throw Error('Failed to get system info:' + response.statusText);
  }
};

export const getDeviceInfo = async (
  token: string,
  deviceId: string
): Promise<string> => {
  const headers = new Headers();
  headers.append('Authorization', 'Bearer ' + token);

  const response = await fetch(
    'https://api.myuplink.com/v2/devices/' + deviceId,
    {
      method: 'GET',
      headers,
    }
  );

  if (response.ok) {
    const data = await response.json();
    if (data) {
      if (data.connectionState) {
        return data.connectionState;
      }
    }
    throw Error('Failed to get device info: Data missing');
  } else {
    throw Error('Failed to get device info:' + response.statusText);
  }
};

export const getDevicePoints = async (
  token: string,
  deviceId: string
): Promise<string> => {
  const headers = new Headers();
  headers.append('Authorization', 'Bearer ' + token);
  headers.append('Accept-Language', 'en-US');

  const response = await fetch(
    'https://api.myuplink.com/v2/devices/' + deviceId + '/points',
    {
      method: 'GET',
      headers,
    }
  );

  if (response.ok) {
    const points = await response.json();
    if (points && points.length) {
      const data = points.map(
        (category: {parameterName: string; strVal: string}) => {
          return category.parameterName + ' = ' + category.strVal;
        }
      );
      return data.join('\n');
    }
    throw Error('Failed to get device points: Data missing');
  } else {
    throw Error('Failed to get device points:' + response.statusText);
  }
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
