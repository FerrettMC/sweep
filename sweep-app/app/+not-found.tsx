import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/constants/theme";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen
        options={{
          title: "Not found",
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
        }}
      />
      <View style={styles.container}>
        <Text style={styles.title}>This screen doesn't exist.</Text>
        <Link href="/(tabs)" style={styles.link}>
          <Text style={styles.linkText}>Go to tracking</Text>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  title: {
    color: colors.textPrimary,
    fontSize: type.heading.fontSize,
    fontWeight: "700",
  },
  link: { marginTop: spacing.md, paddingVertical: spacing.md },
  linkText: { color: colors.accent, fontSize: type.body.fontSize, fontWeight: "700" },
});
