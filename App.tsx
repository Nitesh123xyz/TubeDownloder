import { StatusBar, StyleSheet, Text, View } from 'react-native';
import React from 'react';

const App = () => {
  return (
    <View>
      <StatusBar barStyle="dark-content" backgroundColor={"red"} />
      <Text>App</Text>
    </View>
  );
};

export default App;

const styles = StyleSheet.create({});
