import React, {useState} from 'react';
import {
  Alert,
  ScrollView,
  TextInput,
  View,
  Text,
  StyleSheet,
  TouchableHighlight,
} from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  getDeviceInfo,
  getDevicePoints,
  getSystemInfo,
  getToken,
} from './NibeConnunication';

const App = () => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [data, setData] = useState<string[]>(['No data']);

  return (
    <View style={{flex: 1, backgroundColor: 'black', padding: 10}}>
      <View style={{marginTop: 50}}>
        <Text style={styles.title}>{'Nibe Reader'}</Text>
        <TextInput
          style={styles.input}
          placeholder={'Client Identifier'}
          placeholderTextColor={'#16ff16'}
          value={clientId}
          autoCapitalize={'none'}
          onChangeText={value => {
            setClientId(value);
          }}
        />
        <TextInput
          style={styles.input}
          placeholder={'Client Secret'}
          placeholderTextColor={'#16ff16'}
          value={clientSecret}
          autoCapitalize={'none'}
          onChangeText={value => {
            setClientSecret(value);
          }}
        />
        <TouchableHighlight
          onPress={async () => {
            try {
              setData(['']);
              const token = await getToken(clientId, clientSecret);
              setData(prev => {
                return ['\nAccess token:', token, ...prev];
              });
              const deviceId = await getSystemInfo(token);
              setData(prev => {
                return ['\nDeviceId:', deviceId, ...prev];
              });
              const deviceInfo = await getDeviceInfo(token, deviceId);
              setData(prev => {
                return ['Connection:', deviceInfo, ...prev];
              });
              const points = await getDevicePoints(token, deviceId);
              setData(prev => {
                return ['Points:', points, ...prev];
              });
            } catch (error: any) {
              Alert.alert('Nibe', error.message);
            }
          }}>
          <Text style={styles.btn}>{'Connect'}</Text>
        </TouchableHighlight>
      </View>
      <View style={styles.listParent}>
        <ScrollView
          showsVerticalScrollIndicator={true}
          contentContainerStyle={styles.listContent}>
          {data.map((d, i) => {
            return (
              <Text style={styles.listText} key={i}>
                {d}
              </Text>
            );
          })}
        </ScrollView>
      </View>
      <Text style={[styles.label, {padding: 20}]}>{'Tero Paananen 2023'}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  input: {
    color: '#16ff16',
    borderColor: '#16ff16',
    borderBottomWidth: 0.4,
    borderRadius: 2,
    marginVertical: 10,
    padding: 8,
    marginHorizontal: 20,
    fontFamily: 'Courier New',
    minWidth: 200,
  },
  listParent: {
    flex: 1,
  },
  listContent: {
    padding: 10,
    borderColor: '#16ff16',
    borderRadius: 2,
    borderWidth: 0.4,
  },
  listText: {
    color: '#16ff16',
    fontFamily: 'Courier New',
    fontSize: 12,
  },
  title: {
    padding: 10,
    fontSize: 18,
    alignSelf: 'center',
    textAlign: 'center',
    color: '#16ff16',
    fontFamily: 'Courier New',
  },
  btn: {
    padding: 10,
    minWidth: 100,
    fontSize: 16,
    fontFamily: 'Courier New',
    alignSelf: 'center',
    textAlign: 'center',
    color: '#16ff16',
    marginBottom: 20,
  },
  label: {
    fontSize: 10,
    textAlign: 'center',
    color: '#16ff16',
    fontFamily: 'Courier New',
  },
});

export default App;
