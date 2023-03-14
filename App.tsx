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
import {
  getDeviceInfo,
  getDevicePoints,
  getSystemInfo,
  getToken,
} from './NibeConnunication';

const App = () => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [data, setData] = useState<string[]>([]);

  return (
    <View style={{flex: 1, backgroundColor: 'black', padding: 10}}>
      <View style={{marginTop: 50}}>
        <Text style={styles.title}>{'Nibe Reader'}</Text>
        <TextInput
          style={styles.input}
          placeholder={'Client Identifier'}
          placeholderTextColor={'#16ff16'}
          value={clientId}
          onChangeText={value => {
            setClientId(value);
          }}
        />
        <TextInput
          style={styles.input}
          placeholder={'Client Secret'}
          placeholderTextColor={'#16ff16'}
          value={clientSecret}
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
      <ScrollView
        style={styles.list}
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
  );
};

const styles = StyleSheet.create({
  input: {
    color: '#16ff16',
    borderColor: '#16ff16',
    borderWidth: 0.4,
    borderRadius: 2,
    marginVertical: 10,
    padding: 10,
    minWidth: 200,
  },
  list: {
    flex: 1,
    backgroundColor: 'black',
    marginTop: 40,
  },
  listContent: {
    padding: 10,
    borderColor: '#16ff16',
    borderRadius: 2,
    borderWidth: 0.4,
    minHeight: 200,
  },
  listText: {
    color: '#16ff16',
    fontSize: 12,
  },
  title: {
    padding: 10,
    fontSize: 18,
    alignSelf: 'center',
    textAlign: 'center',
    color: '#16ff16',
  },
  btn: {
    padding: 10,
    minWidth: 100,
    fontSize: 16,
    alignSelf: 'center',
    textAlign: 'center',
    color: '#16ff16',
  },
});

export default App;
