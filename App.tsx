import React, {useState} from 'react';
import {Alert, Button, ScrollView, TextInput, View, Text} from 'react-native';
import {NibeData, readData} from './NibeConnunication';

const App = () => {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('502');
  const [data, setData] = useState<NibeData[]>([]);

  return (
    <View style={{flex: 1, backgroundColor: 'black', margin: 20}}>
      <View style={{flexDirection: 'row'}}>
        <TextInput
          style={{width: 120, color: 'white'}}
          placeholder={'address'}
          placeholderTextColor={'white'}
          value={host}
          onChangeText={value => {
            setHost(value);
          }}
        />
        <TextInput
          style={{width: 60, color: 'white'}}
          placeholder={'port'}
          placeholderTextColor={'white'}
          value={port}
          onChangeText={value => {
            setPort(value);
          }}
        />
      </View>
      <Button
        color={'white'}
        title="Connect"
        onPress={async () => {
          try {
            const d = await readData(host, port);
            setData(prev => {
              return [d, ...prev];
            });
          } catch (error: any) {
            Alert.alert('Nibe', error.message);
          }
        }}
      />
      <ScrollView
        style={{flex: 1, backgroundColor: 'black'}}
        contentContainerStyle={{
          padding: 20,
          borderColor: 'white',
          borderRadius: 2,
          borderWidth: 1,
        }}>
        {data.map((d, i) => {
          return (
            <Text style={{color: 'white'}} key={i}>
              {'Temp outside ' + d.tempOutside}
            </Text>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default App;
