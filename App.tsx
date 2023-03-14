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
import {getToken} from './NibeConnunication';

const App = () => {
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [data, setData] = useState<string[]>([]);

  return (
    <View style={{flex: 1, backgroundColor: 'black', padding: 10}}>
      <View style={{marginTop: 50}}>
        <TextInput
          style={styles.input}
          placeholder={'Client Identifier'}
          placeholderTextColor={'white'}
          value={clientId}
          onChangeText={value => {
            setClientId(value);
          }}
        />
        <TextInput
          style={styles.input}
          placeholder={'Client Secret'}
          placeholderTextColor={'white'}
          value={clientSecret}
          onChangeText={value => {
            setClientSecret(value);
          }}
        />
        <Button
          title="Connect"
          onPress={async () => {
            try {
              const ret = await getToken(clientId, clientSecret);
              setData(prev => {
                return [ret, ...prev];
              });
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
    color: 'white',
    borderColor: 'white',
    borderWidth: 1,
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
    borderColor: 'white',
    borderRadius: 2,
    borderWidth: 1,
    minHeight: 200,
  },
});

export default App;
