import type { PropsWithChildren } from "react";
import { ScrollView, View } from "react-native";
import { styles } from "./theme";

export function ScreenShell({ children }: PropsWithChildren) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.page}
    >
      <View style={styles.contentColumn}>{children}</View>
    </ScrollView>
  );
}
