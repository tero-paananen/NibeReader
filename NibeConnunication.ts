//import modbus from 'jsmodbus';
//import net from 'net';

import base64 from 'base-64';

export type NibeData = {tempOutside: string};

const REDIRECT_URL = 'nibereader://authorized';

let systemId = null;
let accessToken = null;

export const authorize = async (clientId: string): Promise<boolean> => {
  // Client Identifier and Client Secred from https://dev.myuplink.com/apps
  // https://auth0.com/docs/get-started/authentication-and-authorization-flow/client-credentials-flow
  // https://dev.myuplink.com/auth

  throw Error('Not implemented');

  /*
  try {
    const headers = new Headers();
    const url =
      'https://api.myuplink.com/oauth/authorize?response_type=code&client_id=' +
      encodeURIComponent(clientId) +
      '&scope=READSYSTEM WRITESYSTEM offline_access&redirect_uri=' +
      encodeURIComponent(REDIRECT_URL) +
      '&state=x';
    const response = await fetch(url, {
      headers,
      method: 'GET',
    });
    if (response.ok) {
      //const data = await response.json();
      //console.log('> data', data);
      return true;
    } else {
      throw Error('Failed to get token:' + response.statusText);
    }
  } catch (error: any) {
    console.log('authorize error', error.message);
    throw error;
  }*/
};

export const getToken = async (
  clientId: string,
  clientSecred: string
): Promise<string> => {
  // https://auth0.com/docs/api/authentication?javascript#get-token

  const headers = new Headers();
  headers.append('Content-Type', 'application/x-www-form-urlencoded');
  headers.append('Accept', 'application/json, text/plain, */*');

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
      accessToken = data.access_token;
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
  headers.append('Accept', 'text/plain');

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
        systemId = system.systemId;
        return system.systemId;
      }
    }
    throw Error('Failed to get system info: Data missing');
  } else {
    throw Error('Failed to get system info:' + response.statusText);
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
