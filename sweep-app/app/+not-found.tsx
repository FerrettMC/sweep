import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { type Palette, spacing, type } from "@/constants/theme";
import { useTheme, useThemedStyles } from "@/lib/theme";
import { useTranslate } from "@/lib/i18n";

export default function NotFoundScreen() {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const t = useTranslate();
  return (
    <>
      <Stack.Screen
        options={{
          title: t("notFound.title"),
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.textPrimary,
        }}
      />
      <View style={styles.container}>
        <Text style={styles.title}>{t("notFound.body")}</Text>
        <Link href="/(tabs)" style={styles.link}>
          <Text style={styles.linkText}>{t("notFound.goHome")}</Text>
        </Link>
      </View>
    </>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
