# NibeReader

This React Native application communicates and read values from Nibe ground source heating pump.


### Using My Uplink API

Register app in https://dev.myuplink.com/apps to get needed Client Identifier and Client Secret


### Using Mobus sockets

ModbusNode folder contains Node.js executable that communicates with Nibe using Modbus socket.
Modbus socket cannot be used from React Native currently.

https://www.npmjs.com/package/jsmodbus


### Pictures of React Native app and Node.js console executable

<img src="https://user-images.githubusercontent.com/54746036/225132449-71b3c88c-cdbe-4c88-b033-9117eeff6e20.png" width=40% height=40%>

<img src="https://user-images.githubusercontent.com/54746036/226870992-411b8bb5-ed4b-40cc-9fe5-fc51c760d80c.png" width=40% height=40%>

