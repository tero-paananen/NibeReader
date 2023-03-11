import React, {useState} from 'react';
import {
  Alert,
  Button,
  ScrollView,
  TextInput,
  View,
  Text,
  StyleSheet,
} from 'react-native';
import {NibeData, readData} from './NibeConnunication';

const App = () => {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('502');
  const [data, setData] = useState<NibeData[]>([]);

  return (
    <View style={{flex: 1, backgroundColor: 'black', padding: 20}}>
      <View style={{flexDirection: 'row', marginTop: 100}}>
        <TextInput
          style={[styles.input, {minWidth: 200}]}
          placeholder={'address'}
          placeholderTextColor={'white'}
          value={host}
          onChangeText={value => {
            setHost(value);
          }}
        />
        <TextInput
          style={styles.input}
          placeholder={'port'}
          placeholderTextColor={'white'}
          value={port}
          onChangeText={value => {
            setPort(value);
          }}
        />
        <Button
          title="Connect"
          onPress={async () => {
            try {
              /*
              const d = await readData(host, port);
              setData(prev => {
                return [d, ...prev];
              });*/
            } catch (error: any) {
              Alert.alert('Nibe', error.message);
            }
          }}
        />
      </View>
      <ScrollView
        style={styles.list}
        contentContainerStyle={styles.listContent}>
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

const styles = StyleSheet.create({
  input: {
    color: 'white',
    borderColor: 'white',
    borderWidth: 1,
    borderRadius: 2,
    marginHorizontal: 10,
    padding: 10,
  },
  list: {
    flex: 1,
    backgroundColor: 'black',
    marginTop: 20,
  },
  listContent: {
    padding: 10,
    margin: 10,
    borderColor: 'white',
    borderRadius: 2,
    borderWidth: 1,
    minHeight: 200,
  },
});

export default App;
