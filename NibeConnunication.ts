import base64 from 'base-64';

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
