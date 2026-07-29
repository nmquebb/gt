import { Text, View } from "react-native";
import { ScreenShell } from "../src/screen-shell";
import { styles } from "../src/theme";

export default function HomeScreen() {
  return (
    <ScreenShell>
      <View style={styles.card}>
        <Text style={styles.heading}>Gametime Checkout</Text>
        <Text style={styles.muted}>
          Open a checkout link from the web experience to continue securely in
          this app.
        </Text>
      </View>
    </ScreenShell>
  );
}
